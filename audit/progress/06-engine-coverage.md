# Batch 6 — real Stockfish 19 and offline explorer coverage

Owner: `engine-coverage`
Scope: `server/engine.js` (new), `server/explorer-data.js` (new),
`server/seed-lines.js` (new), `server/tools/build-explorer-data.mjs` (new),
`server/data/explorer-masters.json` (new snapshot),
`server/data/explorer-lichess.json` (new snapshot), plus edits to
`server/api.js`, `server/schema.js`, `server/db.js`, `server/opening-data.js`,
`server/gaps.js`, `server/refutation.js`, `server/model-games.js`,
`tests/server/**` and this report.

Status: **implemented and verified. Nothing committed.** No server or engine
process is left running. All live checks used a throwaway SQLite database on
port **8791**; the database and logs were deleted afterwards.

---

## 1. What changed

### D203 — real Stockfish 19

There is now a real engine service, not a heuristic pretending to be one.

- `server/engine.js` lazily spawns **Stockfish 19 Lite WASM** from
  `node_modules/stockfish/bin/stockfish-19-lite-single.js` (with fallbacks to
  `stockfish-19-lite.js`, `stockfish-19-single.js`, `stockfish-19-asm.js`).
  `CHESSBOOK_STOCKFISH_PATH` can override the path.
- No process is spawned at import. The first `analyse` starts one persistent
  UCI worker. Requests are serialised through a promise queue; each request has
  a 20 s timeout and a `stop` fallback.
- Every result carries `engine: { name, version, id, path }`, `source:
  "stockfish"` and `depth` (or explicit `available:false` + reason).
- Public contract:
  - `analyse(fen, { depth, multipv })`
  - `bestMove(fen, { depth })`
  - `evaluate(fen, { depth })`
  - `refute(fen, playedSan, { depth })`
  - `reviewGame(fens, { depth })`
  - `status()`, `close()`
- Default analysis depth is 12 (clamped 1–30); `multipv` is clamped 1–20.
  Candidate evals use depth 10 by default (clamped to the request depth).
  `CHESSBOOK_ENGINE_DISABLED=1` forces the unavailable/fallback path (used by
  tests; no fabricated score is produced).
- `evaluateCached(db, fen, { depth })` reads/writes `engine_evals` in SQLite
  and keeps an in-memory LRU, so repeated build/gap views do not re-search.
  Only real engine output is stored.
- Wrong-move refutation (`server/refutation.js`) now awaits
  `engine.refute()`. The reply is Stockfish’s best move from the position after
  the played move; damage is the White-POV eval swing between best play before
  and after the move. The old material/mate search still exists **only** as a
  labelled fallback: `source:"heuristic"`, `engine:"chessbook-heuristic"`,
  `fallback:true`, `fallbackReason`.
- Model-game review (`server/model-games.js`) produces real per-move evals,
  engine best moves, centipawn loss and `best/good/inaccuracy/mistake/blunder`
  classifications. Thresholds are 70/150/300 cp. Payloads are cached per
  `(game_id, depth)` in `model_game_reviews`. The captured eval graph is still
  returned unchanged as historical data (`evalGraph.source:"captured"`).
- Candidate/position evals are filled by `applyEngineEvals()` in
  `server/opening-data.js`, called only by the API endpoints that render
  candidates (never by the internal gap-ranking walk). Captured evals win; only
  missing values are evaluated.

### Offline masters + peer explorer corpora

New builder: `server/tools/build-explorer-data.mjs`.

```bash
node server/tools/build-explorer-data.mjs \
  --players=Carlsen,Kasparov,Anand,Karpov,Fischer,Tal,Kramnik,Caruana,Nakamura,Ding,Firouzja,So,Aronian,Topalov,Ivanchuk,Short \
  --months=2013-01,2013-02,2013-03
```

- **Masters corpus** — 16 public PGN Mentor player archives
  (`https://www.pgnmentor.com/players/<Player>.zip`), parsed with `chess.js`.
  Per position it aggregates total games, white/draw/black results and per-move
  play counts/results.
- **Peer corpus** — Lichess standard rated monthly dumps
  (`https://database.lichess.org/standard/lichess_db_standard_rated_<month>.pgn.zst`),
  decompressed with Node 26 `zlib.createZstdDecompress`. Band = the **rating of
  the side to move**, bucketed as `<1200`, `1200-1599`, `1600-1799`,
  `1800-1999`, `2000-2399`, `2400+`.
