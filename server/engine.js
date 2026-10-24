/**
 * Stockfish 19 engine service (audit D203).
 *
 * The npm `stockfish` package ships Stockfish 19 compiled to WebAssembly. A
 * single-threaded "lite" build is the default: it starts in a few hundred
 * milliseconds, needs no cross-origin isolation, and is far stronger than any
 * human. This module owns one lazy child process, speaks UCI to it, serialises
 * every request, and never spawns anything at import time.
 *
 * Contract:
 *   analyse(fen, { depth, multipv }) -> lines + best move + White-POV eval
 *   bestMove(fen, { depth })
 *   evaluate(fen, { depth })
 *   refute(fen, playedSan, { depth })
 *   reviewGame(fens, { depth })
 *   status(), close()
 *
 * If the binary cannot start (missing package, sandbox, wasm failure) every
 * call resolves to `{ available: false, reason, engine }`. Callers must fall
 * back explicitly; nothing here fabricates an evaluation.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export const ENGINE_NAME = "Stockfish 19 Lite WASM";
export const ENGINE_VERSION = "19";

const DEFAULT_DEPTH = Math.max(1, Math.min(30, Number(process.env.CHESSBOOK_ENGINE_DEPTH) || 12));
const MAX_DEPTH = 30;
const REQUEST_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.CHESSBOOK_ENGINE_TIMEOUT_MS) || 20000
);

/** Candidate binaries, strongest/simplest first. */
const BINARY_CANDIDATES = [
  process.env.CHESSBOOK_STOCKFISH_PATH,
  join(root, "node_modules", "stockfish", "bin", "stockfish-19-lite-single.js"),
  join(root, "node_modules", "stockfish", "bin", "stockfish-19-lite.js"),
  join(root, "node_modules", "stockfish", "bin", "stockfish-19-single.js"),
  join(root, "node_modules", "stockfish", "bin", "stockfish-19-asm.js"),
];

