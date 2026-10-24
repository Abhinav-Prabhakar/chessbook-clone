# Batch 4 — play pillars: training games, puzzles, intuition, visualization, vision

Owner: `play-features`
Scope: new `server/play.js`, new `server/play/*.js`, new `server/bot.js`,
`server/index.js` (mount only), five new client pages + shared play components,
`app/src/App.tsx` (routes), `tests/server/play.test.js`.

Status: **implemented and verified**. No other agent's page, `server/api.js`,
or `app/src/styles/app.css` was modified. Nothing was committed.

---

## What changed

### 1. Deterministic local engine — `server/bot.js` (D202/D203)

- Material + piece-square evaluation (pawns, knights, bishops, rooks, queens,
  king), bishop pair, doubled/isolated pawns, rook files and a tempo term.
- Alpha-beta negamax with move ordering (captures/promotions/checks), a node
  budget and `depthForRating()`: 600–900 → 1 ply, 900–1900 → 2 plies,
  1900+ → 3 plies (node-capped).
- `chooseBotMove(fen, { rating, seed })` uses a seeded mulberry32 PRNG; the
  noise window shrinks and the candidate pool tightens as the rating rises.
  The same FEN/rating/seed always returns the same move.
- `reviewGame()` compares every move with the engine's best move at the same
  depth and converts centipawn loss into Lichess-style accuracy, plus
  `blunder` / `mistake` / `inaccuracy` / `best` classifications and a
  per-ply eval sample list.
- **Explicitly not Stockfish.** Every response says
  `engine.name = "Chessbook local heuristic"`, `stockfish: false`, with the
  depth/node budget and a note. No engine output is presented as Stockfish.

### 2. Schema and persistence — `server/play/db.js`

Self-contained `CREATE TABLE IF NOT EXISTS` bootstrap, run on import. It does
not touch `server/schema.js` or `PRAGMA user_version`, so it is additive to the
v3 training schema.

| Table | Purpose |
|---|---|
| `play_games` | One training game: bot rating, time control, side, start/final FEN, JSON move list with clock snapshots, clocks, turn timestamp, status/result/reason, review JSON. |
| `play_drills` | Intuition / visualization / vision sessions. Payload and answers stay server-side until submission. |
| `play_profiles` | Per-feature rating, games, attempts, correct/total, streak, best streak and JSON feature data (`user_id, feature` PK). |
| `play_attempts` | Immutable history per feature (`item_key`, correct, score, detail JSON) used for streaks, solved-puzzle state and recent activity. |

Per-feature ratings are Elo-updated against the item difficulty (training:
win=1 / draw=.5 / loss=0 vs the bot rating; puzzles: solved/wrong vs the
puzzle's swing difficulty; visualization/vision: score fraction vs a
difficulty-derived rating; intuition: style clarity). Defaults: training 1200,
puzzles 1200, intuition/visualization/vision 1000.

### 3. Play API — `server/play.js`, `server/play/*.js`

Mounted at `/api/play` in `server/index.js` (`app.use("/api/play", playApi)`).

