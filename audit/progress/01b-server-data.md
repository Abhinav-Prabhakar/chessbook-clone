# Batch 1b — server data, reports and opening content

Owner: `server-data`
Scope: `server/api.js`, `server/db.js`, `server/schema.js`, `server/repertoire.js`,
`server/index.js`, new `server/*.js`, new `server/data/*.json`,
`server/tools/build-captured-data.mjs`, `tests/server/**`.

Status: **implemented and verified**. No client file, `package.json`, `recon/`
file, or `server/data/chessbook.db` was modified. Nothing was committed.

---

## What changed

### Migration v2

`server/schema.js` now has a second `PRAGMA user_version` migration. It is
additive; every audit/progress/01-server-core endpoint and response field still
works.

New/changed tables:

| Table | Purpose |
|---|---|
| `data_sources` | Provenance + content hash for each imported capture dataset. |
| `capture_profile` | Reference rating band / elo range / training rating from `/api/user`. |
| `opening_names` | Captured supplementary EPD → `fullName` / `friendlyName`. |
| `opening_aliases` | Same-name transpositions and future aliases. |
| `position_reports` | One captured report per (EPD, reference repertoire): side, Stockfish, master/peer totals, plans, completeness. |
| `position_candidates` | The full ranked candidate list: probability, incidence, master/peer splits, eval, needed, annotation. |
| `position_annotations` | Captured per-position/per-move annotations. |
| `repertoire_characteristics` | Captured `characteristics`, `coverage`, `biggestMiss`, `biggestMisses`, `gaps` for the reference repertoire. |
| `repertoire_exclusions` | Persisted excluded opponent moves per (repertoire, EPD, SAN). |
| `repertoire_chapters` | User-created chapter/section model; lines carry `chapter_id`. |
| `courses` + `course_chapters` | Pre-made course catalogue/detail (chapters only if captured; currently empty). |
| `opening_guides` | Real opening guides (ECO, name, side, line, final EPD). |
| `coaches`, `blog_posts` | Real captured content. |
| `model_game_data` | Players, ratings, performances, EPDs, eval samples, daily marker, source. |
| `model_game_moves` | Per-ply SAN/EPD/eval rows. |
| `model_game_annotations` | Captured game annotations (empty in these captures). |
| `model_daily_selection` | Persisted daily selection and `force_new_game` rotation. |
| `opening_imports` | ECO import versioning (source + content hash + row count). |

Column additions: `repertoires.{capture_reference_id,source,slug}`,
`lines.{origin,autofill_style,chapter_id,epd,source_ref}`,
`openings.{epd,epd_after,source,version}`, `settings.model_source`.

`lines.epd` is the **final** EPD and is the duplicate/transposition key.
`openings.epd` remains the position before the last move; `openings.epd_after` is
the final position and is what FEN search and position names use.

### Captured-data pipeline

`server/tools/build-captured-data.mjs` reads `recon/` and writes five JSON files
in `server/data/`. `server/seed-data.js` imports those JSON files into SQLite on
boot. Each file is hashed and recorded in `data_sources`, so a restart is a
no-op and a regenerated capture imports once.

| Dataset | Recon source | Imported shape |
|---|---|---|
| position reports/candidates | `recon/live4/network.json` #11–#14 (complete), `live3`/`live2` for the longest variant | 9 reports, 127 candidates (start, after 1.e4, 1.d4, 1.e4 c5, plus partials) |
| annotations | all `fetchPositionReportAndAnnotations` response `annotations` arrays | 15 unique annotations |
| supplementary names | `recon/live4/network.json` #5 (`/api/v1/openings/supplementary`) | 144 complete EPD/name records |
| reference repertoire stats | `recon/live4/network.json` #3 (`home.fetchHome_v2`) | characteristics/coverage/gaps for both reference repertoires |
| reference profile | `recon/live4/network.json` #2 (`/api/user`) | rating band, elo range, training rating |
| courses | `courses[]` inside position-report responses | 21 courses |
| opening guides | `recon/live6/02-openings.json` | 103 guides |
| coaches | `recon/live6/04-coaches.json` | 3 coaches |
| blog | `recon/live6/05-blog.json` | 9 posts |
| model games | `recon/daily-game-full.json`, `recon/model-history-full.json` | Kamsky–Anand daily + Stein–Myagmarsuren history, with 90/86 eval samples |
| openings report | `recon/live4/network.json` #8 | captured array is empty |
| ECO openings | existing `server/data/{a,b,c,d,e}.tsv` | 3,865 rows, versioned by combined SHA-1 |

The real 45-move daily game is now the only seeded model game plus the one real
history game; the old hand-written Dortmund 1992 game is deleted during import.

---

## API reference (new and changed)

All routes remain under `/api`. Existing error shapes are unchanged
(`400 {error}`, `404`, `409 {error,code}`, `422`).

### Builder / gap candidates

#### `GET /repertoires/:key/candidates?epd|fen|moves|line|ply&limit&offset&hideExcluded`

Returns the full ranked candidate list for one position, saved and missing.

