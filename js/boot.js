/*
 * Chessbook clone — thin interaction layer over the captured production DOM.
 *
 * The page markup and CSS are the real rendered app (see tools/build_pages.py).
 * This module adds only the behaviour the original SolidJS app would have:
 * routing, practice-board moves, and a few actions.
 */
const page = document.body.dataset.page || "";
const root = document.body.dataset.root || "./";

/* ------------------------------------------------------------------ ui --- */
const style = document.createElement("style");
style.textContent = `
  .cb-toast {
    position: fixed; left: 50%; bottom: 34px; z-index: 100000;
    transform: translate(-50%, 10px);
    display: flex; align-items: center; gap: 8px;
    max-width: calc(100vw - 32px);
    padding: 10px 16px; border-radius: 8px;
    background: oklch(0.24 0.006 243); color: #f5f5f5;
    border: 1px solid oklch(0.34 0.008 243);
    box-shadow: 0 10px 30px rgba(0,0,0,.45);
    font: 500 13px/1.3 Inter, system-ui, sans-serif;
    opacity: 0; pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease;
  }
  .cb-toast.show { opacity: 1; transform: translate(-50%, 0); }
  .cb-toast .cb-dot { width: 8px; height: 8px; border-radius: 999px; background: #65c466; }
  .cb-toast.bad .cb-dot { background: #e05a5a; }
  .cb-overlay {
    position: absolute; inset: 0; pointer-events: none; z-index: 20;
  }
  .cb-sel { box-shadow: inset 0 0 0 4px rgba(120, 235, 120, .9); }
  .cb-target::after {
    content: ""; position: absolute; left: 50%; top: 50%;
    width: 28%; height: 28%; transform: translate(-50%, -50%);
    border-radius: 999px; background: rgba(15, 20, 18, .38);
  }
  .cb-target.has-piece::after {
    width: 92%; height: 92%; background: transparent;
    border: 5px solid rgba(15, 20, 18, .34);
  }
  .cb-correct { animation: cb-correct 520ms ease; }
  .cb-wrong { animation: cb-wrong 420ms ease; }
  @keyframes cb-correct {
    0% { box-shadow: inset 0 0 0 7px rgba(100, 230, 110, .95); }
    100% { box-shadow: inset 0 0 0 0 rgba(100, 230, 110, 0); }
  }
  @keyframes cb-wrong {
    0%, 100% { box-shadow: inset 0 0 0 0 rgba(235, 85, 85, 0); }
    30% { box-shadow: inset 0 0 0 7px rgba(235, 85, 85, .95); }
    65% { box-shadow: inset 0 0 0 7px rgba(235, 85, 85, .55); }
  }
  .cb-piece-move { transition: left 130ms ease, top 130ms ease; }
  .cb-answer { opacity: .55 !important; }
  #chessboard { touch-action: manipulation; }
`;
document.head.appendChild(style);