| Method + path | What it does |
|---|---|
| `GET /api/play` | Capabilities, feature route list and engine disclosure. |
| `GET /api/play/progress` | All five profile rows + recent attempts per feature. |
| `GET /api/play/progress/:feature` | One profile + its recent attempts; 404 for unknown features. |
| `GET /api/play/training-games/options` | Bot ratings, time controls, sides, default rating/time control, recent games, profile. |
| `POST /api/play/training-games` | Start a game: `{rating, timeControl, side, fen?, from?}`. Validates FEN, rejects finished positions. Custom FEN lets practice/build link to a studied position. |
| `GET /api/play/training-games` | Recent game summaries + profile. |
| `GET /api/play/training-games/:id` | Authoritative state: FEN, move list, clocks, legal moves, result, cached review. |
| `POST /api/play/training-games/:id/moves` | `{san}` or `{from,to,promotion}`; legal-move validated (422), player-turn checked (409), server-side clock + increment, bot reply. |
| `POST /api/play/training-games/:id/resign` | Loss by resignation + rating update. |
| `POST /api/play/training-games/:id/flag` | Claim a flag fall; 409 while the server clock still has time. |
| `POST /api/play/training-games/:id/review` | Cached local review: accuracy, blunder/mistake/inaccuracy counts, best move and cp loss per reviewed move. 409 while active. |
| `GET /api/play/blunder-puzzles` | Puzzle list, source counts, solved flags, rating/streak, recent attempts, engine note. |
| `POST /api/play/blunder-puzzles/next` | Next (preferably unsolved) puzzle; optional `source` / `exclude`. |
| `POST /api/play/blunder-puzzles/attempt` | `{key, san}` or `{key, giveUp}`; returns correct/best/alternatives/cp loss/source explanation + updated profile. Illegal SAN → 422; unknown key → 404. |
| `GET /api/play/intuition-builder` | Captured position index, persisted style summary and source note. |
| `POST /api/play/intuition-builder/session` | Creates a 2–6 position session (default 4); answers stay in `play_drills`. |
| `POST /api/play/intuition-builder/answer` | `{sessionId, san}`; legal-move checked, scores style from the captured candidate list (or a labelled local heuristic), accumulates the persisted style, returns captured play-rate data. |
| `GET /api/play/visualization` | Difficulties (2–6 hidden moves, 950–380 ms), modes, source counts, profile, last result. |
| `POST /api/play/visualization/session` | `{difficulty, mode}`; builds a hidden-move sequence from a real captured model game or saved repertoire line. The response contains FENs/from-to only — **no SANs**. |
| `POST /api/play/visualization/answer` | `{moves}` (reconstruction, prefix-scored) or `{answers}` (position questions); persists score/rating; repeat submission is idempotent. |
| `GET /api/play/vision` | Five drill kinds, difficulty options, source counts, profile, last result. |
| `POST /api/play/vision/session` | `{kind, difficulty}`; generates a drill from a real captured/repertoire position, returns board + prompt + target count (answer stays server-side). |
| `POST /api/play/vision/answer` | `{squares}`; returns exact/partial score, correct/wrong/missed squares, reveals the answer, records attempt. Repeats are idempotent. |

Error shapes follow the existing API: `400`, `404`, `409 {code}`, `422
{code, legalMoves}`. No WebSocket layer exists or is needed: every turn is a
request/response exchange, and the client refetches state on reload
(D201 not required for a local single-player turn-based game).

### 4. Feature specifics

#### Training games (`/training-games`, D158)

- Setup: opponent rating (600–2600), time control (1+0 … 15+10; default 3+2),
  side (white/black/random).
- Board is interactive; moves are validated by `chess.js` on the server with
  `findLegalMove` (SAN or UCI), so illegal/mismatched moves are rejected.
- Clocks: `initial_ms` + increment, server timestamp per turn, client-side
  countdown, bot thinking time (deterministic per ply), flag endpoint.
- Game-over detection: checkmate, stalemate, insufficient material,
  threefold, fifty-move, resignation, timeout.
- Post-game: result label, plies, rating/time control, "Review game" with
  accuracy, blunders/mistakes, per-move cp loss and engine disclosure.
- `?fen=…&color=…&rating=…&tc=…&from=…` starts from a studied position. This
  is the contract for D034; the practice/build screens (owned by the
  `practice-ui` / `builder-gap` agents) only need a link to
  `/training-games?fen=<fen>&color=<side>&from=<screen>`.

#### Blunder puzzles (`/blunder-puzzles`, D159)

- Sources, both real and labelled in the response:
  1. **Captured model-game eval swings:** every `model_game_moves` row whose
     captured eval moved ≥60 cp against the mover. The position is the FEN
     before the move; the source label includes players, event and move
     number, and the UI shows the captured `evalBefore → evalAfter`.
  2. **Saved repertoire mistakes:** positions whose latest local review is
     incorrect (same query semantics as the `weak` practice queue). The
     expected answer is the saved repertoire move; all saved alternatives at
     that position are accepted. Empty on a fresh DB until a real wrong review
     exists — the list reports `repertoireMistakes: 0` rather than inventing
     one.
- The reference best move for model-game puzzles is computed by the local
  engine at attempt time (depth 2, or 3 for big swings), accepts the top move
  or an alternative within 25 cp, and says so in `explanation`/`engine`.
  No best move is fabricated or hard-coded.
- Give up reveals the best move, resets the streak and applies the loss.
- Rating, solved set, streak and best streak persist in SQLite.