```json
{
  "repertoire": { "…stats…" },
  "position": {
    "epd": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
    "fen": "…",
    "side": "black",
    "repertoireSide": "black",
    "isYourTurn": true,
    "prefixMoves": ["e4"],
    "moveNumber": 1,
    "parentLineId": 17,
    "parentLineName": "Sicilian Defense: Najdorf Variation",
    "available": true,
    "source": "recon/live3/network.json#13",
    "complete": true,
    "stockfish": { "eval": 25, "mate": null, "pawns": 0.25, "available": true },
    "savedMoves": [ { "san": "c5", "sanKey": "c5", "lineId": 17, "lineName": "…", "ply": 2 } ],
    "excludedMoves": ["g6"],
    "ratingBand": { "band": "1800-2000", "eloRange": "2000-2200", "ratingSystem": "Chess.com", "singleElo": 2100, "source": "recon/live4/network.json#2", "available": true },
    "incidenceByBand": [ { "band": "1800-2000", "probability": null, "source": "…", "available": true } ],
    "bandsAvailable": true,
    "heading": {
      "prompt": "Choose a response to 1. e4",
      "moveNumber": 1, "side": "black", "label": "1…",
      "lastMove": { "san": "e4", "ply": 1, "moveNumber": 1, "side": "white", "label": "1. e4" },
      "nextMove": { "moveNumber": 1, "side": "black", "label": "1…" }
    },
    "note": null,
    "annotations": [ { "epd": "…", "san": "c5", "text": "A counter-attacking opening…", "mine": false, "source": "…" } ]
  },
  "line": { "…Line view for the containing saved line, or null…" },
  "candidates": [
    {
      "rank": 1,
      "san": "c5",
      "sanKey": "c5",
      "epd": "…",
      "epdAfter": "…",
      "fenAfter": "…",
      "name": "Sicilian Defense",
      "eco": "B20",
      "openingId": 824,
      "friendlyName": null,
      "mastery": 42.7,
      "lineCount": 1,
      "inRepertoire": true,
      "annotation": "A counter-attacking opening…",
      "description": "A counter-attacking opening…",
      "masters": 42.7,
      "masterResults": { "white": 13.9, "draw": 10.9, "black": 42.7, "games": 1789202, "share": 42.7, "whiteWins": 5812, "draws": 4572, "blackWins": 17891 },
      "mastersAvailable": true,
      "peers": { "white": 48.5, "black": 46.1, "draw": 5.4 },
      "peerResults": { "…same plus games/whiteWins/draws/blackWins…" },
      "peersAvailable": true,
      "eval": 45,
      "evalPawn": 0.45,
      "mate": null,
      "evalAvailable": true,
      "probability": 0.2994869540164105,
      "incidence": 0.2938162088394165,
      "incidenceAvailable": true,
      "incidenceByBand": [ { "band": "1800-2000", "probability": 0.2994, "incidence": 0.2938, "available": true } ],
      "oneIn": 3,
      "incidenceLabel": "1 in 3 games",
      "realIncidenceAvailable": true,
      "needed": false,
      "saved": true,
      "excluded": false,
      "playable": true,
      "lineId": 17,
      "lineName": "Sicilian Defense: Najdorf Variation",
      "lineMoveId": 71,
      "parentLineId": 17,
      "parentLineName": "Sicilian Defense: Najdorf Variation",
      "branchMoves": ["e4", "c5"],
      "branchPgn": "1. e4 c5",
      "pgn": "1. e4 c5",
      "danger": 0,
      "source": "recon/live3/network.json#13"
    }
  ],
  "total": 20,
  "offset": 0,
  "limit": null,
  "hasMore": false,
  "nextOffset": null,
  "available": true,
  "stats": { "…stats…" }
}
```

- Candidates are ordered by captured `moveProbability` (play rate), never ECO.
- For Black after `1.e4` the order is `c5, e5, e6, c6, d5, d6, g6, Nf6, Nc6, b6, …`.
- `masters` is the share of captured master games (percent); `peers` is the
  captured results split (percent); `eval` is centipawns.
- `needed` means “not saved at this position”; `saved` means a saved branch
  exists. Both are present in the same list.
- A saved move that is outside the captured top list is appended with
  `statsAvailable:false` and null stats instead of being hidden.
- `available:false`, `candidates:[]`, `stockfish.eval:null` and empty
  `savedMoves` are returned for a position with no capture.

#### `GET /repertoires/:key/gap?epd|fen|moves|line|ply|after|limit|offset`

Same `position` and `candidates` fields as `/candidates`, plus the legacy
`gap`/`line` view and the ranked `gaps` array.

- Default gap: the captured `biggestMiss` when its position has a captured
  report (Black → answer `1.e4`; White → `1.e4 e5` when available), otherwise
  the highest `position incidence × best missing reply probability`.
- `position` adds `incidence`, `oneIn`, `candidateCount`, `savedCount`,
  `missingCount`, `coverage`, `bestMissing`, `capturedMiss`.
