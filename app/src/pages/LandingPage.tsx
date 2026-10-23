import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import landingHtml from "./landing-body.html?raw";

function enterLocalApp() {
  try {
    localStorage.setItem("cb_entered", "1");
  } catch {
    // The trainer still works for this visit when storage is unavailable.
  }
}

export function LandingPage() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Chessbook: Chess Opening Repertoire Builder & Trainer";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mark = (node: Element) => {
      if (!(node instanceof HTMLElement)) return;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const clickable =
        node.tagName === "BUTTON" ||
        node.tagName === "A" ||
        node.classList.contains("cursor-pointer");
      if (
        clickable &&
        (text === "Try it for free" ||
          text === "Get started" ||
          text === "Open app")
      ) {
        node.dataset.cbCta = "enter";
      }
      if (node.tagName === "A") {
        const href = node.getAttribute("href") || "";
        if (/privacy-policy/i.test(href)) node.dataset.cbCta = "privacy";
        if (/fulfillment_policy/i.test(href)) node.dataset.cbCta = "fulfillment";
      }
    };

    root.querySelectorAll("a,button,div").forEach(mark);

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const cta = target?.closest<HTMLElement>("[data-cb-cta]");
      if (!cta || starting) return;
      const action = cta.dataset.cbCta;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "privacy") {
        navigate("/legal/privacy");
      } else if (action === "fulfillment") {
        navigate("/legal/fulfillment");
      } else if (action === "enter") {
        setStarting(true);
        enterLocalApp();
        window.location.assign("/");
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
  }, [navigate, starting]);

  return (
    <>
      <div
        ref={rootRef}
        className="cb-landing"
        // The markup and utility CSS are the captured production landing page.
        dangerouslySetInnerHTML={{ __html: landingHtml }}
      />
      {starting && (
        <div className="cb-landing-overlay" role="status" aria-live="polite">
          <div className="cb-spinner" />
          <div>
            <strong>Opening your local repertoire</strong>
            <span>No account needed. Everything stays on this device.</span>
          </div>
        </div>
      )}
    </>
  );
}
