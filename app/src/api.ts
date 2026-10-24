export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const tz = () => new Date().getTimezoneOffset();

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith("/api") ? path : `/api${path}`;
  const withTz = method === "GET" ? `${url}${url.includes("?") ? "&" : "?"}tz=${tz()}` : url;
  let response: Response;
  try {
    response = await fetch(withTz, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the Chessbook server. Is it running?");
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new ApiError(response.status, (data && data.error) || `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export const pathQuery = (path: string[]) => encodeURIComponent(path.join(","));