#### Intuition builder (`/intuition-builder`, D160)

- Positions come from captured `position_reports` with ≥5 candidates
  (currently 7 unique EPDs, 5 complete reports).
- The view shows only the board and a prompt; after the chosen move it shows
  the captured candidate list (play rate `1 in N`, eval, master/peer splits,
  annotation).
- Style points (`aggressive`, `solid`, `sharp`, `learnable`) are percentile
  ranks of `scoreCandidate()` within the captured candidate list, so they are
  derived from the captured data. Moves outside the capture get a transparent
  local heuristic and `styleSource: "local-heuristic"`.
- Running style averages, session count and label persist in
  `play_profiles.data_json`; a completed session increments `games`.

#### Visualization (`/visualization`, D161)

- Difficulty 1–5 controls hidden moves (2/3/4/5/6) and playback speed
  (950/800/650/500/380 ms).
- Sequences are built from a real captured model game (preferred) or a saved
  repertoire line. The client receives `startFen` + playback FENs/from-to, not
  the SAN list; after playback it either replays the moves or answers three
  generated position questions. Reconstruction is scored by the correct
  prefix; questions by correct options. Both reveal the expected answer and
  persist rating/score.
- The drill payload (including answers) lives in `play_drills` until
  submission; re-submission returns the stored result.

#### Vision (`/vision`, D162)

- Drill kinds: hanging pieces, undefended pieces, undefended pawns, checks,
  and king-zone squares.
- Positions are real: captured model-game FENs (`epd_before`) and saved
  repertoire FENs, deduplicated. Answers are computed live with
  `chess.js.attackers()` / legal-move check detection; nothing is hard-coded.
- Difficulty biases toward positions with fewer targets. The prompt and
  target count are shown; answers are not.
- Submission returns exact/partial score, correct/wrong/missed squares, the
  answer and the updated persisted rating/streak. Clicking is immediate; no
  server round-trip is needed until submit.

### 5. Client routes and shared components

- New pages: `TrainingGamesPage`, `BlunderPuzzlesPage`,
  `IntuitionBuilderPage`, `VisualizationPage`, `VisionPage`.
- Shared under `app/src/components/play/`:
  - `PlayLayout` — board column + sidebar + play navigation + local help links.
  - `ChessClock` — server-synced countdown.
  - `SelectBoard` — click-to-select board for vision drills (reuses the
    existing board/piece CSS so it inherits the board theme and
    coordinates setting).
- `app/src/App.tsx` now registers every play and content route:
  `/training-games`, `/blunder-puzzles`, `/intuition-builder`,
  `/visualization`, `/vision`, `/openings`, `/openings/:slug`, `/coaches`,
  `/coaches/:slug`, `/coaches/apply`, `/coaches/review`, `/blog`,
  `/blog/:slug`, `/repertoires`, `/repertoires/:slug`,
  `/welcome`, `/help`. The `/repertoires/:slug` pattern also serves
  `/repertoires/:key` URLs (numeric ids, colours and slugs all resolve and
  redirect to the local repertoire), so both production and local key shapes
  work. The old `/openings → /add` redirect is gone. Existing local routes
  (`/repertoire/:key`, `/build/:key`, …) are unchanged.
- Play pages link to the real local `/help` page ("How this drill works",
  "All help") and to each other through the play tabs (D169).

---

## Verification

All verification was local. No server was left running and nothing was
committed.

### 1. `node --test tests/server/play.test.js`

**10 tests, 10 pass** — capabilities/progress, training-game legality, clock
and increment, resignation, review caching, custom-FEN start (D034),
deterministic bot, puzzle give-up/wrong/correct + rating/streak, intuition
session completion + persistence, visualization reconstruction/questions +
idempotency, vision generation/scoring/exact answer, and direct SQLite checks
of `play_profiles`, `play_attempts`, `play_drills`, `play_games` and
`review_json`.

### 2. Full server suite

`node --test tests/server` → **66 tests, 66 pass, 0 fail**. Existing
practice/SRS/data/integrity/modes tests still pass.

### 3. Type check and client build

- `npx tsc --noEmit -p app/tsconfig.json` → clean.
- `npm run build` → `✓ built in 724ms`, 64 modules, `app/dist` produced.

### 4. Isolated HTTP run (`PORT=8795`, temp DB)

