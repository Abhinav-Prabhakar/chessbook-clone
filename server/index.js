import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { api } from "./api.js";
import { databasePath } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "app", "dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(express.json({ limit: "512kb" }));

  app.use("/api", api);

  app.use("/_build", express.static(join(root, "_build")));
  app.use("/homepage_imgs", express.static(join(root, "homepage_imgs")));
  app.use("/pieces", express.static(join(root, "pieces")));

  if (existsSync(dist)) {
    app.get("/manifest.webmanifest", (_req, res) => {
      res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      res.sendFile(join(dist, "manifest.webmanifest"));
    });
    app.get("/sw.js", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Service-Worker-Allowed", "/");
      res.sendFile(join(dist, "sw.js"));
    });
    app.use(express.static(dist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.sendFile(join(dist, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("html").send(
        `<html><body style="font:16px system-ui;background:#131516;color:#eee;padding:40px">
          <h1>Chessbook API is running</h1>
          <p>Start the React dev server with <code>npm run dev:app</code>.</p>
        </body></html>`
      );
    });
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}

export function startServer(port = Number(process.env.PORT || 8787)) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[server] http://localhost:${port}`);
    console.log(`[server] database ${databasePath}`);
  });
  return server;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer();
}
