/**
 * Build the captured-data JSON files from the production captures in `recon/`.
 *
 * Run: node server/tools/build-captured-data.mjs
 *
 * The runtime never reads `recon/`: `server/seed-data.js` imports the JSON this
 * script writes. Keeping the extraction reproducible means every number in the
 * local database can be traced back to a captured response.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const outDir = join(root, "server", "data");
mkdirSync(outDir, { recursive: true });

const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const writeJson = (name, value) => {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 1)}\n`);
  return name;
};

const epdOf = (fen) => String(fen || "").split(" ").slice(0, 4).join(" ");
const START_FEN = new Chess().fen();

/* ------------------------------------------------------------- reporters --- */

function network(file) {
  const value = readJson(file);
  return Array.isArray(value) ? value : [];
}

/** Parse a possibly truncated position-report response body into reports. */
function salvageReports(body) {
  const reports = [];
  let pos = 0;
  while (true) {
    const start = body.indexOf('{"courses":', pos);
    if (start < 0) break;
    const suggested = body.indexOf('"suggestedMoves":[', start);
    if (suggested < 0) break;
    const headerText = body.slice(start, suggested).replace(/,\s*$/, "");
    let header;
    try {
      header = JSON.parse(`${headerText}}`);
    } catch {
      break;
    }
    const arrayStart = suggested + '"suggestedMoves":'.length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let arrayEnd = -1;
    for (let i = arrayStart; i < body.length; i += 1) {
      const ch = body[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          arrayEnd = i;
          break;
        }
      }
    }
    const moves = [];
    if (arrayEnd > 0) {
      try {
        moves.push(...JSON.parse(body.slice(arrayStart, arrayEnd + 1)));
      } catch {
        // fall through to object salvage
      }
      reports.push({ ...header, suggestedMoves: moves, complete: true });
      pos = arrayEnd + 1;
    } else {
      let depth2 = 0;
      let objectStart = -1;
      let inString2 = false;
      let escaped2 = false;
      for (let i = arrayStart; i < body.length; i += 1) {
        const ch = body[i];
        if (inString2) {
          if (escaped2) escaped2 = false;
          else if (ch === "\\") escaped2 = true;
          else if (ch === '"') inString2 = false;
          continue;
        }
        if (ch === '"') {
          inString2 = true;
          continue;
        }
        if (ch === "{") {
          if (depth2 === 0) objectStart = i;
          depth2 += 1;
        } else if (ch === "}") {
          depth2 -= 1;
          if (depth2 === 0 && objectStart >= 0) {
            try {
              moves.push(JSON.parse(body.slice(objectStart, i + 1)));
            } catch {
              // truncated object: ignore
            }
            objectStart = -1;
          }
        }
      }
      reports.push({ ...header, suggestedMoves: moves, complete: false });
      break;
    }
  }
  return reports;
}

const NETWORKS = [
  "recon/live2/network.json",
  "recon/live3/network.json",
  "recon/live3/network-practice.json",
  "recon/live4/network.json",
  "recon/live5/network.json",
];

const reportCandidates = [];
const annotations = [];
const courses = new Map();
let supplementary = [];

for (const file of NETWORKS) {
  network(file).forEach((entry, index) => {
    const body = String(entry.body || "");
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }

    if (entry.url?.includes("fetchPositionReportAndAnnotations")) {
      const reports = parsed?.reports?.length
        ? parsed.reports.map((r) => ({ ...r, complete: true }))
        : salvageReports(body);
      for (const report of reports) {
        reportCandidates.push({
          ...report,
          _source: `${file}#${index}`,
        });
        for (const course of report.courses || []) {
          if (course?.id && !courses.has(course.id)) {
            courses.set(course.id, { ...course, _source: `${file}#${index}` });
          }
        }
      }
      for (const annotation of parsed?.annotations || []) {
        annotations.push({ ...annotation, _source: `${file}#${index}` });
      }
    }

    if (entry.url?.includes("/api/v1/openings/supplementary")) {
      const re =
        /\{"epd":"((?:[^"\\]|\\.)*)","fullName":"((?:[^"\\]|\\.)*)","friendlyName":(null|"(?:[^"\\]|\\.)*")\}/g;
      let match;
      const found = [];
      while ((match = re.exec(body))) {
        try {
          const epd = JSON.parse(`"${match[1]}"`);
          const fullName = JSON.parse(`"${match[2]}"`);
          const friendlyName =
            match[3] === "null" ? null : JSON.parse(match[3]);
          if (epd.split(" ").length !== 4 || !epd.includes("/")) continue;
          found.push({ epd, fullName, friendlyName });
        } catch {
          // malformed record
        }
      }
      if (found.length > supplementary.length) supplementary = found;
    }
  });
}