- `gaps[]` entries: `{ epd, fen, side, ply, moveNumber, path, pathPgn,
  lastMove, lineId, lineName, incidence, oneIn, weight, missingWeight,
  candidateCount, savedCount, missingCount, coverage, bestMissing,
  capturedMiss, capturedIncidence }`.
- `limit`/`offset` are applied to `candidates`; `hasMore`/`nextOffset` support
  “Show more”.

#### `GET /repertoires/:key/gaps?lineId&limit`

`{ repertoire, gaps: Gap[], total, available }` — all ranked gaps.

#### `GET /repertoires/:key/gap/next?after&epd&lineId`

Returns the next ranked gap after `after` (wraps), using the same shape as
`/gap`. This is the server half of “Go to the next gap in this line”.

### Autofill and exclusions

#### `POST /repertoires/:key/autofill`

```json
{
  "epd": "…optional; defaults to the biggest gap…",
  "style": "expected|aggressive|solid|learnable|sharp|all",
  "maxMoves": 1,
  "allFromHere": false,
  "dryRun": false,
  "excludeMoves": [ { "epd": "…", "san": "d6" } ]
}
```

Response:

```json
{
  "filled": 1,
  "considered": 20,
  "inserted": [
    { "epd": "…", "san": "g6", "name": "Modern Defense", "lineId": 33,
      "created": true, "transpositionOf": null, "rank": 7,
      "style": "expected", "styleScore": 0.0306 }
  ],
  "skipped": [ { "epd": "…", "san": "d6", "reason": "excluded" } ],
  "style": "expected",
  "styles": ["expected","aggressive","solid","learnable","sharp","all"],
  "styleSource": "heuristic-from-captured-fields",
  "dryRun": false,
  "targetEpd": "…",
  "allFromHere": false,
  "positions": [ { "epd": "…", "inserted": 1, "considered": 20, "skipped": 0 } ],
  "repertoire": { "…stats…" }
}
```

Autofill creates real saved branches (`lines.saved=1`, `origin='autofill'`,
`lines.epd` final position) and never flips review flags. It refuses to insert
at an opponent-to-move position (`reason:"not-your-turn"`) or at a position with
no captured report (`reason:"no-captured-report"`). `allFromHere` walks every
ranked gap on the same path prefix (capped at 20 positions).

Style scores are transparent heuristics over captured facts (play rate, eval,
master/peer split, annotation keywords). They are labelled
`styleSource:"heuristic-from-captured-fields"`, not production style points.

#### Exclusions

| Route | Body / query | Response |
|---|---|---|
| `GET /repertoires/:key/exclusions?epd` | — | `{ exclusions:[{id,epd,san,createdAt}], count }` |
| `POST /repertoires/:key/exclusions` | `{ epd, san }` or `{ epd, moves:[…] }` | `201 { ok, added, exclusions }` |
| `DELETE /repertoires/:key/exclusions/:id` | — | `{ ok, deleted }` |
| `DELETE /repertoires/:key/exclusions?epd&san` | — | `{ ok, deleted }` |

Excluded candidates stay in `/candidates` with `excluded:true`,
`playable:false`; autofill filters them out.

### Coverage / characteristics

`statsFor()` now returns captured values instead of nulls:

```json
"characteristics": {
  "available": true,
  "effectiveness": 0.009999999776482582,
  "soundness": 0.9361481666564941,
  "learnability": 0.5857499837875366,
  "avgCpLoss": 0.40024206042289734,
  "expectedResults": 0.5126354694366455,
  "sharpness": 0.40446239709854126,
  "eval": 0.3131141662597656,
  "pathConcessionCp": 10.990166664123535,
  "source": "recon/live4/network.json#3",
  "referenceRepertoireId": "c5af9aa0-8ef3-4806-a8ec-2ce4cd43dbca"
},
"coverage": 0.03542173281311989,
"coveragePercent": 3.5,
"coverageSource": "recon/live4/network.json#3",
"chapterCount": 0
```

These are the reference account's captured characteristics, attached only to
the seeded/reference repertoire (`source='seed'`). A user-created or legacy
repertoire gets `available:false` and all nulls — they are never computed from
`learned/mastered` and never borrowed from a different move set.

#### `GET /repertoires/:key/coverage`

```json
{
  "repertoire": { "…stats…" },
  "available": true,
  "coverage": 74.7,
  "capturedCoverage": 0,
  "source": "captured-position-reports",
  "positionsWithReport": 5,
  "positionsWithoutReport": 51,
  "positions": [
    {
      "epd": "…", "fen": "…", "side": "black", "prefixMoves": ["e4"],
      "available": true,
      "coverage": 30,
      "savedCount": 6,
      "candidateCount": 20,
      "missing": [ { "san": "d6", "name": "Pirc Defense", "probability": 0.0508,
                     "incidence": 0.0537, "oneIn": 19, "eval": 59, "masters": 4.4 } ]
    },
    { "epd": "…", "available": false, "coverage": null, "savedCount": 1,
      "candidateCount": null, "missing": [] }
  ]
}
```