- Only app-relevant positions are aggregated: every EPD along every ECO line in
  `server/data/{a,b,c,d,e}.tsv` up to 14 plies, plus every seeded repertoire
  line (`server/seed-lines.js`). That is **6,488 target EPDs** from **3,865 ECO
  lines**. Games stop being walked once they leave the target set for four
  plies, which keeps generation fast and the snapshots small.
- Opening names are selected per EPD from the ECO rows (terminal names first,
  then passing names, then shortest/lexicographic). The snapshot stores 6,474
  names.
- Downloads are cached in the OS temp directory, never in the repository.

Committed snapshots (compact JSON, deterministic ordering, content hash in
`meta.version`):

| Snapshot | Bytes | Games | Positions with data | Move rows | Provenance |
|---|---:|---:|---:|---:|---|
| `server/data/explorer-masters.json` | 1,305,772 (1.31 MB) | 71,364 | 4,586 | 13,250 | 16 PGN Mentor archives, version `b3ea68a76fd0622e` |
| `server/data/explorer-lichess.json` | 1,844,359 (1.84 MB) | 403,928 | 5,122 | 66,542 | Lichess 2013-01/02/03 (121,332 + 123,961 + 158,635), version `548afe752391afe7` |
| **Total** | **3,150,131 (3.15 MB)** | **475,292** | | **79,792** | |

Both files carry `_provenance` (source URLs, players/months, archive sizes,
game counts, generatedAt) and `meta` (version, target count, bands, note).

### Migration v4 and import

`server/schema.js` migration **v4** adds:

- `explorer_reports(dataset, epd, games, white, draw, black, name, source, version, …)`
- `explorer_moves(report_id, epd, san, san_key, games, white, draw, black, rank)`
- `explorer_band_positions(dataset, epd, band, games, white, draw, black)`
- `explorer_band_moves(dataset, epd, band, san, san_key, games, white, draw, black, rank)`
- `explorer_imports(dataset, version, games, positions, moves, bands, file_size, file_mtime, generated_at, imported_at)`
- `engine_evals(fen, depth, cp, mate, best_san, best_uci, pv, engine, created_at)`
- `model_game_reviews(game_id, depth, engine, payload, created_at)`

`server/explorer-data.js#importExplorerData()` imports both snapshots at boot
after the captured data, inside one transaction per dataset, and records
`explorer_imports` + `data_sources`. The fast path compares file size/mtime with
the last import, so a normal boot does not parse the JSON at all. Measured:

- first boot (fresh DB, both snapshots + migration; ECO TSV import skipped): **1.08 s**
- second boot (stat fast path): **0.24 s**

Opening names from the snapshots are inserted into `opening_names` only when no
captured row exists, so captured supplementary names always win.

---

## 2. Merge precedence and response shape

Every candidate/position read now follows this order, field by field:

1. **Captured production report** — `position_reports` / `position_candidates`.
   Authoritative wherever a value exists. Captured candidate order is preserved
   (verified: Black after `1.e4` is still `c5, e5, e6, c6, d5`).
2. **Local masters corpus** — `explorer_*` masters rows. Fills missing masters
   share/results and missing candidates when the capture was truncated. It is
   never used to overwrite a captured number.
3. **Lichess band corpus** — `explorer_band_*` for the profile’s band
   (`singleElo`/`eloRange` mapped to `<1200 … 2400+`). Fills peer results,
   incidence and `1 in N`.
4. **Stockfish 19** — fills every eval the capture did not provide. Results are
   cached in memory and `engine_evals`.
5. If none has data: `available:false`,
   `unavailableReason:"No captured production report and no offline explorer
   data for this position."`, empty candidates. No numbers are invented.

Existing response shape is preserved. Added fields:

- Position/candidate `sources: { captured, masters, lichess, engine }`
- Position `games: { masters, band, bandLabel, total }`,
  `openingName`, `engineAvailable`, `unavailableReason`, `source`
- Candidate `openingName`, `games`, `mastersGames`, `peerGames`,
  `evalSource`, `evalDepth`, `evalEngine`, `incidenceSource`,
  `nameSource`, `sourceDetail`
- `/gap` adds `candidateSource`, and its `position.incidence`/`oneIn` now come
  from the explorer when no capture exists.