/**
 * Prefer the longest captured candidate list for one (EPD, reference
 * repertoire). A truncated 3,000-character response must never replace the
 * complete 20,000-character one.
 */
const reportByKey = new Map();
for (const report of reportCandidates) {
  const key = `${report.epd}|${report.repertoireId}`;
  const previous = reportByKey.get(key);
  if (
    !previous ||
    (report.suggestedMoves?.length || 0) > (previous.suggestedMoves?.length || 0)
  ) {
    reportByKey.set(key, report);
  }
}

const WHITE_REFERENCE = "c5af9aa0-8ef3-4806-a8ec-2ce4cd43dbca";
const BLACK_REFERENCE = "67eef914-3413-4581-aa14-d08873b3b64b";
const referenceColor = (id) =>
  id === WHITE_REFERENCE ? "white" : id === BLACK_REFERENCE ? "black" : null;

const reports = [...reportByKey.values()].map((report) => ({
  epd: report.epd,
  repertoireId: report.repertoireId ?? null,
  referenceColor: referenceColor(report.repertoireId),
  sideToMove: String(report.epd || "").split(" ")[1] === "b" ? "black" : "white",
  stockfish: report.stockfish ?? null,
  masterResults: report.masterResults ?? null,
  results: report.results ?? null,
  plans: report.plans ?? [],
  complete: Boolean(report.complete),
  source: report._source,
  suggestedMoves: (report.suggestedMoves || []).map((move) => ({
    san: move.sanPlus,
    epdAfter: move.epdAfter ?? null,
    probability: move.moveProbability ?? null,
    incidence: move.incidence ?? null,
    masterResults: move.masterResults ?? null,
    results: move.results ?? null,
    stockfish: move.stockfish ?? null,
    needed: move.needed ?? null,
    danger: move.danger ?? null,
    annotation: move.annotation ?? null,
    similarPositionCount: move.similarPositionCount ?? null,
    similarPositionMatchCount: move.similarPositionMatchCount ?? null,
  })),
}));

// Deduplicate annotations by (epd, san, text), keeping provenance of the first.
const annotationByKey = new Map();
for (const annotation of annotations) {
  if (!annotation?.epd || !annotation?.text) continue;
  const key = `${annotation.epd}|${annotation.san ?? ""}|${annotation.text}`;
  if (!annotationByKey.has(key)) {
    annotationByKey.set(key, {
      epd: annotation.epd,
      san: annotation.san ?? null,
      text: annotation.text,
      mine: Boolean(annotation.mine),
      repertoireId: annotation.repertoireId ?? null,
      source: annotation._source,
    });
  }
}

/* ---------------------------------------------------------- repertoire --- */

const home = readJson("recon/live4/network.json").find((entry) =>
  entry.url?.includes("home.fetchHome_v2")
);
const homeBody = JSON.parse(home.body);

const repertoireReports = {};
for (const [referenceId, grade] of Object.entries(homeBody.repertoire?.grades || {})) {
  const color = referenceColor(referenceId);
  if (!color) continue;
  repertoireReports[color] = {
    referenceRepertoireId: referenceId,
    characteristics: grade.characteristics ?? null,
    coverage: grade.coverage ?? null,
    biggestMiss: grade.biggestMiss ?? null,
    biggestMisses: grade.biggestMisses ?? null,
    gaps: grade.gaps ?? [],
    side: grade.side ?? color,
    tooLarge: Boolean(grade.tooLarge),
    source: "recon/live4/network.json#3",
  };
}

/* ---------------------------------------------------------------- guides --- */

const openingsPage = readJson("recon/live6/02-openings.json");
const lines = String(openingsPage.text || "").split(/\n/);
const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const guides = [];
let side = null;
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i].trim();
  if (line === "Openings for White") side = "white";
  else if (line === "Openings for Black") side = "black";
  else if (side && /^ECO [A-E]\d{2}$/.test(line)) {
    const eco = line.slice(4);
    const name = lines[i + 1]?.trim();
    const moveText = lines[i + 2]?.trim();
    if (!name || !moveText) continue;
    const sans = [];
    try {
      const chess = new Chess();
      for (const token of moveText.split(/\s+/)) {
        if (/^\d+\.$/.test(token) || !token) continue;
        const moved = chess.move(token);
        sans.push(moved.san);
      }
    } catch {
      continue;
    }
    const pgn = sans
      .map((san, index) => `${index % 2 === 0 ? `${index / 2 + 1}. ` : ""}${san}`)
      .join(" ");
    const chess = new Chess();
    for (const san of sans) chess.move(san);
    guides.push({
      slug: slugify(name),
      eco,
      name,
      side,
      sans,
      pgn,
      epd: epdOf(chess.fen()),
      source: "recon/live6/02-openings.json",
    });
    i += 2;
  }
}

