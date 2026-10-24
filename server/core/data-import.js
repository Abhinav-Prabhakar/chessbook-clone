/**
 * Import the bundled datasets into SQLite. Each dataset is re-imported only
 * when its file changes (size + mtime recorded in `meta`).
 *
 *  - server/data/{a..e}.tsv           Lichess chess-openings names (CC0)
 *  - server/data/explorer-masters.json.gz   master games aggregate (PGN Mentor)
 *  - server/data/explorer-lichess.json.gz   Lichess games by rating band (CC0)
 *  - server/data/master-games.jsonl.gz      complete master games (model games)
 *  - server/data/puzzles.csv.gz             Lichess puzzles from openings (CC0)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Chess } from "chess.js";
import { db, dataDir, getMeta, setMeta, tx } from "./db.js";
import { epdOf } from "./chess.js";

function fileStamp(file) {
  if (!existsSync(file)) return null;
  const s = statSync(file);
  return `${s.size}:${Math.floor(s.mtimeMs)}`;
}

function readMaybeGz(file) {
  const raw = readFileSync(file);
  return file.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
}

function once(key, files, fn, { force = false } = {}) {
  const stamp = files.map(fileStamp).join("|");
  if (files.every((f) => !existsSync(f))) return false;
  if (!force && getMeta(`import:${key}`) === stamp) return false;
  const started = Date.now();
  fn();
  setMeta(`import:${key}`, stamp);
  if (process.env.NODE_ENV !== "test") {
    console.log(`[data] imported ${key} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return true;
}

export function importOpenings(options) {
  const files = ["a", "b", "c", "d", "e"].map((x) => join(dataDir, `${x}.tsv`));
  return once(
    "openings",
    files,
    () => {
      tx(() => {
        db.prepare("DELETE FROM openings").run();
        const insert = db.prepare(
          "INSERT INTO openings (eco, name, pgn, epd, plies) VALUES (?, ?, ?, ?, ?)"
        );
        for (const file of files) {
          const rows = readFileSync(file, "utf8").split("\n").slice(1);
          for (const row of rows) {
            const [eco, name, pgn] = row.split("\t");
            if (!eco || !name || !pgn) continue;
            const chess = new Chess();
            let plies = 0;
            try {
              for (const token of pgn.split(/\s+/)) {
                if (!token || /^\d+\./.test(token)) continue;
                chess.move(token);
                plies += 1;
              }
            } catch {
              continue;
            }
            insert.run(eco, name, pgn, epdOf(chess.fen()), plies);
          }
        }
      });
    },
    options
  );
}

export function importExplorer(dataset, options) {
  const file = join(dataDir, `explorer-${dataset}.json.gz`);
  return once(
    `explorer-${dataset}`,
    [file],
    () => {
      const payload = JSON.parse(readMaybeGz(file));
      tx(() => {
        db.prepare("DELETE FROM explorer_positions WHERE dataset = ?").run(dataset);
        db.prepare("DELETE FROM explorer_moves WHERE dataset = ?").run(dataset);
        const pos = db.prepare(
          "INSERT INTO explorer_positions (dataset, band, epd, games, white, draw, black) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        const mv = db.prepare(
          "INSERT OR IGNORE INTO explorer_moves (dataset, band, epd, san, games, white, draw, black) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        const put = (band, epd, value) => {
          const [games, white, draw, black, moves] = value;
          pos.run(dataset, band, epd, games, white, draw, black);
          for (const [san, g, w, d, b] of moves || []) mv.run(dataset, band, epd, san, g, w, d, b);
        };
        for (const [epd, value] of Object.entries(payload.positions || {})) {
          if (Array.isArray(value)) put("all", epd, value);
          else for (const [band, v] of Object.entries(value)) put(band, epd, v);
        }
        setMeta(`explorer-${dataset}-meta`, JSON.stringify(payload.meta || {}));
      });
    },
    options
  );
}

/**
 * Master games are imported in small chunks after the server starts, so the
 * first launch is not blocked for a minute. Model games become available
 * when this finishes (a few seconds to a minute).
 */
export function importMasterGamesInBackground({ force = false, onDone } = {}) {
  const file = join(dataDir, "master-games.jsonl.gz");
  const stamp = fileStamp(file);
  if (!stamp || (!force && getMeta("import:master-games") === stamp)) {
    onDone?.();
    return;
  }
  const lines = readMaybeGz(file).split("\n").filter(Boolean);
  db.prepare("DELETE FROM master_game_positions").run();
  db.prepare("DELETE FROM master_games").run();
  db.prepare("DELETE FROM model_progress").run();
  setMeta("import:master-games", null);
  const insert = db.prepare(
    `INSERT INTO master_games (white, black, white_elo, black_elo, event, year, result, eco, sans, plies)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const index = db.prepare("INSERT INTO master_game_positions (epd, game_id, ply) VALUES (?, ?, ?)");
  const started = Date.now();
  let cursor = 0;
  const step = () => {
    const end = Math.min(lines.length, cursor + 400);
    tx(() => {
      for (; cursor < end; cursor += 1) {
        let game;
        try {
          game = JSON.parse(lines[cursor]);
        } catch {
          continue;
        }
        const [white, black, we, be, event, year, result, eco, sansText] = game;
        const sans = sansText.split(" ");
        const chess = new Chess();
        const epds = [];
        let ok = true;
        // Only the opening is indexed.
        for (let i = 0; i < Math.min(30, sans.length); i += 1) {
          try {
            chess.move(sans[i]);
          } catch {
            ok = false;
            break;
          }
          epds.push(epdOf(chess.fen()));
        }
        if (!ok) continue;
        const id = Number(insert.run(white, black, we, be, event, year, result, eco, sansText, sans.length).lastInsertRowid);
        epds.forEach((epd, i) => {
          if (i >= 3) index.run(epd, id, i + 1);
        });
      }
    });
    if (cursor < lines.length) {
      setImmediate(step);
      return;
    }
    setMeta("import:master-games", stamp);
    if (process.env.NODE_ENV !== "test") {
      console.log(`[data] imported ${lines.length} master games in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    onDone?.();
  };
  setImmediate(step);
}

export function masterGamesReady() {
  return Boolean(getMeta("import:master-games"));
}

export function importPuzzles(options) {
  const file = join(dataDir, "puzzles.csv.gz");
  return once(
    "puzzles",
    [file],
    () => {
      const rows = readMaybeGz(file).split("\n").filter(Boolean);
      tx(() => {
        db.prepare("DELETE FROM puzzles").run();
        const insert = db.prepare(
          `INSERT OR REPLACE INTO puzzles (id, fen, moves, rating, popularity, plays, themes, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const row of rows) {
          const [id, fen, moves, rating, popularity, plays, themes, tags] = row.split(",");
          if (!id || !fen || !moves) continue;
          insert.run(id, fen, moves, Number(rating), Number(popularity), Number(plays), themes || "", tags || "");
        }
      });
    },
    options
  );
}

export function importAll({ force = false } = {}) {
  if (process.env.CHESSBOOK_SKIP_DATA === "1") {
    importOpenings({ force });
    return;
  }
  importOpenings({ force });
  importExplorer("masters", { force });
  importExplorer("lichess", { force });
  importPuzzles({ force });
}