let toastTimer = 0;
function toast(message, kind = "ok") {
  let el = document.querySelector(".cb-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "cb-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = '<span class="cb-dot"></span><span class="cb-msg"></span>';
    document.body.appendChild(el);
  }
  el.classList.toggle("bad", kind === "bad");
  el.querySelector(".cb-msg").textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* -------------------------------------------------------------- routing --- */
function go(route) {
  if (!route) return;
  if (/^(https?:|mailto:|#|\/|\.\.\/)/.test(route)) {
    location.href = route;
    return;
  }
  location.href = root + route.replace(/^\.\//, "");
}

function goBack(fallback = "index.html") {
  // The real app's sidebar back button follows the screen hierarchy, so use
  // the explicit per-page fallback instead of browser history.
  go(fallback || "index.html");
}

const textRoutes = {
  "White openings": "repertoire-white.html",
  "Black openings": "repertoire-black.html",
  "Build": "build-white.html",
  "Learn": "learn-white.html",
  "Practice": "practice-white.html",
  "Model games": "model.html",
  "Add new": "add.html",
  "Start adding moves": "add.html",
  "Import": "add.html",
  "Create repertoire": "build-white.html",
  "Settings": "settings.html",
};

/* --------------------------------------------------------------- actions --- */
function fillGap() {
  toast("Autofilling the gap…");
  setTimeout(() => go("build-white.html"), 750);
}

/* --------------------------------------------------------------- practice --- */
let practice = null;

function boardPieces() {
  const pieces = {};
  document.querySelectorAll('[data-testid^="piece-"]').forEach((el) => {
    const square = el.dataset.testid.slice(6);
    const src = el.querySelector("img")?.getAttribute("src") || "";
    const m = src.match(/([wb])([PNBRQK])\.svg/);
    if (m) pieces[square] = m[1] === "w" ? m[2] : m[2].toLowerCase();
  });
  return pieces;
}

function fenFromBoard(turn) {
  const pieces = boardPieces();
  const files = "abcdefgh";
  const ranks = "87654321";
  let placement = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = pieces[files[f] + ranks[r]];
      if (!piece) {
        empty++;
      } else {
        if (empty) {
          placement += empty;
          empty = 0;
        }
        placement += piece;
      }
    }
    if (empty) placement += empty;
    if (r < 7) placement += "/";
  }
  let castling = "";
  if (pieces.e1 === "K" && pieces.h1 === "R") castling += "K";
  if (pieces.e1 === "K" && pieces.a1 === "R") castling += "Q";
  if (pieces.e8 === "k" && pieces.h8 === "r") castling += "k";
  if (pieces.e8 === "k" && pieces.a8 === "r") castling += "q";
  return `${placement} ${turn} ${castling || "-"} - 0 1`;
}

function squareEl(square) {
  return document.querySelector(`[data-testid="square-${square}"]`);
}

function pieceEl(square) {
  return document.getElementById(`piece-${square}`);
}

function setPiece(square, el) {
  el.id = `piece-${square}`;
  el.dataset.testid = `piece-${square}`;
  const file = "abcdefgh".indexOf(square[0]);
  const rank = Number(square[1]);
  el.style.left = `${file * 12.5}%`;
  el.style.top = `${(8 - rank) * 12.5}%`;
}

function moveDom(move) {
  const fromEl = pieceEl(move.from);
  if (!fromEl) return;

  const captured = pieceEl(move.to);
  if (captured) captured.remove();

  if (move.flags.includes("e")) {
    const capturedSquare = move.to[0] + move.from[1];
    pieceEl(capturedSquare)?.remove();
  }

  fromEl.classList.add("cb-piece-move");
  setPiece(move.to, fromEl);
  setTimeout(() => fromEl.classList.remove("cb-piece-move"), 180);

  if (move.flags.includes("k") || move.flags.includes("q")) {
    const rank = move.color === "w" ? "1" : "8";
    const rookFrom = move.flags.includes("k") ? `h${rank}` : `a${rank}`;
    const rookTo = move.flags.includes("k") ? `f${rank}` : `d${rank}`;
    const rook = pieceEl(rookFrom);
    if (rook) {
      rook.classList.add("cb-piece-move");
      setPiece(rookTo, rook);
      setTimeout(() => rook.classList.remove("cb-piece-move"), 180);
    }
  }

  if (move.promotion) {
    const img = fromEl.querySelector("img");
    if (img) {
      const color = move.color === "w" ? "w" : "b";
      img.src = `pieces/chessbook_monochrome/${color}${move.promotion.toUpperCase()}.svg`;
    }
  }
}

function clearHints() {
  document.querySelectorAll(".cb-sel").forEach((el) => el.classList.remove("cb-sel"));
  document.querySelectorAll(".cb-target").forEach((el) => {
    el.classList.remove("cb-target", "has-piece");
  });
}

function showHints(square, moves) {
  clearHints();
  squareEl(square)?.classList.add("cb-sel");
  moves.forEach((m) => {
    const el = squareEl(m.to);
    if (!el) return;
    el.classList.add("cb-target");
    if (m.captured) el.classList.add("has-piece");
  });
}

function flash(square, ok) {
  const el = squareEl(square);
  if (!el) return;
  el.classList.remove("cb-correct", "cb-wrong");
  void el.offsetWidth;
  el.classList.add(ok ? "cb-correct" : "cb-wrong");
  setTimeout(() => el.classList.remove("cb-correct", "cb-wrong"), 620);
}

async function initPractice() {
  const board = document.querySelector('[data-testid="chessboard"]');
  const expectedEl = document.querySelector('[data-testid="expected-move"]');
  if (!board || !expectedEl) return;

  const expected = expectedEl.dataset.expectedSan || "";
  const { Chess } = await import("./vendor/chess.js");

  let chess = null;
  let expectedMove = null;
  for (const turn of ["w", "b"]) {
    try {
      const trial = new Chess(fenFromBoard(turn));
      const found = trial.moves({ verbose: true }).find((m) => m.san === expected);
      if (found) {
        chess = trial;
        expectedMove = found;
        break;
      }
    } catch (e) {
      /* ignore malformed positions */
    }
  }
  if (!chess) {
    try {
      chess = new Chess(fenFromBoard("w"));
    } catch (e) {
      return;
    }
  }

  practice = { board, chess, expected, expectedMove, selected: null, done: false };
  const selected = { value: null };
  let legal = [];

  const updateTray = () => {
    const row = document.querySelector('[data-testid="repertoire-move-row-0"]');
    if (row) {
      const p = [...row.querySelectorAll("p")].find((p) => p.textContent.includes("＿"));
      if (p) p.textContent = p.textContent.replace("＿", expected);
    }
  };

  const attempt = (move) => {
    if (practice.done) return;
    const made = chess.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    if (!made) return;
    moveDom(made);
    clearHints();
    selected.value = null;
    if (made.san === expected || made.from === expectedMove?.from && made.to === expectedMove?.to) {
      practice.done = true;
      flash(made.to, true);
      toast(`Correct — ${expected}.`);
      updateTray();
      board.classList.add("cb-solved");
    } else {
      flash(made.to, false);
      toast(`Not quite — that was ${made.san}.`, "bad");
      // Undo, both in the model and in the DOM.
      chess.undo();
      setTimeout(() => {
        const el = pieceEl(made.to);
        if (el) setPiece(made.from, el);
        if (made.captured) {
          const restored = document.createElement("div");
          restored.className = "absolute pointer-events-none";
          restored.style.cssText = "width:12.5%;height:12.5%;z-index:5;";
          const color = made.color === "w" ? "b" : "w";
          restored.innerHTML = `<div class="h-full w-full" style="transform-origin: center bottom;"><img alt="" draggable="false" class="h-full w-full" src="pieces/chessbook_monochrome/${color}${made.captured.toUpperCase()}.svg" style="pointer-events:none;"></div>`;
          setPiece(made.to, restored);
          document.getElementById("pieces-layer")?.appendChild(restored);
        }
      }, 380);
    }
  };

  board.addEventListener("click", (event) => {
    if (practice.done) return;
    // The production board puts a transparent pointer surface above the
    // square grid, so resolve the clicked square from coordinates.
    const rect = board.getBoundingClientRect();
    const file = Math.max(0, Math.min(7, Math.floor((event.clientX - rect.left) / (rect.width / 8))));
    const rank = Math.max(0, Math.min(7, Math.floor((event.clientY - rect.top) / (rect.height / 8))));
    const square = "abcdefgh"[file] + (8 - rank);
    const piece = chess.get(square);

    if (!selected.value) {
      if (piece && piece.color === chess.turn()) {
        selected.value = square;
        legal = chess.moves({ square, verbose: true });
        showHints(square, legal);
      }
      return;
    }

    if (square === selected.value) {
      selected.value = null;
      clearHints();
      return;
    }

    const move = legal.find((m) => m.to === square);
    if (move) {
      attempt(move);
      return;
    }

    if (piece && piece.color === chess.turn()) {
      selected.value = square;
      legal = chess.moves({ square, verbose: true });
      showHints(square, legal);
    } else {
      selected.value = null;
      clearHints();
      flash(square, false);
    }
  });
}

function showAnswer() {
  if (!practice) {
    go("learn-white.html");
    return;
  }
  if (practice.done) {
    toast(`The move was ${practice.expected}.`);
    return;
  }
  const move = practice.expectedMove;
  if (!move) {
    toast("No answer available.", "bad");
    return;
  }
  const made = practice.chess.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
  if (!made) return;
  moveDom(made);
  clearHints();
  practice.done = true;
  flash(made.to, true);
  toast(`The move is ${practice.expected}.`);
  const row = document.querySelector('[data-testid="repertoire-move-row-0"]');
  const p = row && [...row.querySelectorAll("p")].find((p) => p.textContent.includes("＿"));
  if (p) p.textContent = p.textContent.replace("＿", practice.expected);
}

/* ------------------------------------------------------------------ init --- */
function initTextRoutes() {
  // Convert the empty logo button into a home link.
  const logo = [...document.querySelectorAll("button")].find((button) => {
    const r = button.getBoundingClientRect();
    return r.width > 0 && r.width < 44 && r.y < 120 && r.x < 220 && !button.textContent.trim();
  });
  if (logo && !logo.closest('[data-testid="chessboard"]')) {
    logo.dataset.nav = "index.html";
    logo.style.cursor = "pointer";
  }

  // Top-right Settings.
  document.querySelectorAll("button").forEach((button) => {
    const r = button.getBoundingClientRect();
    if (button.innerText.trim() === "Settings" && r.y < 120) {
      button.dataset.nav = page === "settings.html" ? "" : "settings.html";
    }
  });

  // Sidebar rows that were rendered without a data-testid.
  const textActions = [
    ["Play through a model game", "model.html"],
    ["View model game", "model.html"],
    ["Add new", "add.html"],
    ["Autofill remaining gaps", "gap-white.html"],
    ["Autofill all moves", "gap-white.html"],
  ];
  for (const [text, route] of textActions) {
    const p = [...document.querySelectorAll("p,div")].find(
      (el) => el.children.length === 0 && el.textContent.trim() === text
    );
    if (!p) continue;
    const clickable = p.closest(".sidebar-button, .cursor-pointer") || p.parentElement;
    if (clickable) {
      clickable.dataset.nav = route;
      clickable.style.cursor = "pointer";
    }
  }
}

function handleClick(event) {
  const navEl = event.target.closest("[data-nav]");
  if (navEl && navEl.dataset.nav) {
    event.preventDefault();
    event.stopPropagation();
    go(navEl.dataset.nav);
    return true;
  }

  const actionEl = event.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === "back") {
      event.preventDefault();
      goBack(actionEl.dataset.back || "index.html");
      return true;
    }
    if (action === "autofill") {
      event.preventDefault();
      fillGap();
      return true;
    }
    if (action === "show-answer") {
      event.preventDefault();
      showAnswer();
      return true;
    }
  }

  const clickable = event.target.closest("button,a,[role=button],.cursor-pointer");
  if (!clickable) return false;
  const text = clickable.innerText.trim();

  if (text === "Back") {
    event.preventDefault();
    goBack(clickable.dataset.back || "index.html");
    return true;
  }
  if (textRoutes[text]) {
    if (page === textRoutes[text]) return true;
    event.preventDefault();
    go(textRoutes[text]);
    return true;
  }
  if (/^Autofill/.test(text)) {
    event.preventDefault();
    fillGap();
    return true;
  }
  if (/I don't know, show me the answer/i.test(text)) {
    event.preventDefault();
    showAnswer();
    return true;
  }
  if (text === "Continue building") {
    event.preventDefault();
    go("build-white.html");
    return true;
  }
  if (text === "Continue learning") {
    event.preventDefault();
    go("learn-white.html");
    return true;
  }
  if (text.startsWith("Go to your biggest gap")) {
    event.preventDefault();
    go("gap-white.html");
    return true;
  }
  if (text.startsWith("Play through a model game")) {
    event.preventDefault();
    go("model.html");
    return true;
  }
  return false;
}

function main() {
  const mobile = matchMedia("(max-width: 767px)").matches;
  const mobileScreens = new Set([
    "index.html", "repertoire-white.html", "repertoire-black.html",
    "build-white.html", "gap-white.html", "learn-white.html",
    "practice-white.html", "settings.html", "model.html", "add.html",
  ]);
  if (mobile && mobileScreens.has(page) && !location.pathname.includes("/m/")) {
    location.replace(root + "m/" + page);
    return;
  }
  document.addEventListener("click", handleClick, true);
  initTextRoutes();
  if (page === "practice-white.html") initPractice();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