Fresh `CHESSBOOK_DB=/tmp/cb-play-8795.db`, `CHESSBOOK_SKIP_OPENINGS=1`:

- `/api/health` 200; `/api/play` returned all five features; options returned
  11 bot ratings and 7 time controls; puzzle list returned 22 captured
  model-game swings with 0 repertoire mistakes on a fresh profile; vision
  source counts were populated.
- All 18 registered page routes returned HTTP 200 with the React `#root`
  shell (`/`, `/training-games`, `/blunder-puzzles`, `/intuition-builder`,
  `/visualization`, `/vision`, `/openings`, `/openings/italian-game`,
  `/coaches`, `/coaches/anna-cramling`, `/coaches/apply`, `/coaches/review`,
  `/blog`, `/blog/welcome-to-chessbook`, `/repertoires`,
  `/repertoires/white-openings`, `/welcome`, `/help`).
- `/repertoires/white-openings`, `/repertoires/black` and
  `/repertoires/1` all resolved through the slug route to the matching local
  repertoire (`/repertoire/1` / `/repertoire/2`), so both the production slug
  shape and the local key shape work.
- Headless Chrome (system Chrome via `playwright-core`, temp server) loaded
  every route with **zero page/console errors**, then exercised:
  - training game → start, e2–e4, bot reply, resign, review (63.6% accuracy
    on the single reviewed move);
  - blunder puzzle → "show me" revealed `Nxd4` with the captured
    `17cp → 77cp` swing;
  - intuition → session started, position 1 of 4;
  - visualization → playback completed, empty reconstruction scored 0%;
  - vision → started a hanging-piece drill, submitted one square, got the
    wrong/missed breakdown.
- Server stopped with `SIGTERM`; `ps` confirmed no remaining `server/index.js`.

---

## Caveats and residual gaps

1. **No Stockfish (D203 partial).** The repository does not contain an engine
   binary; the only `stockfish-*` file in `recon/` is a Sentry loader stub.
   The local heuristic engine is used instead and every response labels it
   with `stockfish:false`, its search depth and the node budget. Review depth
   is 1 for speed (~0.7 s for an 89-ply game); depth 2 takes ~19 s and is only
   used on demand. Its ratings are not Stockfish-comparable.
2. **Puzzle supply depends on data.** Captured model games supply 22 puzzles
   on a fresh database. Repertoire-mistake puzzles appear only after the user
   has actually answered a saved move incorrectly; the API and UI report zero
   instead of synthesising a mistake.
3. **Puzzle best moves are computed locally, not captured.** The positions and
   eval swings are captured; the reference answer is the local engine's best
   move at attempt time, labelled as such. No captured engine best move is
   invented.
4. **Intuition positions are few.** Seven unique captured EPDs (five complete
   reports) exist, so sessions can repeat positions. The index exposes the
   count and the session samples without replacement within a session.
5. **Visualization is a memory exercise, not anti-cheat.** Playback FENs are
   in the client payload; SANs and the expected answer stay on the server
   until scoring. A local user could inspect the network response, which is
   acceptable for a single-player local trainer.
6. **`play_games` clocks are server-authoritative but client-reported time is
   capped.** The server uses its own `turn_started_at` and accepts the client
   value only up to server-elapsed + 400 ms. A backgrounded tab therefore
   loses real time rather than freezing the clock.
7. **D034 has a link target but no placement in Practice/Build.** The target
   `/training-games?fen=&color=&rating=&tc=&from=` is implemented and tested;
   inserting the visible "Play a training game from here" row belongs to the
   `practice-ui` / `builder-gap` owners, whose files were out of scope.
8. **Help links are not deep anchors.** All play pages link to the real local
   `/help` page (registered here) and to `/help` from the play nav; the Help
   page does not currently have per-feature anchor IDs, so links land at the
   top of Help.
9. **No WebSocket layer (D201).** Not needed for turn-based local games; the
   move/answer responses carry the next authoritative state and a reload
   re-fetches it.

---

## Owned D-ID checklist

- [x] **D158** — `/training-games` plays a human-like bot with rating, time
  control and side selection, legal-move validation, clocks, resignation,
  result, and a local accuracy/blunder review; verified by
  `tests/server/play.test.js` and headless Chrome.