export function enginePath() {
  if (process.env.CHESSBOOK_ENGINE_DISABLED === "1") return null;
  for (const candidate of BINARY_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const memoryCache = new Map();
const MEMORY_CACHE_LIMIT = 800;

function cacheKey(fen, depth, multipv) {
  return `${depth}|${multipv}|${fen}`;
}

function memoryGet(key) {
  const value = memoryCache.get(key);
  if (value) {
    // Refresh LRU position.
    memoryCache.delete(key);
    memoryCache.set(key, value);
  }
  return value || null;
}

function memorySet(key, value) {
  memoryCache.set(key, value);
  if (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
}

function engineInfo() {
  return {
    name: ENGINE_NAME,
    version: ENGINE_VERSION,
    id: `${ENGINE_NAME} (Stockfish ${ENGINE_VERSION})`,
    protocol: "uci",
    path: enginePath(),
  };
}

/* --------------------------------------------------------------- worker --- */

class UciWorker {
  constructor(path) {
    this.path = path;
    this.child = null;
    this.ready = null;
    this.state = "idle"; // idle | starting | ready | failed | closed
    this.failure = null;
    this.listeners = new Set();
    this.stderr = [];
    this.uciId = null;
    this.options = new Map();
    this.startedAt = null;
    this.requests = 0;
  }

  _emit(line) {
    for (const listener of this.listeners) listener(line);
  }

  _onLine(line) {
    this._emit(line);
  }

  async start() {
    if (this.state === "ready") return this;
    if (this.state === "failed") throw this.failure || new Error("engine failed");
    if (this.ready) return this.ready;

    const path = this.path;
    if (!path) {
      this.state = "failed";
      this.failure = Object.assign(new Error("Stockfish binary not found"), {
        code: "engine_missing",
      });
      throw this.failure;
    }

    this.state = "starting";
    this.ready = new Promise((resolvePromise, reject) => {
      let settled = false;
      let timer = null;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) {
          this.state = "failed";
          this.failure = error;
          reject(error);
        } else {
          this.state = "ready";
          this.startedAt = new Date().toISOString();
          resolvePromise(this);
        }
      };

      let child;
      try {
        child = spawn(process.execPath, [path], {
          cwd: root,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        finish(error);
        return;
      }
      this.child = child;

      let buffer = "";
      const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          if (line.startsWith("id name ")) this.uciId = line.slice(8).trim();
          if (line.startsWith("option name ")) {
            const match = /^option name (.+?) type (\S+)/.exec(line);
            if (match) this.options.set(match[1], match[2]);
          }
          this._onLine(line);
          if (line === "uciok") {
            this._send("setoption name MultiPV value 1");
            this._send("setoption name UCI_ShowWDL value false");
            this._send("isready");
          } else if (line === "readyok" && this.state === "starting") {
            finish(null);
          }
        }
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8").trim();
        if (!text) return;
        this.stderr.push(text);
        if (this.stderr.length > 20) this.stderr.shift();
      });
      child.on("error", (error) => finish(error));
      child.on("exit", (code, signal) => {
        if (this.state === "ready") {
          this.state = "failed";
          this.failure = Object.assign(
            new Error(`Stockfish exited (${signal || code})`),
            { code: "engine_exited" }
          );
        } else if (this.state === "starting") {
          finish(
            Object.assign(new Error(`Stockfish exited during start (${signal || code})`), {
              code: "engine_exited",
            })
          );
        }
      });

      this._send("uci");

      timer = setTimeout(() => {
        finish(
          Object.assign(new Error("Stockfish did not answer uci in time"), {
            code: "engine_timeout",
          })
        );
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
    });

    return this.ready;
  }

  _send(command) {
    if (!this.child || this.child.killed || this.state === "failed") return false;
    try {
      this.child.stdin.write(`${command}\n`);
      return true;
    } catch {
      return false;
    }
  }

  /** Send one `go` and resolve with the parsed UCI output. */
  async analyse(fen, { depth, multipv }) {
    await this.start();
    this.requests += 1;
    return new Promise((resolvePromise, reject) => {
      const lines = new Map();
      let lastDepth = 0;
      let nodes = 0;
      let nps = null;
      let timeMs = 0;
      let finished = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.listeners.delete(listener);
      };
      const done = (error, value) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (error) reject(error);
        else resolvePromise(value);
      };

      const listener = (line) => {
        if (line.startsWith("info ")) {
          if (line.includes(" score ")) {
            const parsed = parseInfo(line);
            if (parsed) {
              lastDepth = Math.max(lastDepth, parsed.depth);
              if (parsed.nodes != null) nodes = parsed.nodes;
              if (parsed.nps != null) nps = parsed.nps;
              if (parsed.timeMs != null) timeMs = parsed.timeMs;
              lines.set(parsed.multipv, parsed);
            }
          } else {
            const depthMatch = /^info depth (\d+)/.exec(line);
            if (depthMatch) lastDepth = Math.max(lastDepth, Number(depthMatch[1]));
            const nodesMatch = /\bnodes (\d+)/.exec(line);
            if (nodesMatch) nodes = Number(nodesMatch[1]);
            const npsMatch = /\bnps (\d+)/.exec(line);
            if (npsMatch) nps = Number(npsMatch[1]);
            const timeMatch = /\btime (\d+)/.exec(line);
            if (timeMatch) timeMs = Number(timeMatch[1]);
          }
          return;
        }
        if (line.startsWith("bestmove")) {
          const match = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line);
          const bestUci = match?.[1] && match[1] !== "(none)" ? match[1] : null;
          if (bestUci && !lines.has(1)) {
            // Some positions (mate/stalemate) return only bestmove.
            lines.set(1, {
              multipv: 1,
              depth: lastDepth,
              uci: bestUci,
              cp: null,
              mate: null,
              pv: [bestUci],
              nodes,
              nps,
              timeMs,
            });
          }
          done(null, {
            raw: [...lines.values()].sort((a, b) => a.multipv - b.multipv),
            bestUci,
            depth: lastDepth,
            nodes,
            nps,
            timeMs,
            stderr: this.stderr.slice(-3),
          });
        }
      };

      this.listeners.add(listener);
      timer = setTimeout(() => {
        this._send("stop");
        // Give the worker a moment to emit bestmove, then fail the request.
        setTimeout(() => {
          done(
            Object.assign(new Error("Stockfish request timed out"), {
              code: "engine_timeout",
            })
          );
        }, 250).unref?.();
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();

      if (!this._send(`setoption name MultiPV value ${Math.max(1, multipv)}`)) {
        done(
          Object.assign(new Error("Stockfish stdin is closed"), {
            code: "engine_stdin_closed",
          })
        );
        return;
      }
      this._send(`position fen ${fen}`);
      this._send(`go depth ${Math.max(1, depth)}`);
    });
  }

  async stop() {
    this.state = "closed";
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.stdin.write("quit\n");
      } catch {
        // ignore
      }
      const force = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1000);
      force.unref?.();
      child.once("exit", () => clearTimeout(force));
      setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }, 250).unref?.();
    }
  }
}