Wrong-move refutations add `engineName`, `engineVersion`, `source`
(`stockfish`/`heuristic`), `fallback`, `fallbackReason`, `evalCp`,
`damageCp`.

### Endpoint changes

| Endpoint | Change |
|---|---|
| `GET /api/engine/status` | **new** — real availability, engine name/version/path, started state, depth, request count, explorer import status |
| `GET /api/engine/eval?fen=&depth=&multipv=` | **new** — live Stockfish lines, best move, White-POV eval, depth, nodes/time; 400 on invalid FEN |
| `GET /api/repertoires/:key/candidates` | async; engine-filled evals; adds `source`, `sources`, `engineAvailable`, `unavailableReason`, real masters/peer/incidence for uncaptured positions |
| `GET /api/repertoires/:key/gap` and `/gap/next` | async; engine-filled candidate evals; explorer-backed incidence; `candidateSource` |
| `GET /api/repertoires/:key/position` | adds `candidates`, `stockfish`, `ratingBand`, `games`, `sources`, `engineAvailable` |
| `GET /api/openings/position` | async; engine-filled evals; explorer master/peer totals when no capture |
| `GET /api/repertoires/:key/learn` | common-move queue merges captured incidence with `explorerCommonQueue()`; source is `captured-position-incidence+offline-explorer` when both contribute |
| `POST /api/practice/sessions/:id/attempt` | `await refuteMove()` → Stockfish best reply/eval |
| `GET /api/model-games/:id/review` | **new engine review payload** (`engineReview`, real per-move eval/classification); captured `evalGraph` returned separately |
| `POST /api/model-games/:id/review` | marks reviewed **and** returns a real engine review (`depth`, `engineReview`, `engineReviewAvailable`, `source`) |

The committed captured data is still used exactly as before; this batch only
adds sources and fills gaps.

---

## 3. Verification

### Server tests

```text
node --test tests/server
ℹ tests 91
ℹ pass 91
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

New / updated tests:

- `tests/server/engine.test.js` — status without spawn, legal best move,
  multipv lines, White-POV eval, refutation reply, hanging-queen
  mistake/blunder classification, and the disabled-engine `available:false`
  fallback.
- `tests/server/coverage.test.js` — snapshot import/provenance, captured
  precedence for Black after `1.e4`, a seeded uncaptured position
  (`1.d4 d5 2.c4`) with real masters/peers/incidence/eval, gap/position merge,
  `/learn` merge, explicit unavailability, `/engine/status` and `/engine/eval`.
- Updated existing expectations for Stockfish refutations, explorer-backed
  coverage, model review availability, band-mismatch incidence source and
  schema v4.

### Build

```text
npm run build
✓ 67 modules transformed
✓ built in 698ms
```

Only the pre-existing >500 kB client chunk warning.

### Live API (fresh temp DB, `PORT=8791`)

The machine already had an unrelated Python listener on IPv4 `127.0.0.1:8791`,
so the isolated Node server was reached over IPv6 loopback (`http://[::1]:8791`).
It used a fresh database path under the OS temp directory; it was deleted after
the checks and the Node process was killed.

1. **Captured precedence — Black after `1.e4`**

```json
{"order":["c5","e5","e6","c6","d5"],
 "source":["recon/live3/network.json#13"],
 "captured":"recon/live3/network.json#13",
 "masters":"pgnmentor-masters",
 "lichess":"lichess-band",
 "band":"2000-2399"}
```

Values remained the captured ones (`c5` masters 42.7, peers 48.5,
incidence 0.2938162088394165, `1 in 3`, eval 45).

2. **Non-captured seeded position — after `1.d4 d5 2.c4`**

```json
{"available":true,
 "epd":"rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq -",
 "name":"Queen's Gambit",
 "games":{"masters":3931,"band":606,"bandLabel":"2000-2399","total":18544},
 "sources":{"captured":null,"masters":"pgnmentor-masters","lichess":"lichess-band","engine":"stockfish"},
 "stockfish":29,
 "top":[{"san":"e6","masters":31.4,"peerWhite":35.5,"oneIn":2,"eval":29},
        {"san":"c6","masters":50,"peerWhite":27.4,"oneIn":3,"eval":30},
        {"san":"dxc4","masters":15.8,"peerWhite":19,"oneIn":10,"eval":29}]}
```

Gap at the same position returned `candidateSource:"lichess-band"`,
`position.incidence:0.6717` (`1 in 1`), and engine evals on every candidate.

