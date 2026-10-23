import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "app", "dist");
const port = Number(process.env.PORT || 8787);

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.json({ limit: "512kb" }));

app.use("/api", api);

/* The original marketing page is kept pixel-perfect and served from the
   repository root. A small bridge sends its CTAs into the React app. */
function marketingHtml() {
  let html = readFileSync(join(root, "signup", "index.html"), "utf8");
  // The captured page's generic interaction layer sends "Try it for free" to
  // the old onboarding screen. The bridge below owns routing instead so a
  // visitor can start a guest repertoire without creating an account.
  html = html.replace('<script type="module" src="js/boot.js"></script>', "");
  const bridge = `
<script>
(function () {
  const go = (path) => { window.location.href = path; };
  function enterApp(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    try { localStorage.setItem("cb_entered", "1"); } catch {}
    go("/");
  }
  const topBar = document.querySelector(".fixed.top-0");
  const onScroll = () => {
    if (!topBar) return;
    const visible = window.scrollY > 140;
    topBar.classList.toggle("opacity-0", !visible);
    topBar.classList.toggle("pointer-events-none", !visible);
    topBar.classList.toggle("opacity-100", visible);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const logo = document.querySelector('header img[alt="Chessbook"]');
  if (logo) {
    logo.style.cursor = "pointer";
    logo.addEventListener("click", () => go("/"));
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("a,button,div.cursor-pointer");
    if (!el) return;
    const text = (el.innerText || "").trim();
    if (/^(Try it for free|Get started|Log in|Sign up)$/.test(text) && !el.closest("footer")) {
      enterApp(e); return;
    }
    if (el.closest("footer") && /privacy/i.test(text)) { e.preventDefault(); go("/legal/privacy"); }
    if (el.closest("footer") && /fulfillment/i.test(text)) { e.preventDefault(); go("/legal/fulfillment"); }
    if (el.tagName === "A" && el.getAttribute("href") === "../") { e.preventDefault(); go("/"); }
  }, true);
})();
</script>`;
  return html.replace("</body>", `${bridge}</body>`);
}

app.get("/signup/", (_req, res) => res.type("html").send(marketingHtml()));
app.get("/signup/index.html", (_req, res) => res.type("html").send(marketingHtml()));
app.get("/signup", (_req, res) => res.redirect("/signup/"));

app.use("/_build", express.static(join(root, "_build")));
app.use("/homepage_imgs", express.static(join(root, "homepage_imgs")));
app.use("/pieces", express.static(join(root, "pieces")));
app.use(
  "/signup",
  express.static(join(root, "signup"), { index: false })
);

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

app.listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
});