/* ---------------------------------------------------------------- parse --- */

function parseInfo(line) {
  const depth = Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0);
  const multipv = Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1);
  const nodes = Number(/\bnodes (\d+)/.exec(line)?.[1] ?? 0) || null;
  const nps = Number(/\bnps (\d+)/.exec(line)?.[1] ?? 0) || null;
  const timeMs = Number(/\btime (\d+)/.exec(line)?.[1] ?? 0) || null;
  const scoreCp = /\bscore cp (-?\d+)/.exec(line);
  const scoreMate = /\bscore mate (-?\d+)/.exec(line);
  const pvMatch = /\bpv\s+(.+)$/.exec(line);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/).filter(Boolean) : [];
  if (!scoreCp && !scoreMate) return null;
  return {
    multipv: Number.isFinite(multipv) && multipv > 0 ? multipv : 1,
    depth: Number.isFinite(depth) ? depth : 0,
    cp: scoreCp ? Number(scoreCp[1]) : null,
    mate: scoreMate ? Number(scoreMate[1]) : null,
    pv,
    nodes,
    nps,
    timeMs,
  };
}

function whitePov(score, turn) {
  if (score.cp != null) return turn === "w" ? score.cp : -score.cp;
  if (score.mate != null) {
    const value = score.mate > 0 ? 100000 - score.mate : -100000 - score.mate;
    return turn === "w" ? value : -value;
  }
  return null;
}

function uciToSan(fen, uci, chess = null) {
  const game = chess || new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    const move = game.move({ from, to, ...(promotion ? { promotion } : {}) });
    return move ? move.san : null;
  } catch {
    return null;
  }
}

function pvToSans(fen, pv) {
  const chess = new Chess(fen);
  const sans = [];
  for (const uci of pv) {
    const san = uciToSan(fen, uci, chess);
    if (!san) break;
    sans.push(san);
  }
  return sans;
}

function decorateLine(fen, line, turn) {
  const bestUci = line.uci ?? line.pv?.[0] ?? null;
  const chess = new Chess(fen);
  let bestSan = null;
  let from = null;
  let to = null;
  let promotion = null;
  if (bestUci) {
    const move = (() => {
      try {
        return chess.move({
          from: bestUci.slice(0, 2),
          to: bestUci.slice(2, 4),
          ...(bestUci.length > 4 ? { promotion: bestUci[4] } : {}),
        });
      } catch {
        return null;
      }
    })();
    if (move) {
      bestSan = move.san;
      from = move.from;
      to = move.to;
      promotion = move.promotion ?? null;
    }
  }
  const cp = whitePov(line, turn);
  return {
    rank: line.multipv,
    multipv: line.multipv,
    depth: line.depth,
    uci: bestUci,
    san: bestSan,
    from,
    to,
    promotion,
    cp,
    eval: cp,
    mate: line.mate == null ? null : turn === "w" ? line.mate : -line.mate,
    evalPawns: cp == null ? null : Math.round((cp / 100) * 100) / 100,
    pv: line.pv ?? [],
    pvSans: pvToSans(fen, line.pv ?? []),
    nodes: line.nodes ?? null,
    nps: line.nps ?? null,
    timeMs: line.timeMs ?? null,
  };
}

/* --------------------------------------------------------------- service --- */

let worker = null;
let queue = Promise.resolve();
let closed = false;
let pending = 0;

function getWorker() {
  const path = enginePath();
  if (!path) return null;
  if (!worker) worker = new UciWorker(path);
  return worker;
}

function serialize(task) {
  pending += 1;
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    pending = Math.max(0, pending - 1);
  });
}

function unavailable(reason, extra = {}) {
  return {
    available: false,
    reason,
    engine: engineInfo(),
    source: "stockfish",
    depth: extra.depth ?? null,
    multipv: extra.multipv ?? null,
    ...extra,
  };
}