/* --------------------------------------------------------------- coaches --- */

const coaches = [
  {
    slug: "blunder-man",
    name: "Blunder Man",
    rating: "2180 Chess.com Rapid",
    headline: "2180 Chess.com Rapid",
    bio: "I look at my students’ games to see where they are going wrong and what they need to work on. I then focus my lessons on those specific areas, so the coaching is based on the student’s actual needs rather than following the same approach for everyone.",
    languages: ["English"],
    price: "$50/hour",
    platforms: ["Chess.com"],
    firstLessonFree: false,
    source: "recon/live6/04-coaches.json",
  },
  {
    slug: "daniel-pivonka",
    name: "Daniel Pivonka",
    rating: "2100 Lichess Rapid",
    headline: "2100 Lichess Rapid",
    bio: "I focus on personalized, engaging chess lessons tailored to each student’s level, from beginners to intermediates. My approach blends strategic play analysis, puzzle-solving, and game reviews to sharpen key skills like openings, tactics, and endgames.",
    languages: [],
    price: "$40/hour",
    platforms: [],
    firstLessonFree: true,
    source: "recon/live6/04-coaches.json",
  },
  {
    slug: "vasyl",
    name: "Vasyl",
    rating: "2002 Chess.com Rapid 30+0",
    headline: "2002 Chess.com Rapid 30+0",
    bio: "Im a very affordable coach for those who want to reach 2000 elo ASAP, i dont charge money till you see first 50+ elo, then its 4$ a hour + you can message me whenever you want.",
    languages: ["English", "Russian", "Ukrainian"],
    price: "4$/hour after +50 elo",
    platforms: ["Chess.com"],
    firstLessonFree: false,
    source: "recon/live6/04-coaches.json",
  },
];

/* ------------------------------------------------------------------ blog --- */

const posts = [
  ["Spending 10 months building the most human-like chess bot", "2026-10-19", "Chessbook-1 predicts human moves as well as the best published models, and it also knows how strong to play at every rating, how long a human would think, how time trouble changes things, and who is winning."],
  ["Improving in chess is hard. I built the world's most human-like chess AI to help me.", "2025-10-31", "Getting better at chess is _really hard_. My theory is that it's at least partially because of the feedback lag. Imagine learning to play the violin, but you"],
  ["An honest review of my last year building Chessbook", "2025-02-26", "Last year, I quit my job to work full-time on a chess app I created. It’s my first time working full-time on a project of my own, and it’s been both terrifyin"],
  ["Processing 6 Billion Chess Games in Less Than 2 Hours", "2024-03-26", "I run a chess site, https://chessbook.com. We ingest a _ton_ of games, nearly 6 billion, to power our various statistics. Our current database has about 900 m"],
  ["Compressing Chess Moves Even Further, To 3.7 Bits Per Move", "2024-03-14", "I wrote [a post](/posts/compressing-chess-moves) yesterday about how to compress chess moves. I was pretty happy with my hand-rolled compression scheme, which"],
  ["Compressing Chess Moves for Fun and Profit", "2024-03-13", "UPDATE: I've written a [new post](/posts/compressing-chess-moves-even-further) with a new technique which is about 2.5x more efficient than this approach"],
  ["Which openings lead to the shortest games? What about the longest games?", "2023-06-28", "Average game length by opening, from 100 million Lichess games between 1200 and 1800: the first moves that don't matter, the gambits that end in miniatures, and the closed openings that drag on."],
  ["How some common material imbalances affect your win-rate", "2023-06-11", "How much more likely are you to win after winning the exchange? What about two minors for a rook? What about two rooks for a queen? Data from 100 million Lichess games, by rating."],
  ["Generating Chess Puzzles Fast with Rust and Stockfish", "2022-01-15", "Generally, chess puzzles will present you with a position and ask you to find the best move. There's only one, and all other moves are losing. These are great"],
];
const blog = posts.map(([title, publishedAt, excerpt], index) => ({
  slug: slugify(title),
  title,
  publishedAt,
  excerpt,
  source: "recon/live6/05-blog.json",
  sortOrder: index,
}));

/* ----------------------------------------------------------- model games --- */

