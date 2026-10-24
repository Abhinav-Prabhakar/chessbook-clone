const BASE = "/api";
const QUEUE_KEY = "cb_offline_queue";
const QUEUE_VERSION = 1;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A non-GET write that could not reach the local API and is now queued. */
export class OfflineQueuedError extends Error {
  queued = true;
  constructor(message = "You are offline. This change was queued and will sync when the connection returns.") {
    super(message);
  }
}

export interface QueuedWrite {
  id: string;
  method: string;
  path: string;
  body: string | null;
  createdAt: string;
}

export interface OfflineSnapshot {
  online: boolean;
  pending: number;
  /** True while the queue is being replayed. */
  syncing: boolean;
  /** A short error from the last failed replay attempt, if any. */
  error: string | null;
}

interface StoredQueue {
  version: number;
  items: QueuedWrite[];
}

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `write-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function readQueue(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredQueue | QueuedWrite[];
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.method === "string" &&
        typeof item.path === "string"
    );
  } catch {
    return [];
  }
}

function persistQueue(items: QueuedWrite[]) {
  try {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify({ version: QUEUE_VERSION, items } satisfies StoredQueue)
    );
  } catch {
    // Private browsing or a full quota: the in-memory queue still retries this
    // session, it just will not survive a reload.
  }
}

let queue: QueuedWrite[] = readQueue();
let syncing = false;
let lastError: string | null = null;
const listeners = new Set<(snapshot: OfflineSnapshot) => void>();

function browserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export function offlineSnapshot(): OfflineSnapshot {
  return { online: browserOnline(), pending: queue.length, syncing, error: lastError };
}

function emitOffline() {
  const snapshot = offlineSnapshot();
  for (const listener of listeners) listener(snapshot);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cb:offline", { detail: snapshot }));
  }
}

export function onOfflineChange(listener: (snapshot: OfflineSnapshot) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Parse the JSON body just enough to find the idempotency key. */
function submissionKey(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed?.submissionId ?? null;
  } catch {
    return null;
  }
}

function queueWrite(path: string, options: RequestInit): never {
  const method = (options.method || "POST").toUpperCase();
  const body = typeof options.body === "string" ? options.body : options.body ? String(options.body) : null;
  const key = submissionKey(body);
  if (key && queue.some((item) => submissionKey(item.body) === key)) {
    throw new OfflineQueuedError(
      "You are offline. That change is already queued and will sync when the connection returns."
    );
  }
  queue.push({ id: randomId(), method, path, body, createdAt: new Date().toISOString() });
  persistQueue(queue);
  lastError = null;
  emitOffline();
  throw new OfflineQueuedError();
}

function networkFailure(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message));
}

async function rawRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

/**
 * Reads are de-duplicated while in flight. React StrictMode mounts effects
 * twice in development; sharing the in-flight GET halves the `/me`, `/settings`
 * and page requests without caching a stale response (D222).
 */
const pendingReads = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  const existing = pendingReads.get(path);
  if (existing) return existing as Promise<T>;
  let pending: Promise<T>;
  pending = rawRequest<T>(path).finally(() => {
    if (pendingReads.get(path) === pending) pendingReads.delete(path);
  });
  pendingReads.set(path, pending);
  return pending;
}

function write<T>(path: string, options: RequestInit): Promise<T> {
  if (!browserOnline()) {
    queueWrite(path, options);
  }
  return rawRequest<T>(path, options).catch((error) => {
    if (networkFailure(error) && !(error instanceof ApiError)) {
      queueWrite(path, options);
    }
    throw error;
  });
}

export const api = {
  get,
  post: <T>(path: string, body?: unknown) =>
    write<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    write<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => write<T>(path, { method: "DELETE" }),
};

/**
 * Replay queued writes in order. A 4xx response means the server rejected the
 * payload (it will never succeed), so it is dropped; network/5xx failures stop
 * the replay and leave the rest of the queue intact for the next online event.
 */
export async function flushOfflineQueue(): Promise<{ synced: number; pending: number }> {
  if (syncing || !browserOnline() || queue.length === 0) {
    return { synced: 0, pending: queue.length };
  }
  syncing = true;
  lastError = null;
  emitOffline();
  let synced = 0;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      const response = await fetch(`${BASE}${item.path}`, {
        method: item.method,
        credentials: "include",
        headers: item.body ? { "Content-Type": "application/json" } : undefined,
        body: item.body ?? undefined,
      });
      if (response.status >= 400 && response.status < 500) {
        // Validation/404 responses are terminal; drop so the queue cannot wedge.
        queue.shift();
        persistQueue(queue);
        lastError = `A queued change was rejected (${response.status}).`;
        continue;
      }
      if (!response.ok) {
        throw new Error(`Local API returned ${response.status}`);
      }
      queue.shift();
      persistQueue(queue);
      synced += 1;
      emitOffline();
    }
  } catch (error: any) {
    lastError = error?.message || "The queued changes could not be sent yet.";
  } finally {
    syncing = false;
    emitOffline();
  }
  if (synced > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cb:offline-flushed", { detail: { synced } }));
  }
  return { synced, pending: queue.length };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushOfflineQueue();
  });
  window.addEventListener("offline", () => emitOffline());
}