/**
 * Full multipv analysis.
 *
 * @returns {Promise<object>} `{ available, fen, epd, depth, multipv, evalCp,
 *   mate, bestMove, bestSan, lines, engine, source, nodes, timeMs, cached }`
 */
export async function analyse(fen, { depth = DEFAULT_DEPTH, multipv = 1, cache = true } = {}) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return unavailable("invalid_fen", { fen });
  }
  const cleanFen = chess.fen();
  const safeDepth = Math.max(1, Math.min(MAX_DEPTH, Number(depth) || DEFAULT_DEPTH));
  const safeMultipv = Math.max(1, Math.min(20, Number(multipv) || 1));
  const key = cacheKey(cleanFen, safeDepth, safeMultipv);
  if (cache) {
    const hit = memoryGet(key);
    if (hit) return { ...hit, cached: true };
  }

  if (closed) return unavailable("engine_closed", { fen: cleanFen });
  const instance = getWorker();
  if (!instance) return unavailable("engine_missing", { fen: cleanFen });

  const result = await serialize(async () => {
    try {
      const raw = await instance.analyse(cleanFen, {
        depth: safeDepth,
        multipv: safeMultipv,
      });
      const turn = chess.turn();
      const lines = raw.raw.length
        ? raw.raw.map((line) => decorateLine(cleanFen, line, turn))
        : [];
      const best = lines.find((line) => line.rank === 1) || lines[0] || null;
      const value = {
        available: true,
        fen: cleanFen,
        epd: cleanFen.split(" ").slice(0, 4).join(" "),
        turn,
        depth: raw.depth || safeDepth,
        requestedDepth: safeDepth,
        multipv: lines.length || safeMultipv,
        evalCp: best?.cp ?? null,
        mate: best?.mate ?? null,
        evalPawns: best?.evalPawns ?? null,
        bestMove: best?.uci ?? raw.bestUci,
        bestSan: best?.san ?? null,
        lines,
        engine: engineInfo(),
        source: "stockfish",
        nodes: raw.nodes || null,
        nps: raw.nps || null,
        timeMs: raw.timeMs || null,
        cached: false,
      };
      memorySet(key, value);
      return value;
    } catch (error) {
      return unavailable(error?.code || "engine_error", {
        fen: cleanFen,
        depth: safeDepth,
        multipv: safeMultipv,
        message: error?.message ?? String(error),
      });
    }
  });

  return result;
}

export async function bestMove(fen, { depth = DEFAULT_DEPTH } = {}) {
  const analysis = await analyse(fen, { depth, multipv: 1 });
  if (!analysis.available) return analysis;
  return {
    available: true,
    fen: analysis.fen,
    epd: analysis.epd,
    san: analysis.bestSan,
    uci: analysis.bestMove,
    line: analysis.lines[0]?.pvSans ?? [],
    evalCp: analysis.evalCp,
    mate: analysis.mate,
    evalPawns: analysis.evalPawns,
    depth: analysis.depth,
    engine: analysis.engine,
    source: analysis.source,
    nodes: analysis.nodes,
    timeMs: analysis.timeMs,
    cached: Boolean(analysis.cached),
  };
}

export async function evaluate(fen, { depth = DEFAULT_DEPTH } = {}) {
  const analysis = await analyse(fen, { depth, multipv: 1 });
  if (!analysis.available) return analysis;
  return {
    available: true,
    fen: analysis.fen,
    epd: analysis.epd,
    turn: analysis.turn,
    cp: analysis.evalCp,
    evalCp: analysis.evalCp,
    mate: analysis.mate,
    evalPawns: analysis.evalPawns,
    bestMove: analysis.bestMove,
    bestSan: analysis.bestSan,
    depth: analysis.depth,
    engine: analysis.engine,
    source: analysis.source,
    nodes: analysis.nodes,
    timeMs: analysis.timeMs,
    cached: Boolean(analysis.cached),
  };
}

function scoreFor(game, analysis) {
  if (game.isCheckmate()) {
    return game.turn() === "w" ? -100000 : 100000;
  }
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition()) return 0;
  return analysis.available ? analysis.evalCp : null;
}

/**
 * Refutation for a played move. The reply is Stockfish's best move from the
 * position after the played move; damage is the White-POV eval difference
 * between best play before the move and best play after it.
 */