Coverage is probability mass answered; a position without a capture is
`available:false` with a null coverage, not zero.

#### `GET /repertoires/:key/position-report?epd|fen|moves|line`

Full single-position view including `report`, `annotations`, `heading`, `name`
and all candidates.

### Chapters, clone, transpositions, trim, import/export

| Route | Purpose / response |
|---|---|
| `POST /repertoires/:key/clone` | `{ name?, description? }` → `201 { repertoire, sourceId, cloned:{lines,notes} }`; copies lines/notes/chapters, not review state. |
| `GET /repertoires/:key/chapters` | `{ chapters:[{id,name,description,sortOrder,lineCount,createdAt,updatedAt}], count, available:true }` |
| `POST /repertoires/:key/chapters` | `{ name, description?, sortOrder? }` → `{ chapter }` |
| `PATCH /chapters/:id` | `{ name?, description?, sortOrder? }` → `{ chapter }` |
| `DELETE /chapters/:id` | `{ ok, deleted }`; lines keep existing, `chapter_id` becomes null. |
| `PATCH /lines/:id` | existing fields plus `chapterId`. |
| `GET /repertoires/:key/transpositions` | `{ repertoire, groups:[{epd,final,lines:[{lineId,name,moves,ply,final}]}], count, available }`; groups every shared EPD, final transpositions first. |
| `POST /repertoires/:key/transpositions/merge` | `{ epd?, keepLineId? }` → `{ ok, removed, merged, repertoire }`; keeps one line per final EPD. |
| `POST /repertoires/:key/trim` | `{ mode:"autofilled|rare|sidelines|pastGoal", dryRun?, threshold?, coverageGoal? }` → `{ ok, mode, dryRun, removed:[{lineId,reason}], removedCount, remaining, repertoire }`. |
| `POST /repertoires/:key/import` | `{ pgn }` / `{ text }` / raw `text/plain` body. Multi-game PGN supported. Response `{ ok, imported, transpositions, total, trimmed, results:[{ok,lineId,created,transposition,transpositionOf,trimmed,moves,name}], repertoire }`. |
| `GET /repertoires/:key/export?format=pgn|json&download=1` | `pgn` sends `application/x-chess-pgn`; `json` sends `{format:"chessbook-repertoire",version:1,exportedAt,repertoire,chapters,lines,notes}`. |

`POST /repertoires/:key/lines` and `/moves` now merge by final EPD and return
`{ created, transposition, transpositionOf }` in addition to the old fields.

### Model games

| Route | Response |
|---|---|
| `GET /model-games?source=historical|masters|online` | `{ games:[Summary], total, dailyGameId, source, available, reason }`; `online` returns an empty list with an explicit reason because no online account exists. |
| `GET /model-games/daily?date&force_new_game=1&random=1` / `POST /model-games/daily` | `{ game: Detail, daily:{date,gameId,selection:"date|stored|forced|random",forceNew} }` |
| `GET /model-games/random?exclude=` | `{ game: Detail, random:true }` |
| `GET /model-games/next?after=` | `{ game: Detail, next:true }` |
| `GET /model-games/history?groupBy=week|day&includeDaily=0` | `{ groupBy, total, games, weeks:[{weekStart,weekEnd,label,games}], available, source }` |
| `GET /model-games/:id` | `{ game: Detail }` |
| `POST /model-games/:id/progress` | `{ ply, reviewed?, score? }` → `{ ok, ply, progress:Progress }`; out-of-range is `400 {code:"ply_out_of_range",total}`. |
| `GET /model-games/:id/review` | `{ gameId, review, analysis, annotations, annotationsAvailable, available, engineReviewAvailable:false }` |
| `POST /model-games/:id/review` | `{ reviewed?, score? }` → `{ ok, progress, review, analysis, engineReviewAvailable:false }` |

`Detail` keeps the old `id/white/black/event/year/result/pgn/description` fields
and adds:

