import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import landingHtml from "./landing/body.html?raw";
import entryCss from "./landing/entry.css.txt?raw";
import appCss from "./landing/app.css.txt?raw";

// Font URLs in the captured stylesheet are relative to /assets.
const LANDING_CSS = `${entryCss}\n${appCss}`.replace(/url\((?!["']?(?:\/|data:|https?:))(["']?)/g, "url($1/assets/");

/** The marketing page. Its stylesheet is only loaded while it is shown. */
export function LandingPage() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.landing = "1";
    style.textContent = LANDING_CSS;
    document.head.appendChild(style);
    document.body.classList.add("landing-mode");
    const title = document.title;
    document.title = "Chessbook: Chess Opening Repertoire Builder & Trainer";
    return () => {
      style.remove();
      document.body.classList.remove("landing-mode");
      document.title = title;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const enter = () => {
      try {
        localStorage.setItem("cb_entered", "1");
      } catch {
        // ignore
      }
      navigate("/");
    };
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest("a, button, .cursor-pointer") as HTMLElement | null;
      if (!target) return;
      const text = (target.textContent || "").replace(/\s+/g, " ").trim();
      const href = target.getAttribute("href") || "";
      if (/^(Try it for free|Get started|Open app)/i.test(text)) {
        event.preventDefault();
        enter();
      } else if (/privacy-policy/.test(href)) {
        event.preventDefault();
        navigate("/legal/privacy");
      } else if (/fulfillment_policy/.test(href)) {
        event.preventDefault();
        navigate("/legal/terms");
      } else if (href === "/openings" || href.startsWith("/openings?")) {
        event.preventDefault();
        try {
          localStorage.setItem("cb_entered", "1");
        } catch {
          // ignore
        }
        navigate("/openings");
      } else if (href === "/blog" || href === "/coaches") {
        event.preventDefault();
        enter();
      }
    };
    const onScroll = () => {
      const bar = root.querySelector<HTMLElement>(".fixed.top-0");
      if (!bar) return;
      const visible = window.scrollY > 140;
      bar.classList.toggle("opacity-0", !visible);
      bar.classList.toggle("pointer-events-none", !visible);
      bar.classList.toggle("opacity-100", visible);
    };
    root.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      root.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
    };
  }, [navigate]);

  return <div ref={rootRef} className="cb-landing" dangerouslySetInnerHTML={{ __html: landingHtml }} />;
}
