import { state, save, setState } from "./state.js";
import { icon, toast } from "./ui.js";
import * as S from "./screens.js";
import { renderBoard, fenFromMoves } from "./board.js";

const app = document.getElementById("app");

const routes = [
  { re: /^\/?$/, fn: () => S.dashboard(), name: "dashboard" },
  { re: /^\/dashboard$/, fn: () => S.dashboard(), name: "dashboard" },
  { re: /^\/repertoire\/(white|black)$/, fn: (m) => S.repertoire({ color: m[1] }), name: "repertoire" },
  { re: /^\/build\/(white|black)$/, fn: (m) => S.build({ color: m[1] }), name: "build" },
  { re: /^\/gap\/(white|black)$/, fn: (m) => S.gap({ color: m[1] }), name: "gap" },
  { re: /^\/learn\/(white|black)$/, fn: (m) => S.learn({ color: m[1] }), name: "learn" },
  { re: /^\/practice\/(white|black)$/, fn: (m) => S.practice({ color: m[1] }), name: "practice" },
  { re: /^\/settings$/, fn: () => S.settings(), name: "settings" },
  { re: /^\/model$/, fn: () => S.model(), name: "model" },
  { re: /^\/add$/, fn: () => S.addRepertoire(), name: "add" },
  { re: /^\/login$/, fn: () => S.login(), name: "login" },
  { re: /^\/welcome$/, fn: () => S.welcome(), name: "welcome" },
  { re: /^\/onboarding\/rating$/, fn: () => S.onboardingRating(), name: "onboarding-rating" },
  { re: /^\/onboarding\/first$/, fn: () => S.onboardingFirst(), name: "onboarding-first" },
  { re: /^\/upgrade$/, fn: () => S.dashboard(), name: "upgrade" },
];

export function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const [pathname, query] = raw.split("?");
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (m) return { ...r, params: m, query: new URLSearchParams(query || "") };
  }
  return { ...routes[0], params: [""], query: new URLSearchParams() };
}

function shell(screen, route) {
  const topRight = screen.topRight || `<button class="top-link" data-nav="#/settings">Settings ${icon("gear")}</button>`;
  return `
  <div class="app-viewport">
    <div class="app-layout">
      <div class="board-col">
        ${screen.breadcrumb || ""}
        <div class="board-wrap"><div id="board"></div></div>
        ${screen.footer || ""}
      </div>
      <div class="app-gutter"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-top">${topRight}</div>
        <div class="sidebar-scroll" id="sidebar-scroll">${screen.sidebar}</div>
      </aside>
    </div>
  </div>`;
}

let practiceState = { correct: 0, wrong: 0, solved: false, fen: fenFromMoves(["e4", "c5"]) };

function render() {
  const route = parseRoute();
  const screen = route.fn(route.params);
  app.innerHTML = shell(screen, route);
  document.title = "Chessbook: Chess Opening Repertoire Builder & Trainer";

  const b = screen.board || { fen: fenFromMoves([]) };
  const boardEl = document.getElementById("board");
  renderBoard(boardEl, {
    fen: b.fen,
    orientation: b.orientation || "white",
    lastMove: b.lastMove || null,
    interactive: !!b.interactive,
    onMove: b.practice ? (from, to, promotion) => handlePracticeMove(from, to, promotion, screen) : null,
  });

  // scroll top on navigation
  const sc = document.getElementById("sidebar-scroll");
  if (sc) sc.scrollTop = 0;

  if (route.name === "practice") {
    practiceState = { correct: 0, wrong: 0, solved: false, fen: fenFromMoves(["e4", "c5"]) };
  }
  window.scrollTo(0, 0);
}

function handlePracticeMove(from, to, promotion, screen) {
  const isCorrect = from === "g1" && to === "f3";
  const boardEl = document.getElementById("board");
  if (isCorrect) {
    practiceState.correct++;
    practiceState.solved = true;
    practiceState.fen = fenFromMoves(["e4", "c5", "Nf3", "d6"]);
    renderBoard(boardEl, { fen: practiceState.fen, lastMove: ["f3", "d6"], interactive: true, onMove: (f, t, p) => handlePracticeMove(f, t, p, screen) });
    updatePracticeStats();
    toast("Correct!", "Nf3 — King's Knight Opening", "circle-check");
    const blank = document.querySelector(".pm-blank");
    if (blank) blank.textContent = "Nf3";
    const notes = document.querySelector(".notes-empty");
    if (notes) notes.textContent = "The most natural move, developing the Knight with tempo.";
  } else {
    practiceState.wrong++;
    updatePracticeStats();
    toast("Not quite", "The correct move is Nf3", "circle-xmark");
    const sq = document.querySelector(`.sq[data-square="${to}"]`);
    if (sq) { sq.classList.add("feedback-bad"); setTimeout(() => sq.classList.remove("feedback-bad"), 900); }
  }
}

function updatePracticeStats() {
  const el = document.querySelector(".practice-stats");
  if (!el) return;
  el.innerHTML = `<span>6 Due <span class="icon-badge orange">${icon("clock")}</span></span>
    <span>${practiceState.correct} <span class="icon-badge green">${icon("circle-check")}</span></span>
    <span>${practiceState.wrong} <span class="icon-badge red">${icon("circle-xmark")}</span></span>`;
}

/* ── actions ───────────────────────────────────────────────────────────── */
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    e.preventDefault();
    const href = nav.getAttribute("data-nav");
    if (href) location.hash = href;
    return;
  }
  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.getAttribute("data-action");
  e.preventDefault();
  handleAction(action, actionEl);
});