export async function refute(fen, playedSan, { depth = DEFAULT_DEPTH } = {}) {
  let before;
  try {
    before = new Chess(fen);
  } catch {
    return unavailable("invalid_position", { fen });
  }
  const wanted = String(playedSan || "").trim();
  let played = null;
  try {
    played = before.move(wanted);
  } catch {
    return unavailable("illegal_move", { fen, playedSan: wanted });
  }
  if (!played) return unavailable("illegal_move", { fen, playedSan: wanted });
  const afterFen = before.fen();
  const after = new Chess(afterFen);
  const epd = afterFen.split(" ").slice(0, 4).join(" ");
  if (after.isGameOver()) {
    return unavailable(after.isCheckmate() ? "checkmate" : "game_over", {
      fen: afterFen,
      epd,
      playedSan: played.san,
    });
  }

  const [beforeAnalysis, afterAnalysis] = await Promise.all([
    analyse(fen, { depth }),
    analyse(afterFen, { depth }),
  ]);
  if (!afterAnalysis.available) {
    return unavailable(afterAnalysis.reason || "engine_unavailable", {
      fen: afterFen,
      epd,
      playedSan: played.san,
    });
  }
  const best = afterAnalysis.lines[0] || null;
  const evalBefore = beforeAnalysis.available ? beforeAnalysis.evalCp : null;
  const evalAfter = afterAnalysis.evalCp;
  const damage =
    evalBefore == null || evalAfter == null || Math.abs(evalBefore) > 90000 || Math.abs(evalAfter) > 90000
      ? null
      : evalBefore - evalAfter;
  return {
    available: Boolean(best?.san),
    reason: best?.san ? null : "no_reply",
    fen: afterFen,
    epd,
    playedSan: played.san,
    san: best?.san ?? null,
    uci: best?.uci ?? null,
    from: best?.from ?? null,
    to: best?.to ?? null,
    promotion: best?.promotion ?? null,
    line: best?.pvSans ?? [],
    evalCp: evalAfter,
    evalPawns: evalAfter == null ? null : Math.round((evalAfter / 100) * 100) / 100,
    mate: afterAnalysis.mate ?? null,
    evalBeforeCp: evalBefore,
    evalBeforePawns:
      evalBefore == null ? null : Math.round((evalBefore / 100) * 100) / 100,
    damageCp: damage,
    damagePawns: damage == null ? null : Math.round((damage / 100) * 10) / 10,
    depth: afterAnalysis.depth,
    engine: engineInfo(),
    source: "stockfish",
    nodes: afterAnalysis.nodes,
    timeMs: afterAnalysis.timeMs,
  };
}

const BLUNDER_CP = 300;
const MISTAKE_CP = 150;
const INACCURACY_CP = 70;

export function classifyCpLoss(cpLoss) {
  if (cpLoss == null || !Number.isFinite(cpLoss)) return "unavailable";
  if (cpLoss >= BLUNDER_CP) return "blunder";
  if (cpLoss >= MISTAKE_CP) return "mistake";
  if (cpLoss >= INACCURACY_CP) return "inaccuracy";
  return "good";
}

/**
 * Review a sequence of positions with Stockfish.
 *
 * `fens` is the position *before every move* plus the final position. Each
 * position is analysed once, so an N-move game costs N+1 searches. Every row
 * carries the real eval and the engine's best move; `cpLoss` is from the
 * mover's point of view.
 */