```json
{
  "id": 1,
  "externalId": "52315c60-…",
  "white": "Kamsky", "black": "Anand",
  "whiteFullName": "Kamsky, Gata", "blackFullName": "Anand, Viswanathan",
  "event": "Candidats FIDE sf1", "eventName": "Candidats FIDE sf1",
  "year": null, "playedAt": "2026-10-23T07:04:08.457Z", "capturedAt": "…",
  "result": "1-0", "resultTag": "1-0", "outcome": "white", "resultLabel": "White won",
  "link": null, "linkAvailable": false,
  "daily": true, "reviewed": false, "progress": 0,
  "players": {
    "white": { "name": "Kamsky, Gata", "shortName": "Kamsky", "elo": 2695, "title": null },
    "black": { "name": "Anand, Viswanathan", "shortName": "Anand", "elo": 2720, "title": null }
  },
  "performances": { "white": { "blunders": 0, "mistakes": 0, "inaccuracies": 1 }, "black": { "…" } },
  "analysis": { "available": true, "source": "captured", "engineReviewAvailable": false,
                "engineReviewReason": "No Stockfish service is bundled with the local-first build.", "performances": { "…" } },
  "annotations": [], "annotationsAvailable": false,
  "moves": ["e4","c5","…"],
  "plies": [ { "ply": 1, "moveNumber": 1, "side": "white", "san": "e4",
               "epdBefore": "…", "epdAfter": "…", "fenBefore": "…", "fenAfter": "…",
               "evalBefore": 32, "evalAfter": 0, "evalCp": 0, "evalPawn": 0, "evalAvailable": true } ],
  "moveCount": 89,
  "evalSamples": [ { "ply": 0, "epd": "…", "evalCp": 32, "evalPawn": 0.32, "available": true } ],
  "evalGraph": { "available": true, "source": "captured", "samples": [ "…" ], "mateSupported": false },
  "openingMatch": {
    "available": true,
    "line": { "lineId": 18, "lineName": "Sicilian Defense: Accelerated Dragon",
              "repertoireId": 2, "repertoireName": "Black openings",
              "repertoireColor": "black", "moves": ["…"], "matchedPlies": 10,
              "matchedPercent": 11.2, "openingId": null },
    "guide": { "slug": "sicilian-defense-accelerated-dragon", "name": "…", "eco": "B34",
               "matchedPlies": 8, "moves": ["…"] }
  },
  "review": { "reviewed": false, "score": null, "reviewedAt": null },
  "progressState": { "ply": 0, "total": 89, "percent": 0, "completed": false,
                     "reviewed": false, "score": null, "completedAt": null,
                     "reviewedAt": null, "updatedAt": null }
}
```

The eval samples are the captured values (first sample is 32cp, not a flat
`+0.3`). `evals` (the old graph-friendly array) is `evalCp` per sample;
`evalsAvailable` mirrors `evalGraph.available`.

### Openings, supplementary and FEN search

#### `GET /openings/supplementary?epd|fen&q&limit&offset`

```json
{
  "positions": [ { "epd": "…", "fullName": "Caro-Kann Defense", "friendlyName": null,
                   "source": "recon/live4/network.json#5" } ],
  "count": 1,
  "total": 144,
  "offset": 0,
  "hasMore": false,
  "source": "recon/live4/network.json#5 (/api/v1/openings/supplementary)"
}
```

An absent EPD returns `{positions:[], count:0, available:false}`. The captured
`friendlyName` fields are all `null`; no friendly names were invented.

#### `GET /openings/position?epd|fen|moves`

```json
{
  "position": {
    "epd": "…", "fen": "…", "side": "black",
    "name": "…", "fullName": "…", "friendlyName": null,
    "aliases": [ { "fullName": "…", "friendlyName": null, "targetEpd": "…", "kind": "transposition" } ],
    "annotations": [ "…" ],
    "plans": [], "plansAvailable": false,
    "stockfish": { "eval": 25, "mate": null, "pawns": 0.25, "available": true },
    "masterResults": { "white": 1649637, "draw": 1140535, "black": 1403193 },
    "peerResults": { "white": 231850257, "draw": 26393952, "black": 214370445 },
    "reportAvailable": true, "reportSource": "…", "complete": true,
    "ratingBand": { "band": "1800-2000", "eloRange": "2000-2200", "ratingSystem": "Chess.com",
                    "singleElo": 2100, "source": "…", "available": true },
    "incidenceByBand": [ { "band": "1800-2000", "probability": null, "available": true } ],
    "bandsAvailable": true
  },
  "candidates": [ "…Candidate objects…" ],
  "available": true,
  "source": "…"
}
```

#### `GET /openings/guides?side&q` and `GET /openings/guides/:slug`

Index: `{ guides:[{id,slug,eco,name,side,family,moves,pgn,epd,coverage,
coveragePercent,course,source}], white:[], black:[], total, available, source }`.

Detail: `{ guide:{ id,slug,eco,name,side,family,moves,pgn,epd,steps,notes,
notesAvailable,plans,plansAvailable,reportAvailable,coverage,coveragePercent,
course,source } }`. `steps[]` has `{ply,moveNumber,side,san,epd,fen,fenAfter,
annotation,name}`.

`GET /openings/:slug` redirects (307) to the same guide detail for clients that
use the production path shape.

#### `GET /openings/report?timeRange=90d`

```json
{
  "timeRange": "90d",
  "available": true,
  "capturedAvailable": false,
  "captured": [],
  "source": null,
  "weak": [],
  "worst": [],
  "reason": "No reviewed lines in this local profile yet.",
  "importedAt": "…"
}
```

When reviews exist, weak/worst are computed from real local review rows
(`name,lineId,color,reviews,correct,wrong,accuracy,source:"local-reviews"`).
The captured `/api/v2/openings_report` response was an empty array, so
`capturedAvailable:false` is explicit.

#### `GET /openings?fen|epd`

Existing name/ECO/prefix search still works. Passing `fen`/`epd` now searches
`openings.epd_after` (the final position) and returns `positions` with the
captured name, report availability and annotations, plus matching rows.

#### `GET /openings/imports` / `POST /openings/reimport`