- [x] **D159** — `/blunder-puzzles` derives positions from captured model-game
  eval swings and saved repertoire mistakes, labels every source, validates
  the best move locally, scores give-up/wrong/correct, and persists rating,
  solved set and streak.
- [x] **D160** — `/intuition-builder` scores the moves actually played from
  captured candidate style/incidence data, reveals the captured play rates,
  and persists four style dimensions, label and session count.
- [x] **D161** — `/visualization` plays hidden moves from real captured/saved
  games at five difficulty/speed levels, supports reconstruction and position
  questions, with prefix/option scoring and persisted ratings.
- [x] **D162** — `/vision` generates hanging/undefended-piece, undefended-pawn,
  check and king-zone drills from real positions, with immediate exact/partial
  feedback, missed/wrong breakdown and persisted score/streak.
- [x] **D200** — `/api/play` exposes all play endpoints above (games, puzzles,
  intuition, visualization, vision, progress) with consistent 400/404/409/422
  errors; `GET /api/play/progress` aggregates every feature.
- [x] **D201** — Not needed: every play flow is a local turn-based
  request/response; there is no live opponent or background push. Move/answer
  responses carry the next state and reload re-fetches it.
- [x] **D202** — `server/bot.js` is a deterministic local bot (material + PST
  + shallow alpha-beta, rating-scaled depth and seeded noise), used both for
  training games and puzzle verification; no cloud/Oxi service.
- [~] **D203** — Partial: no bundled Stockfish binary. A transparent local
  heuristic engine replaces it for bot moves, reviews and puzzle answers, with
  `stockfish:false` and depth/node disclosure in every response and the UI.
- [x] **D034** — Practice/build link target verified:
  `POST /api/play/training-games` accepts `{fen, side, from}` and starts from
  the studied position (test "training games can start from a studied
  position"). Visible insertion in Practice/Build remains with those owners.
- [x] **D169** — Every play page links to the real local `/help` page (and the
  play-page nav links each drill), and `/help` is registered in `App.tsx`;
  Help itself links to the public Chessbook wiki and real local screens.

### Supporting items

- [x] Five content routes registered from the existing modules: opening
  guides/index, coaches (list/detail/apply/review), blog index/post,
  repertoires list/slug/key, welcome and help. Removed the old
  `/openings → /add` redirect.
- [x] Play navigation across the five new pages (`Training games`, `Blunder
  puzzles`, `Intuition`, `Visualization`, `Vision`).
- [x] `GET /play/progress` and per-feature progress endpoints make persisted
  ratings observable without opening a drill.
- [x] Flag endpoint (`POST /training-games/:id/flag`) so a real flag fall ends
  the game instead of freezing at 0.0.
- [x] Idempotent visualization/vision answers and cached game reviews.

---

## Files

- `server/bot.js` — evaluation, alpha-beta search, seeded bot selection,
  game review/accuracy.
- `server/play.js` — `/api/play` router, progress endpoints, feature mounts.
- `server/play/db.js` — play schema, profile/rating helpers, drill storage,
  attempt log.
- `server/play/games.js` — training games, clocks, bot turns, resignation,
  flag, review.
- `server/play/puzzles.js` — captured-swing + repertoire-mistake puzzle
  derivation and scoring.
- `server/play/intuition.js` — captured-position style sessions.
- `server/play/visualization.js` — hidden-move drills (reconstruct/questions).
- `server/play/vision.js` — board-vision drill generation and scoring.
- `server/index.js` — `app.use("/api/play", playApi)`.
- `app/src/pages/{TrainingGamesPage,BlunderPuzzlesPage,IntuitionBuilderPage,VisualizationPage,VisionPage}.tsx`.
- `app/src/components/play/{PlayLayout,ChessClock,SelectBoard}.tsx`.
- `app/src/App.tsx` — all play + content routes.
- `tests/server/play.test.js` — 10 API/persistence tests.

### CSS

No `app.css` change was made. Existing classes only (`cb-app`, `cb-main`,
`cb-board-col`, `cb-sidebar`, `cb-tabs`/`cb-tab`, `cb-row`, `cb-section`,
`cb-stat-grid`, `cb-inline-note`, `cb-move-list`/`cb-move-pill`, `cb-btn`,
board classes). The clock uses an optional `cb-clock` hook but is fully
inline-styled; no rule is required for it.
