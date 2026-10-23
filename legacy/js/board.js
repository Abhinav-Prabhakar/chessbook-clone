import { Chess } from "./vendor/chess.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

export function fenFromMoves(moves = [], start = undefined) {
  const c = new Chess(start);
  for (const m of moves) {
    try { c.move(m); } catch (e) { break; }
  }
  return c.fen();
}

export function pgnPosition(pgn, halfMoves = 999) {
  const c = new Chess();
  try { c.loadPgn(pgn); } catch (e) { return { fen: c.fen(), lastMove: null }; }
  const hist = c.history({ verbose: true });
  const take = hist.slice(0, halfMoves);
  const d = new Chess();
  for (const h of take) d.move({ from: h.from, to: h.to, promotion: h.promotion });
  const last = take[take.length - 1];
  return { fen: d.fen(), lastMove: last ? [last.from, last.to] : null };
}

/**
 * Render an 8x8 chessboard.
 * options: fen, orientation, lastMove [from,to], highlights [squares],
 *          interactive, onMove(from,to,promotion), feedback {square,type}
 */
export function renderBoard(root, options = {}) {
  const {
    fen = new Chess().fen(),
    orientation = "white",
    lastMove = null,
    highlights = [],
    interactive = false,
    onMove = null,
    feedback = null,
    checkSquare = null,
  } = options;

  const chess = new Chess(fen);
  const board = chess.board();
  const rows = orientation === "white" ? board : [...board].reverse();
  const files = orientation === "white" ? FILES : [...FILES].reverse();
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();

  root.innerHTML = "";
  root.classList.add("chessboard");

  rows.forEach((row, ri) => {
    files.forEach((file, fi) => {
      const piece = row[fi];
      const rank = ranks[ri];
      const square = `${file}${rank}`;
      const isLight = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
      const sq = document.createElement("div");
      sq.className = `sq ${isLight ? "light" : "dark"}`;
      sq.dataset.square = square;

      if (lastMove && lastMove.includes(square)) {
        const hl = document.createElement("div");
        hl.className = "hl";
        sq.appendChild(hl);
      }
      if (highlights && highlights.includes(square)) {
        const hl = document.createElement("div");
        hl.className = "hl";
        sq.appendChild(hl);
      }
      if (feedback && feedback.square === square) {
        sq.classList.add(feedback.type === "bad" ? "feedback-bad" : "feedback-good");
      }
      if (checkSquare === square) sq.classList.add("in-check");

      if (piece) {
        const img = document.createElement("img");
        img.className = "piece";
        img.src = `assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg`;
        img.alt = `${piece.color === "w" ? "White" : "Black"} ${piece.type}`;
        img.draggable = false;
        sq.appendChild(img);
      }

      const isBottom = ri === 7;
      const isRight = fi === 7;
      if (isBottom || isRight || true) {
        if (isBottom) {
          const c = document.createElement("span");
          c.className = "coord file";
          c.textContent = file;
          sq.appendChild(c);
        }
        if (isRight) {
          const c = document.createElement("span");
          c.className = "coord rank";
          c.textContent = rank;
          sq.appendChild(c);
        }
      }

      if (interactive) {
        sq.classList.add("movable");
        sq.addEventListener("click", () => handleClick(square));
      }
      root.appendChild(sq);
    });
  });

  let selected = null;
  let game = new Chess(fen);

  function clearMarks() {
    root.querySelectorAll(".selected,.legal-dot,.legal-ring").forEach((n) => n.remove());
    root.querySelectorAll(".sq.selected").forEach((n) => n.classList.remove("selected"));
  }

  function paintLegal(from) {
    const moves = game.moves({ square: from, verbose: true });
    for (const m of moves) {
      const sq = root.querySelector(`.sq[data-square="${m.to}"]`);
      if (!sq) continue;
      if (sq.querySelector(".piece")) {
        const ring = document.createElement("span");
        ring.className = "legal-ring";
        sq.appendChild(ring);
      } else {
        const dot = document.createElement("span");
        dot.className = "legal-dot";
        sq.appendChild(dot);
      }
    }
  }

  function handleClick(square) {
    if (!onMove) return;
    const selectedSq = root.querySelector(".sq.selected");
    if (selected) {
      if (square === selected) { clearMarks(); selected = null; return; }
      const move = game.moves({ square: selected, verbose: true }).find((m) => m.to === square);
      if (move) {
        const from = selected;
        clearMarks();
        selected = null;
        onMove(from, square, move.promotion);
        return;
      }
    }
    const piece = game.get(square);
    if (piece && (game.turn() === piece.color)) {
      clearMarks();
      selected = square;
      root.querySelector(`.sq[data-square="${square}"]`).classList.add("selected");
      paintLegal(square);
    }
  }

  return { chess: game };
}

export function boardFromFen(fen) { return new Chess(fen); }