`imports` lists `{source,version,rows,importedAt}` and `current` lists loaded
versions. `reimport` forces the current TSV hash to be re-imported (or reports
`skipped:true` under `CHESSBOOK_SKIP_OPENINGS=1`).

### Courses, coaches, blog

| Route | Response |
|---|---|
| `GET /courses?side&q&official&limit&offset` | `{ courses:[Course], total, offset, hasMore, available, source }` |
| `GET /courses/:idOrSlug` | `{ course: Course & { chapters, chaptersAvailable, guide } }` |
| `POST /courses/:idOrSlug/clone` | `{ name? }` → `201 { repertoire, course, imported, guide, chapters:[], chaptersAvailable:false, note }` |
| `GET /coaches`, `GET /coaches/:slug` | `{ coaches:[Coach], total, available, source }` / `{ coach }` |
| `GET /blog`, `GET /blog/:slug` | `{ posts:[Post], total, available, source }` / `{ post, bodyAvailable:false }` |

`Course`: `{id,slug,name,side,authorName,authorTitle,avatarImage,description,
descriptionShort,official,featured,moveCount,coverage,coveragePercent,eloRanges,
characteristics:{available,…captured fields},videoId,source}`.

`Coach`: `{id,slug,name,rating,headline,bio,languages,price,platforms,
firstLessonFree,source}`. `Post`: `{id,slug,title,publishedAt,excerpt,sortOrder,
source}`.

Course chapters are empty and `chaptersAvailable:false` because the capture does
not contain a course move tree. Cloning uses the matching captured opening guide
line (when one exists) so it is not an empty shell with invented moves.

---

## Caveats / deliberate decisions

1. **Only one captured history game.** `model_game_history` returned one game
   (Stein–Myagmarsuren). The real daily game plus that one history entry are all
   that is seeded; no fake weeks were added. History grouping therefore has two
   weeks, not “weeks of games”.
2. **One rating band.** The captures cover `ratingRange:"1800-2000"` /
   `eloRange:"2000-2200"`. `incidenceByBand` returns exactly that band; other
   bands are not synthesised. `bandsAvailable` says so.
3. **One reference repertoire's characteristics.** `characteristics`,
   `coverage`, `biggestMiss` and `gaps` are attached only to the seeded/reference
   repertoire. A user-created repertoire or an upgraded legacy repertoire shows
   `available:false` and nulls. This avoids borrowing numbers from a different
   move set.
4. **Truncated captures.** The supplementary response was cut at 20,000 bytes,
   so 144 complete EPD/name records were salvaged, not “thousands”. Candidate
   lists after `1…Nf3` etc. are partial; `masters` is `null` for those because
   the master denominator is unknown. Complete lists (start, `1.e4`, `1.d4`,
   `1.e4 c5`) do report Masters.
5. **No friendly names in the capture.** All captured `friendlyName` values are
   `null`; the API supports the field and returns `null` rather than inventing
   aliases. Transposition aliases are created only from duplicate captured names.
6. **No guide notes/plans in the capture.** Guide notes appear only where the
   position also appears in an annotation capture; `plans` is `[]` with
   `plansAvailable:false`. Guide routes are real titles/lines/ECOs.
7. **No course move tree.** Course metadata and characteristics are real; there
   are no chapters/moves to import. Clone seeds the matching captured guide line
   and states that in the response.
8. **Openings report capture is empty.** The endpoint is available, reports
   `capturedAvailable:false`, and computes weak/worst only from real local
   review rows.
9. **Model review has no Stockfish.** Captured performances are exposed as
   `analysis.source:"captured"`; `engineReviewAvailable:false` is explicit.
10. **No invented game dates.** The capture has `year:null`/`playedAt:null` for
    both games; history grouping uses the captured `createdAt` as `capturedAt`.
11. **Autofill style scores are heuristics.** They are transparent functions of
    captured probability/eval/master/peer/annotation data, not production
    “style points”, and are labelled as such.
12. **Raw PGN file text.** `express.text` accepts `text/plain`,
    `application/x-chess-pgn` and `application/pgn` up to 2 MB in addition to
    JSON `{pgn}`/`{text}`.
13. **Existing databases.** Migration v2 backfills final EPDs, renames the old
    Dortmund model game away, imports the real games, and leaves legacy
    repertoires with `characteristics.available:false` instead of guessing.
14. **Openings are versioned, not re-imported every boot.** A combined SHA-1 of
    the five TSVs is recorded in `opening_imports`; a changed hash replaces the
    `source='lichess-eco'` rows once.
15. **Coverage can differ from the reference `coverage`.** `stats.coverage` is
    the captured reference value; `GET /coverage` computes local coverage from
    captured candidate reports and is the honest measure for the local move set.

---

## Verification

### 1. Fresh temp DB + `PORT=8792`

`CHESSBOOK_DB=<temp>`, `CHESSBOOK_SKIP_OPENINGS=1`, `node server/index.js`:

