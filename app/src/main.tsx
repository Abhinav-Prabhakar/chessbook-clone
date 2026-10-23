import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

// The app never shows its own install banner or modal. Suppress the browser's
// automatic mini-infobar too; installation remains available from the browser
// or operating-system menu.
window.addEventListener("beforeinstallprompt", (event) => event.preventDefault());

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Offline support is an enhancement; the trainer still works online.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