const dailyResponse = readJson("recon/daily-game-full.json");
const historyResponse = readJson("recon/model-history-full.json");
const modelGames = [
  {
    ...dailyResponse.game,
    annotations: dailyResponse.annotations ?? {},
    daily: true,
    source: "recon/daily-game-full.json",
  },
  ...(historyResponse.games || []).map((game) => ({
    ...game,
    annotations: historyResponse.annotations ?? {},
    daily: false,
    source: "recon/model-history-full.json",
  })),
];

/* ------------------------------------------------------------------ write --- */

const openingReport = readJson("recon/live4/network.json").find((entry) =>
  entry.url?.includes("/api/v2/openings_report")
);
let capturedReport = [];
try {
  capturedReport = openingReport?.body ? JSON.parse(openingReport.body) : [];
} catch {
  capturedReport = [];
}

const captured = {
  generatedAt: new Date().toISOString(),
  _provenance: {
    positionReports:
      "recon/live2|live3|live4|live5/network*.json — openings.fetchPositionReportAndAnnotations",
    supplementary: "recon/live4/network.json#5 — /api/v1/openings/supplementary",
    repertoire: "recon/live4/network.json#3 — home.fetchHome_v2",
    guides: "recon/live6/02-openings.json",
    courses: "courses arrays inside fetchPositionReportAndAnnotations responses",
    coaches: "recon/live6/04-coaches.json",
    blog: "recon/live6/05-blog.json",
    report: "recon/live4/network.json#8 — /api/v2/openings_report",
  },
  profile: {
    eloRange: "2000-2200",
    ratingRange: "1800-2000",
    singleElo: 2100,
    ratingSystem: "Chess.com",
    trainingRating: 1900,
    trainingRatingDeviation: 350,
    missThreshold: 0.5,
    source: "recon/live4/network.json#2 — /api/user",
  },
  reports,
  annotations: [...annotationByKey.values()],
  supplementary,
  repertoireReports,
  courses: [...courses.values()].map((course) => ({
    id: course.id,
    slug: course.slug,
    name: course.name,
    side: course.side,
    authorName: course.authorName ?? null,
    authorTitle: course.authorTitle ?? null,
    avatarImage: course.avatarImage ?? null,
    description: course.description ?? null,
    descriptionShort: course.descriptionShort ?? null,
    official: Boolean(course.official),
    featured: Boolean(course.featured),
    moveCount: course.moveCount ?? null,
    coverage: course.coverage ?? null,
    eloRanges: course.eloRanges ?? [],
    characteristics: course.characteristics ?? null,
    videoId: course.videoId ?? null,
    source: course._source,
  })),
  guides,
  coaches,
  blog,
  report: {
    captured: capturedReport,
    capturedAvailable: false,
    source: "recon/live4/network.json#8 (returned [])",
  },
  modelGames,
};

const files = [
  writeJson("captured-positions.json", {
    generatedAt: captured.generatedAt,
    _provenance: {
      reports: captured._provenance.positionReports,
      supplementary: captured._provenance.supplementary,
      repertoire: captured._provenance.repertoire,
    },
    profile: captured.profile,
    reports: captured.reports,
    annotations: captured.annotations,
    supplementary: captured.supplementary,
    repertoireReports: captured.repertoireReports,
  }),
  writeJson("captured-courses.json", {
    generatedAt: captured.generatedAt,
    _provenance: captured._provenance.courses,
    courses: captured.courses,
  }),
  writeJson("captured-openings.json", {
    generatedAt: captured.generatedAt,
    _provenance: captured._provenance.guides,
    guides: captured.guides,
    report: captured.report,
  }),
  writeJson("captured-content.json", {
    generatedAt: captured.generatedAt,
    _provenance: {
      coaches: captured._provenance.coaches,
      blog: captured._provenance.blog,
    },
    coaches: captured.coaches,
    blog: captured.blog,
  }),
  writeJson("captured-model-games.json", {
    generatedAt: captured.generatedAt,
    _provenance: "recon/daily-game-full.json + recon/model-history-full.json",
    games: captured.modelGames,
  }),
];

console.log(
  JSON.stringify(
    {
      files,
      counts: {
        reports: reports.length,
        candidates: reports.reduce((n, r) => n + r.suggestedMoves.length, 0),
        annotations: annotationByKey.size,
        supplementary: supplementary.length,
        courses: courses.size,
        guides: guides.length,
        coaches: coaches.length,
        blog: blog.length,
        modelGames: modelGames.length,
      },
      blackAfterE4: reports
        .find((r) => r.epd === "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -")
        ?.suggestedMoves.slice()
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 5)
        .map((m) => m.san),
    },
    null,
    2
  )
);