```
Black after 1.e4: c5 1 in 3 masters=42.7 eval=45 Sicilian Defense
                 | e5 1 in 4 masters=21.2 eval=27
                 | e6 1 in 8 masters=13.1 eval=35 French Defense
                 | c6 1 in 9 masters=8.7 eval=37 Caro-Kann Defense
                 | d5 1 in 13 masters=3.5 eval=78 Scandinavian Defense
Autofill: 1 ['g6'] saved 15
Daily game: Kamsky vs Anand | Candidats FIDE sf1 | White won | 89 moves | evals 90 | elo 2695 2720
History: 2026-10-19: Kamsky–Anand ; 2024-12-23: Stein–Myagmarsuren
Stats: effectiveness=0.01 soundness=0.936 learnability=0.586 avgCpLoss=0.400 coverage=0.0354
RESULT 16 passed, 0 failed
```

The same run confirmed:

- `/candidates` returns 20 candidates for Black after `1.e4` with `saved` flags
  (`c5…d5` saved, `d6/g6/Nf6…` needed);
- an uncaptured position (`1.a3`) returns `available:false`, `candidates:[]`,
  `stockfish.eval:null`;
- autofill with `excludeMoves:[{san:"d6"}]` inserted `g6` (not `d6`);
- daily/force-new, history weeks, supplementary name, 21 courses, 103 guides,
  3 coaches, 9 posts, report availability and characteristics all respond.

With openings enabled on a fresh DB, the Black list resolves names/ECOs exactly:
`c5 Sicilian Defense B20`, `e5 King's Pawn Game C20`, `e6 French Defense C00`,
`c6 Caro-Kann Defense B10`, `d5 Scandinavian Defense B01`, `d6 Pirc Defense B00`,
`g6 Modern Defense B06`, `Nf6 Alekhine Defense B02`, `Nc6 Nimzowitsch Defense B00`,
`b6 Owen Defense B00`.

### 2. `node --test tests/server`

**46 tests, 46 pass, 0 fail** — including 13 new tests in
`tests/server/data.test.js` (candidate ordering, gap ordering/heading, honest
unavailability, autofill + exclusions, trim, chapters/clone/export, PGN
import/transposition, supplementary/guides/courses, characteristics/coverage,
model daily/history/evals/review, openings report, import versioning).

### 3. Existing database upgrade

`VACUUM INTO` copy of `server/data/chessbook.db`:
`PRAGMA user_version` 0 → 2; 100 lines preserved; 9 reports imported; the old
Dortmund model game replaced by Kamsky–Anand and Stein–Myagmarsuren;
`checkDatabase()` → `ok:true`, 0 errors. Legacy repertoires keep
`characteristics.available:false`.

### 4. Client build

`npm run build` → `✓ built in 167ms` (45 modules). The untouched client
compiles.

---

## Owned D-ID checklist

