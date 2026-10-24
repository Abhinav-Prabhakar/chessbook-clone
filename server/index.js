import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { databasePath } from "./core/db.js";
import { importAll, importMasterGamesInBackground } from "./core/data-import.js";
import { seedIfEmpty } from "./core/seed.js";
import { api } from "./core/api.js";
import { content } from "./core/content.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "app", "dist");

let booted = false;
export function boot() {
  if (booted) return;
  importAll();
  seedIfEmpty();
  if (process.env.CHESSBOOK_SKIP_DATA !== "1" && process.env.NODE_ENV !== "test") importMasterGamesInBackground();
  booted = true;
}

export function createApp() {
  boot();
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: ["text/plain", "application/x-chess-pgn"], limit: "4mb" }));

  app.use("/api/content", content);
  app.use("/api", api);

  app.use("/_build", express.static(join(root, "_build")));
  app.use("/homepage_imgs", express.static(join(root, "homepage_imgs")));
  app.use("/pieces", express.static(join(root, "pieces"), { maxAge: "7d" }));

  if (existsSync(dist)) {
    app.get("/sw.js", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(join(dist, "sw.js"));
    });
    app.use(express.static(dist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(join(dist, "index.html"));
    });
  }

  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Something went wrong" : err.message });
  });
  return app;
}

export function startServer(port = Number(process.env.PORT || 8787)) {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`[server] http://localhost:${port}`);
    console.log(`[server] database ${databasePath}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
