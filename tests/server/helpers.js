import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Boot a real Express app against a throwaway SQLite file.
 *
 * `CHESSBOOK_DB` must be set before the server modules are imported, so this
 * helper only performs dynamic imports. Openings are skipped to keep the
 * tests fast; the curated seed repertoire does not depend on them.
 */
export async function startTestServer() {
  const dir = mkdtempSync(join(tmpdir(), "chessbook-test-"));
  const dbPath = join(dir, "chessbook.db");
  process.env.CHESSBOOK_DB = dbPath;
  process.env.CHESSBOOK_SKIP_OPENINGS = "1";

  const { createApp } = await import("../../server/index.js");
  const { db } = await import("../../server/db.js");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api`;

  async function api(method, path, body) {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, body: json, ok: response.ok };
  }

  async function apiOk(method, path, body) {
    const result = await api(method, path, body);
    if (!result.ok) {
      throw new Error(`${method} ${path} -> ${result.status}: ${result.body?.error}`);
    }
    return result.body;
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    try {
      const { close: closeEngine } = await import("../../server/engine.js");
      await closeEngine();
    } catch {
      // engine already closed or unavailable
    }
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { api, apiOk, base, close, db, dbPath, dir, server };
}

/** Answer the current task of a session until it completes (or guard trips). */
export async function finishSession(ctx, sessionId, startBody, { limit = 400 } = {}) {
  let body = startBody;
  let guard = 0;
  while (!body.session.complete && guard < limit) {
    const task = body.next?.task ?? body.task;
    if (!task) break;
    body = await ctx.apiOk("POST", `/practice/sessions/${sessionId}/attempt`, {
      san: task.expectedSan,
      submissionId: `finish-${sessionId}-${guard}-${task.epd.slice(0, 10)}`,
    });
    guard += 1;
  }
  return body;
}
