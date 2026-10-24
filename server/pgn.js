/**
 * PGN import/export. Import accepts a single game, a multi-game PGN, a Lichess
 * study export or bare movetext; export writes one PGN game per saved line.
 */
import { Chess } from "chess.js";
import { lineSans, pgnFromSans } from "./positions.js";

export function splitPgnGames(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const withHeaders = /\[\s*[A-Za-z][A-Za-z0-9_]*\s+"/.test(trimmed);
  if (!withHeaders) return [trimmed];
  const chunks = trimmed
    .split(/\n\s*\n(?=\[\s*[A-Za-z])|\r?\n(?=\[\s*Event\s+")/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.length ? chunks : [trimmed];
}

export function parsePgnGames(text) {
  const games = [];
  const chunks = splitPgnGames(text);
  for (const chunk of chunks) {
    const chess = new Chess();
    try {
      chess.loadPgn(chunk);
    } catch (error) {
      games.push({ ok: false, error: error.message, headers: {}, sans: [] });
      continue;
    }
    const headers = chess.header ? chess.header() : {};
    const sans = chess.history();
    if (!sans.length) {
      games.push({ ok: false, error: "The PGN contains no moves", headers, sans: [] });
      continue;
    }
    games.push({
      ok: true,
      headers,
      sans,
      result: headers.Result ?? null,
      event: headers.Event ?? null,
      white: headers.White ?? null,
      black: headers.Black ?? null,
    });
  }
  return games;
}

function pgnTag(value) {
  return String(value ?? "").replace(/"/g, "'");
}

export function exportPgn(db, repertoire, { includeChapters = true } = {}) {
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id);
  const chapters = new Map(
    db
      .prepare("SELECT * FROM repertoire_chapters WHERE repertoire_id = ?")
      .all(repertoire.id)
      .map((row) => [row.id, row.name])
  );
  const out = [];
  for (const line of lines) {
    const sans = lineSans(line);
    if (!sans.length) continue;
    const chapter =
      includeChapters && line.chapter_id && chapters.has(line.chapter_id)
        ? chapters.get(line.chapter_id)
        : null;
    const tags = [
      `[Event "${pgnTag(`Repertoire: ${repertoire.name}`)}"]`,
      `[Site "chessbook-local"]`,
      `[Date "${new Date().toISOString().slice(0, 10).replace(/-/g, ".")}"]`,
      `[Round "-"]`,
      `[White "${repertoire.color === "white" ? "Repertoire" : "Opponent"}"]`,
      `[Black "${repertoire.color === "black" ? "Repertoire" : "Opponent"}"]`,
      `[Result "*"]`,
      `[Annotator "chessbook"]`,
      `[Opening "${pgnTag(line.name)}"]`,
      chapter ? `[Chapter "${pgnTag(chapter)}"]` : null,
      `[Orig "${line.origin || "manual"}"]`,
    ].filter(Boolean);
    out.push(`${tags.join("\n")}\n\n${pgnFromSans(sans)} *`);
  }
  return out.join("\n\n");
}

export function exportJson(db, repertoire, { stats = null } = {}) {
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id)
    .map((line) => ({
      id: line.id,
      name: line.name,
      moves: lineSans(line),
      pgn: line.pgn,
      fen: line.fen,
      epd: line.epd ?? null,
      side: line.side,
      expectedSan: line.expected_san,
      saved: Boolean(line.saved),
      origin: line.origin ?? null,
      autofillStyle: line.autofill_style ?? null,
      chapterId: line.chapter_id ?? null,
    }));
  const notes = db
    .prepare("SELECT * FROM notes WHERE repertoire_id = ? ORDER BY epd, san")
    .all(repertoire.id)
    .map((note) => ({
      epd: note.epd,
      san: note.san || null,
      note: note.note,
      updatedAt: note.updated_at,
    }));
  const chapters = db
    .prepare("SELECT * FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, id")
    .all(repertoire.id)
    .map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      description: chapter.description,
      sortOrder: chapter.sort_order,
    }));
  return {
    format: "chessbook-repertoire",
    version: 1,
    exportedAt: new Date().toISOString(),
    repertoire: stats,
    chapters,
    lines,
    notes,
  };
}