function modal(titleText, bodyHtml, actions = "") {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal"><div class="modal-head"><h2 class="modal-title">${titleText}</h2><button class="top-link" data-close>${icon("xmark")}</button></div><div class="modal-body">${bodyHtml}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ""}</div>`;
  ov.addEventListener("click", (e) => {
    if (e.target === ov || e.target.closest("[data-close]")) ov.remove();
  });
  document.body.appendChild(ov);
  return ov;
}

function handleAction(action, el) {
  switch (action) {
    case "back": {
      const map = {
        "repertoire": "#/dashboard", "build": "#/repertoire/white", "gap": "#/build/white",
        "learn": "#/repertoire/white", "practice": "#/learn/white", "settings": "#/dashboard",
        "model": "#/dashboard", "add": "#/dashboard", "login": "#/dashboard",
        "welcome": "#/login", "onboarding-rating": "#/welcome", "onboarding-first": "#/onboarding/rating",
      };
      const r = parseRoute().name;
      location.hash = map[r] || "#/dashboard";
      break;
    }
    case "add-repertoire": location.hash = "#/add"; break;
    case "autofill":
    case "autofill-gap":
      modal("Autofill this gap", `<p>Let Chessbook fill this gap for you. Pick a style and we'll choose a complete, sound set of moves.</p>
        <div class="modal-choice-list">
          <button class="choice-row selected"><span>Solid &amp; positional</span><span>Recommended</span></button>
          <button class="choice-row"><span>Sharp &amp; aggressive</span></button>
          <button class="choice-row"><span>Surprise weapon</span></button>
        </div>`, `<button class="btn-ghost" data-close>Cancel</button><button class="btn-orange" data-close>Autofill</button>`);
      break;
    case "show-more": setState({ showAllGap: !state.showAllGap }); render(); break;
    case "notes":
      modal("Notes", `<p>Add a note to remember the ideas behind this position.</p><textarea class="text-input" style="height:110px;padding:10px 12px;resize:vertical" placeholder="Add your note..."></textarea>`, `<button class="btn-ghost" data-close>Cancel</button><button class="btn-orange" data-close>Save note</button>`);
      break;
    case "plans":
      modal("Middlegame plans", `<p><strong>White typically castles kingside</strong> and finishes development before opening the center.</p><ul class="plan-list"><li>The bishop on g5 generally captures the knight on f6.</li><li>The knight on a3 often moves to c2.</li><li>Common pawn moves are c3, c4, g3, and h4.</li></ul>`, `<button class="btn-ghost" data-close>Close</button>`);
      break;
    case "show-answer": {
      const to = document.querySelector('.sq[data-square="f3"]');
      const from = document.querySelector('.sq[data-square="g1"]');
      if (from) from.classList.add("selected");
      if (to) {
        const dot = document.createElement("span");
        dot.className = "legal-dot";
        to.appendChild(dot);
      }
      toast("The answer is Nf3", "Develops the knight and controls the center.", "lightbulb");
      break;
    }
    case "connect":
      toast("Connect your account", "Link Chess.com or Lichess in Settings to review your games.", "link");
      break;
    case "discord": window.open("https://discord.gg/vNzfu5VetQ", "_blank"); break;
    case "feedback": toast("Thanks!", "Feedback is always welcome.", "comment"); break;
    case "share": toast("Tell a friend", "Share Chessbook with your chess club.", "share-nodes"); break;
    case "logout": setState({ loggedIn: false }); location.hash = "#/login"; break;
    case "choose-color": {
      document.querySelectorAll(".choice-row[data-action=choose-color]").forEach((r) => r.classList.remove("selected"));
      el.classList.add("selected");
      const chk = el.querySelector("i");
      document.querySelectorAll(".choice-row[data-action=choose-color] i").forEach((i) => i.remove());
      el.insertAdjacentHTML("beforeend", icon("check"));
      break;
    }
    case "create-repertoire": toast("Repertoire created", "Your new Blitz repertoire is ready.", "circle-check"); location.hash = "#/dashboard"; break;
    case "create": location.hash = "#/login"; break;
    case "subscribe":
      modal("Chessbook Pro", `<p>You already have full access. Unlimited moves, unlimited depth, and every premium training feature are unlocked.</p>`, `<button class="btn-orange" data-close>Great</button>`);
      break;
    case "subscription":
      modal("Chessbook Pro", `<p>Your Pro subscription is active. You have unlimited moves at any depth, model games, game review, and all training modes.</p>`, `<button class="btn-orange" data-close>Done</button>`);
      break;
    case "reset-learning":
      modal("Reset all learning", `<p>This will clear your spaced-repetition history. Your repertoire moves will stay intact.</p>`, `<button class="btn-ghost" data-close>Cancel</button><button class="btn-orange" data-close>Reset</button>`);
      break;
    case "delete-account":
      modal("Delete your account", `<p>This permanently deletes your account and all repertoires. This cannot be undone.</p>`, `<button class="btn-ghost" data-close>Cancel</button><button class="btn-orange" data-close style="background:var(--red)">Delete</button>`);
      break;
    default:
      if (["set-rating","set-coverage","connections","model-source","early-access","practice-mode","daily-goal","pause-setting","appearance","animation","sound","haptics","platform","time-control"].includes(action)) {
        toast("Setting", "This option will be configurable here.", "gear");
      }
      break;
  }
}

document.addEventListener("submit", (e) => {
  if (e.target.matches('[data-form="login"]')) {
    e.preventDefault();
    const email = document.getElementById("email")?.value || state.user.email;
    setState({ loggedIn: true, user: { ...state.user, email } });
    toast("Welcome back", "You're signed in to Chessbook.", "circle-check");
    location.hash = "#/dashboard";
  }
});

window.addEventListener("hashchange", render);
render();

/* small global helpers used by screens moved into app scope where needed */
window.__cb = { render, toast };