- [x] **D035** — `/repertoires/:key/candidates` returns all 20 captured candidates, not only saved lines; tests assert 20 and the exact first five.
- [x] **D036** — `masters` is the captured master-game share (c5 = 42.7%), with null when the capture is partial.
- [x] **D037** — `eval`/`evalPawn` come from `stockfish.eval` (c5 = 45cp); no hashes.
- [x] **D038** — `peers` is the captured results split (c5 48.5/46.1/5.4); no hash bars.
- [x] **D039** — `incidence`, `probability`, `oneIn`, `incidenceLabel` from the capture (c5 → 1 in 3).
- [x] **D040** — candidate `annotation`/`description` from captured annotations; null when absent.
- [x] **D044** — autofill inserts real `lines` rows with `saved=1` and increments Saved (tested).
- [x] **D045** — `style` supports expected/aggressive/solid/learnable/sharp/all; `styleSource` labels the heuristic.
- [x] **D046** — `allFromHere:true` walks ranked gaps on the same path prefix and autofills each.
- [x] **D047** — autofill takes `epd` and only inserts at that gap.
- [x] **D048** — persisted exclusions API; candidates expose `excluded`; autofill skips them (tested).
- [x] **D049** — `/gap/next` and `/gaps?lineId` return the next ranked gap in a line.
- [x] **D059** — stats expose captured effectiveness/soundness/learnability/avgCpLoss/expectedResults/sharpness; not arithmetic.
- [x] **D062** — repertoire chapters CRUD, `lines.chapter_id`, `chapterCount`, chapter listing; course chapters explicit `chaptersAvailable:false`.
- [x] **D063** — `POST /repertoires/:key/import` accepts `{pgn}`, `{text}`, or raw PGN text; multi-game.
- [x] **D064** — `GET /repertoires/:key/export?format=pgn|json`.
- [x] **D065** — lines dedupe on final EPD; `/transpositions` and `/transpositions/merge`.
- [x] **D066** — `POST /repertoires/:key/trim` supports autofilled/rare/sidelines/pastGoal with dry-run.
- [x] **D071** — gap ranking uses captured biggestMiss or position incidence × best missing reply; test asserts Black gap is after 1.e4.
- [x] **D072** — gap/BI candidates ordered c5, e5, e6, c6, d5.
- [x] **D073** — Masters/Eval/Peer labels now carry real captured values.
- [x] **D074** — candidate descriptions/annotations are surfaced.
- [x] **D075** — `limit`/`offset` + `hasMore`/`nextOffset` on gap and candidates (“Show more”).
- [x] **D076** — “Autofill this gap” is the `epd`-specific autofill, not the old global flag flip.
- [x] **D079** — `position.heading` derives the previous move and next mover; prefix ending on Black says `1… c5` with next move number 2.
- [x] **D094** — real daily game + real history entry seeded; `/model-games/history`.
- [x] **D095** — Kamsky–Anand, Candidats FIDE sf1, 89 plies (45 moves), White won, players/ratings.
- [x] **D096** — `GET|POST /model-games/daily`, `force_new_game`, persisted daily selection.
- [x] **D097** — `/model-games/random` and `/model-games/next`.
- [x] **D098** — history grouped by ISO week with `weeks[]`.
- [x] **D101** — `evalSamples`/`evalGraph` from captured evals (90 samples for the daily game); no flat +0.3.
- [x] **D102** — `GET|POST /model-games/:id/review`, captured performances, explicit `engineReviewAvailable:false`.
- [x] **D103** — progress validates/clamps ply and stores completed/reviewed/score.
- [x] **D104** — `settings.modelSource` filters `/model-games?source`; `online` returns an explicit empty reason.
- [x] **D105** — `openingMatch.line` (longest saved-line prefix) and `openingMatch.guide`.
- [x] **D106** — players/ratings/titles, `link` (null when not captured), captured annotations and `annotationsAvailable`.
- [x] **D109** — `GET /openings/report` weak/worst from real reviews, captured availability explicit.
- [x] **D120** — `opening_names` from supplementary; `/openings/supplementary`.
- [x] **D121** — `ratingBand` + per-candidate `incidenceByBand` for the one captured band; no invented bands.
- [x] **D122** — master/peer/Stockfish stats in `/openings/position` and candidates.
- [x] **D123** — per-position `annotations`, `plans`, `plansAvailable`, report source.
- [x] **D124** — 21 real pre-made courses with authors/coverage/characteristics.
- [x] **D125** — 103 real opening guides with lines/steps; notes where captured.
- [x] **D126** — guide slug detail + `/openings/:slug` fallback.
- [x] **D127** — supplementary aliases + transposition groups/merge; matching by EPD.
- [x] **D128** — guide/course coverage and local `/repertoires/:key/coverage`.
- [x] **D129** — weak/worst openings report API.
- [x] **D130** — `/openings?fen|epd` and `/openings/position`.
- [x] **D131** — coaches and blog data/API (data-only scope).
- [x] **D132** — pre-made repertoire catalogue `/courses`, detail, clone.
- [x] **D163** — opening guide index/detail data (data-only scope).
- [x] **D164** — coach directory/detail data (data-only scope).
- [x] **D165** — blog index/detail data (data-only scope).
- [x] **D199** — opening import is hashed/versioned in `opening_imports`, no longer “if rows exist, stop”.
- [x] **D200** — new APIs for candidates/gaps/coverage/characteristics/exclusions/chapters/transpositions/import/export/courses/guides/coaches/blog/report/model daily/history/review.
- [x] **D209** — PGN import and PGN/JSON export endpoints.

### Supporting D-IDs

- [x] **D075 support** — pagination/`hasMore` on candidates.
- [x] **D076 support** — gap-scoped autofill.
- [x] **D044 support** — `inserted[].lineId`/`created`/`transpositionOf` let the client update Saved/branches.
- [x] **D095 support** — old `GET /model-games` fields remain; `moves` stays SAN strings and `plies` is the detailed list.
- [x] **D103 support** — `progressState` remains in `GET /model-games` and adds `reviewed/score/completedAt/reviewedAt`.

---

## Files

- `server/schema.js` — migration v2 (tables, columns, EPD backfills).
- `server/seed-data.js` — idempotent JSON → SQLite import with provenance hashes.
- `server/tools/build-captured-data.mjs` — reproducible `recon/` → `server/data/` extractor.
- `server/data/captured-{positions,courses,openings,content,model-games}.json` — imported real data.
- `server/opening-data.js` — report/candidate/name/heading/rating-band queries + style ranking.
- `server/gaps.js` — weighted biggest-gap ranking and next-gap selection.
- `server/branches.js` — EPD-deduped branch/line insertion.
- `server/pgn.js` — multi-game PGN parse, PGN/JSON export.
- `server/model-games.js` — daily/history/random/detail/review/progress.
- `server/api.js` — all new routes and additive changes.
- `server/db.js` — versioned ECO import, captured-data bootstrap, slugged repertoires.
- `server/index.js` — raw PGN text body parsing + 4xx error passthrough.
- `server/repertoire.js` — captured characteristics/coverage in stats; chapter/origin fields on lines.
- `tests/server/data.test.js` — 13 new server-data tests.
- `tests/server/integrity.test.js` — expected schema version updated to 2.