export async function reviewGame(fens, { depth = Math.min(DEFAULT_DEPTH, 10), plies = null } = {}) {
  const positions = (Array.isArray(fens) ? fens : [])
    .map((fen) => {
      try {
        return new Chess(fen).fen();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (positions.length < 2) {
    return unavailable("not_enough_positions", { positions: positions.length });
  }
  const analyses = [];
  for (const fen of positions) {
    analyses.push(await analyse(fen, { depth, multipv: 1 }));
  }
  if (!analyses.some((analysis) => analysis.available)) {
    return unavailable(analyses[0]?.reason || "engine_unavailable", {
      positions: positions.length,
    });
  }

  const moves = [];
  for (let index = 0; index < positions.length - 1; index += 1) {
    const fen = positions[index];
    const game = new Chess(fen);
    const turn = game.turn();
    const before = analyses[index];
    const after = analyses[index + 1];
    const playedUci = (() => {
      if (plies?.[index]) {
        try {
          return new Chess(fen).move(plies[index]);
        } catch {
          return null;
        }
      }
      // Derive the played move by diffing the two positions with chess.js.
      const probe = new Chess(fen);
      for (const move of probe.moves({ verbose: true })) {
        const copy = new Chess(fen);
        copy.move(move.san);
        if (copy.fen() === positions[index + 1]) return move;
      }
      return null;
    })();
    const bestCp = before.available ? before.evalCp : null;
    const actualCp = after.available ? after.evalCp : null;
    const cpLoss =
      bestCp == null || actualCp == null
        ? null
        : Math.max(
            0,
            turn === "w" ? bestCp - actualCp : actualCp - bestCp
          );
    const playedSan = playedUci?.san ?? plies?.[index] ?? null;
    const isBest = Boolean(
      before.available &&
        playedUci &&
        before.bestMove &&
        playedUci.from === before.bestMove.slice(0, 2) &&
        playedUci.to === before.bestMove.slice(2, 4) &&
        (playedUci.promotion ?? "") === (before.bestMove.slice(4) ?? "")
    );
    moves.push({
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      side: turn === "w" ? "white" : "black",
      san: playedSan,
      uci: playedUci ? `${playedUci.from}${playedUci.to}${playedUci.promotion ?? ""}` : null,
      epdBefore: fen.split(" ").slice(0, 4).join(" "),
      epdAfter: positions[index + 1].split(" ").slice(0, 4).join(" "),
      evalCp: actualCp,
      evalPawn: actualCp == null ? null : Math.round((actualCp / 100) * 100) / 100,
      evalBeforeCp: bestCp,
      evalBeforePawn: bestCp == null ? null : Math.round((bestCp / 100) * 100) / 100,
      bestSan: before.available ? before.bestSan : null,
      bestUci: before.available ? before.bestMove : null,
      bestLine: before.available ? before.lines[0]?.pvSans ?? [] : [],
      cpLoss,
      classification: isBest ? "best" : classifyCpLoss(cpLoss),
      depth: before.depth || depth,
      available: before.available && after.available,
    });
  }

  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, unavailable: 0 };
  let lossSum = 0;
  let lossCount = 0;
  for (const move of moves) {
    counts[move.classification] = (counts[move.classification] || 0) + 1;
    if (move.cpLoss != null && move.cpLoss > 0) {
      lossSum += move.cpLoss;
      lossCount += 1;
    }
  }
  const summary = {
    plies: moves.length,
    ...counts,
    inaccuracies: counts.inaccuracy,
    mistakes: counts.mistake,
    blunders: counts.blunder,
    averageCentipawnLoss: lossCount ? Math.round((lossSum / lossCount) * 10) / 10 : null,
  };
  return {
    available: true,
    engine: engineInfo(),
    source: "stockfish",
    depth,
    positions: positions.length,
    moves,
    summary,
    thresholds: {
      inaccuracyCp: INACCURACY_CP,
      mistakeCp: MISTAKE_CP,
      blunderCp: BLUNDER_CP,
    },
    classifiedMoves: moves.filter((move) => move.available).length,
  };
}

/* ---------------------------------------------------------------- status --- */

/**
 * Durable eval cache. `analyse()` already has an in-memory LRU; SQLite keeps
 * repeated gap/build views fast across restarts. Only real engine output is
 * stored, keyed by full FEN and depth.
 */
export function readCachedEval(db, fen, depth) {
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT * FROM engine_evals WHERE fen = ? AND depth = ?")
      .get(fen, depth);
    if (!row) return null;
    return {
      available: true,
      fen,
      epd: fen.split(" ").slice(0, 4).join(" "),
      cp: row.cp == null ? null : Number(row.cp),
      evalCp: row.cp == null ? null : Number(row.cp),
      mate: row.mate == null ? null : Number(row.mate),
      evalPawns: row.cp == null ? null : Math.round((Number(row.cp) / 100) * 100) / 100,
      bestMove: row.best_uci ?? null,
      bestSan: row.best_san ?? null,
      pv: (() => {
        try {
          return JSON.parse(row.pv || "[]");
        } catch {
          return [];
        }
      })(),
      depth: Number(row.depth),
      engine: { name: ENGINE_NAME, version: ENGINE_VERSION, id: `${ENGINE_NAME} (Stockfish ${ENGINE_VERSION})` },
      source: "stockfish",
      cached: true,
      persisted: true,
    };
  } catch {
    return null;
  }
}

export function writeCachedEval(db, result) {
  if (!db || !result?.available || result.evalCp == null) return false;
  try {
    db.prepare(
      `INSERT INTO engine_evals (fen, depth, cp, mate, best_san, best_uci, pv, engine, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fen, depth) DO UPDATE SET
         cp = excluded.cp,
         mate = excluded.mate,
         best_san = excluded.best_san,
         best_uci = excluded.best_uci,
         pv = excluded.pv,
         engine = excluded.engine,
         created_at = excluded.created_at`
    ).run(
      result.fen,
      result.depth,
      result.evalCp,
      result.mate,
      result.bestSan ?? null,
      result.bestMove ?? null,
      JSON.stringify(result.lines?.[0]?.pv ?? result.pv ?? []),
      result.engine?.id ?? `${ENGINE_NAME} (Stockfish ${ENGINE_VERSION})`,
      new Date().toISOString()
    );
    return true;
  } catch {
    return false;
  }
}

/** Evaluate one FEN, preferring SQLite, then the engine, then memory. */
export async function evaluateCached(db, fen, { depth = DEFAULT_DEPTH } = {}) {
  let cleanFen;
  try {
    cleanFen = new Chess(fen).fen();
  } catch {
    return unavailable("invalid_fen", { fen });
  }
  const safeDepth = Math.max(1, Math.min(MAX_DEPTH, Number(depth) || DEFAULT_DEPTH));
  const cached = readCachedEval(db, cleanFen, safeDepth);
  if (cached) return cached;
  const result = await evaluate(cleanFen, { depth: safeDepth });
  if (result.available) writeCachedEval(db, result);
  return result;
}

export async function analyseCached(db, fen, { depth = DEFAULT_DEPTH, multipv = 1 } = {}) {
  let cleanFen;
  try {
    cleanFen = new Chess(fen).fen();
  } catch {
    return unavailable("invalid_fen", { fen });
  }
  const safeDepth = Math.max(1, Math.min(MAX_DEPTH, Number(depth) || DEFAULT_DEPTH));
  if (Number(multipv) <= 1) {
    const cached = readCachedEval(db, cleanFen, safeDepth);
    if (cached) {
      return {
        ...cached,
        lines: cached.bestSan
          ? [
              {
                rank: 1,
                multipv: 1,
                depth: cached.depth,
                uci: cached.bestMove,
                san: cached.bestSan,
                cp: cached.evalCp,
                eval: cached.evalCp,
                mate: cached.mate,
                evalPawns: cached.evalPawns,
                pv: cached.pv ?? [],
                pvSans: pvToSans(cleanFen, cached.pv ?? []),
              },
            ]
          : [],
        bestSan: cached.bestSan,
        bestMove: cached.bestMove,
        multipv: 1,
      };
    }
  }
  const result = await analyse(cleanFen, { depth: safeDepth, multipv });
  if (result.available && Number(multipv) <= 1) writeCachedEval(db, result);
  return result;
}

export function status() {
  const path = enginePath();
  return {
    available: Boolean(path),
    started: worker?.state === "ready",
    state: worker?.state ?? "idle",
    engine: engineInfo(),
    path,
    defaultDepth: DEFAULT_DEPTH,
    maxDepth: MAX_DEPTH,
    timeoutMs: REQUEST_TIMEOUT_MS,
    requests: worker?.requests ?? 0,
    startedAt: worker?.startedAt ?? null,
    stderr: worker?.stderr?.slice(-3) ?? [],
    cacheEntries: memoryCache.size,
    queueDepth: pending,
    fallback: {
      available: true,
      name: "Chessbook local heuristic",
      reason: path ? "Only used when Stockfish cannot start." : "Stockfish binary not found.",
    },
  };
}

export async function close() {
  closed = true;
  const instance = worker;
  worker = null;
  memoryCache.clear();
  if (instance) await instance.stop();
  queue = Promise.resolve();
  pending = 0;
  // Allow tests to start the engine again.
  closed = false;
  return true;
}

/** Test/diagnostic helper: content hash of the selected binary path. */
export function engineFingerprint() {
  return createHash("sha1").update(enginePath() || "none").digest("hex").slice(0, 12);
}