3. **Engine endpoints**

```json
{"available":true,"stockfish":true,"started":true,
 "name":"Stockfish 19 Lite WASM","version":"19","defaultDepth":12,
 "explorer":{"mastersPositions":4586,"masterMoves":13250,
             "bandPositions":17205,"bandMoves":66542}}
```

```json
{"stockfish":true,"engine":"Stockfish 19 Lite WASM","version":"19",
 "depth":10,"evalCp":29,"bestSan":"Nf6",
 "lines":[{"san":"Nf6","cp":29},{"san":"e6","cp":29},{"san":"c6","cp":31}]}
```

4. **Model review** — `GET /api/model-games/1/review?depth=6` returned the
   real 89-ply review: 47 best, 39 good, 2 inaccuracies, 1 mistake, 0 blunders,
   ACPL 28.4, source `stockfish`, while `capturedEvalGraph.source` remained
   `captured`.

5. **`/learn`** — `common:40`,
   `commonSource:"captured-position-incidence+offline-explorer"`, with 40
   offline-explorer entries for the white repertoire.

No server or engine process was left running; `pgrep stockfish-19-lite-single`
and the 8791 Node listener were empty after cleanup.

---

## 4. D-ID / limitation checklist

- [x] **D203** — real Stockfish 19 is bundled and used. No eval is labelled
      Stockfish unless it came from the engine.
- [x] **D020** — wrong-move refutation uses Stockfish’s best reply and eval.
- [x] **D036/D037/D038** — Masters / Eval / Peer results are real for every
      seeded position now, not only captured ones; no hash fallbacks remain.
- [x] **D039/D121** — incidence and `1 in N` come from captured reports or the
      Lichess band corpus, with `incidenceSource`.
- [x] **D120** — opening names use captured supplementary names first, then the
      ECO/TSV name (most common per EPD); `nameSource` records which.
- [x] **D101/D102** — model-game evals and review are real Stockfish output;
      the captured eval graph remains historical data.
- [x] **D122** — masters/peer/engine statistics exist offline for all opening
      prefixes up to 14 plies and all seeded repertoire lines.
- [x] **D123** — annotations remain captured-only; no prose is synthesised.
- [x] **D135/D197** — the profile’s `singleElo`/`eloRange` selects the peer
      band; changing it changes the peer/incidence numbers.
- [x] **D218/D219** — tests added for engine, explorer import/merge, candidate
      precedence and endpoint contracts.

Known limits, explicitly not hidden:

1. **Coverage is the app’s opening space**, not all chess positions: every EPD
   along the 3,865 ECO lines up to 14 plies plus seeded repertoire lines
   (6,488 EPDs). A position outside that set and outside the production capture
   returns `available:false` with a reason. Stockfish can still evaluate an
   arbitrary FEN via `/api/engine/eval`.
2. **Masters corpus is 16 PGN Mentor player archives** (71,364 games), not the
   full historical masters database. More players can be added by rerunning the
   builder with `--players=…`.
3. **Peer corpus is Lichess standard rated 2013-01/02/03** (403,928 games).
   Band data for `2400+` is thin (early Lichess population); counts are real and
   labelled, not padded. More months can be added with `--months=…`.
4. **The lite WASM build is weaker than full Stockfish 19** (small net) but far
   stronger than the previous heuristic. It is single-threaded and needs no
   cross-origin isolation; the trade-off is depth speed, not correctness.
5. **Training-game bot (`/api/play`) intentionally remains the local
   human-like heuristic**, not Stockfish. It is a style/rating bot, not an
   evaluation claim; changing it is outside this batch’s D203 scope.
6. **Engine fallback is labelled, not equivalent.** If the WASM binary cannot
   start, refutations use `chessbook-heuristic` with `fallback:true`; candidate
   evals stay `null`/`evalAvailable:false`; model review returns
   `available:false`. Nothing is fabricated.
7. **Captured production data still wins where it exists.** Some captured
   positions intentionally keep production’s band (e.g. 1800–2000) even though
   the offline corpus can show other bands; `capturedIncidence` and
   `incidenceSource` make the distinction visible.
8. **Snapshots add 3.15 MB** to the repo (well under the 25 MB budget) and are
   regenerated only by the builder, not at runtime. The runtime reads the
   committed JSON, never `recon/` or the network.
