<p align="center">
  <img src="docs/assets/readme/landing.png" alt="Chessbook landing page" width="100%" />
</p>

<h1 align="center">Chessbook</h1>

<h3 align="center">A local-first opening trainer, built from a captured Chessbook account</h3>

<p align="center">
  React 19 + Vite + Express + <code>node:sqlite</code>. One machine, one SQLite file,
  no account, no subscription, no cloud.
  <br />
  <strong>This is an honest local recreation — not a complete or byte-identical clone.</strong>
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Node 26" src="https://img.shields.io/badge/Node-26-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local--first-003B57?style=flat-square&logo=sqlite&logoColor=white" />
  <img alt="No auth" src="https://img.shields.io/badge/auth-none-2ea043?style=flat-square" />
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a>
  &nbsp;·&nbsp;
  <a href="#what-is-implemented"><strong>What works</strong></a>
  &nbsp;·&nbsp;
  <a href="#what-is-not-implemented"><strong>What does not</strong></a>
  &nbsp;·&nbsp;
  <a href="#data-provenance"><strong>Data provenance</strong></a>
  &nbsp;·&nbsp;
  <a href="#testing"><strong>Testing</strong></a>
</p>

---

## What this is

Chessbook is a study/portfolio recreation of [chessbook.com](https://chessbook.com).
The desktop shell (board geometry, sidebar rows, typography, spacing) was measured from
captured production pages. The product underneath is a **local-first prototype**: the
training loop, scheduling, builder, gap finder, model games and play drills are real and
exercised by tests, but several hosted-product capabilities are deliberately absent.

The desired product has **no accounts and no subscription**, so this build has no login,
signup, profile management, billing, PRO badge, lock icon, paywall or plan limit. Features
that are premium on the hosted product are available here without any entitlement UI,
subject only to the data that was actually captured (see below).

### Privacy and storage

Everything runs on this machine:

- **React PWA** — board, repertoire tree, practice loop, play drills, settings.
- **Express API** — a local bridge with no auth layer. Every request resolves to the single
  profile in `server/data/chessbook.db`.
- **SQLite** — repertoires, lines, per-move review state, attempts, sessions, settings,
  captured position reports, model games, play games and drill history.

No telemetry, analytics SDK, remote auth, cloud sync or third-party database. Nothing is
uploaded. Clearing browser data only removes browser preferences; the SQLite database is
separate.

---

## Quick start

Requires **Node 26** (for the built-in `node:sqlite`) and npm.

```bash
git clone https://github.com/Abhinav-Prabhakar/chessbook-clone.git
cd chessbook-clone
npm install
npm run dev
```

- React/Vite: <http://localhost:5173>
- API/Express: <http://localhost:8787>

The Vite dev server proxies `/api`, `/_build`, `/homepage_imgs` and `/pieces` to Express.
On first visit `/` shows the landing page; **Open app** enters the dashboard. There is no
signup route.

### Production

```bash
npm run build
npm start
# open http://localhost:8787
```

Express serves the built React app from `app/dist`, the shared production assets and the
PWA files. The app is installable from the browser or operating-system menu; it never shows
its own install banner.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Vite dev server (ports 8787 / 5173). |
| `npm run build` | Type-checks the Vite build and writes `app/dist`. |
| `npm start` | Serves the built app and API on port 8787. |
| `npm test` | `node --test tests` — unit, API and contract tests. |
| `npm run test:e2e` | Builds, then runs the Playwright main-flow and route sweep on an isolated DB at port 8796. |
| `npm run db:reset` | Recreates the local profile, seed repertoires and captured data. |

`test:e2e` needs Google Chrome and `playwright-core`. It launches the local Chrome binary
(`CHROME_PATH` overrides the macOS default), never installs browsers, starts its own server
with `CHESSBOOK_DB` in a temp directory, and stops it afterwards. Screenshots and console
logs are written under `audit/e2e/`.

---

## What is implemented

### Training loop

- **Per-position practice.** A session walks the saved line one move at a time. The
  opponent's reply is auto-played from the line; the prompt advances to the next position.
- **Server-validated moves.** `chess.js` validates that a played move is legal and that the
  position/ply belongs to the session. Crafted requests cannot mark an arbitrary line correct.
- **Per-move review state.** `line_moves` stores EPD + SAN, FSRS-style stability,
  difficulty, lapses, reps, last review and `due_at`. `reviews` keeps an immutable history.
  This is an FSRS-style scheduler implemented locally, **not** the official `ts-fsrs` package.
- **Due / all / weak / early / specific / line / common modes**, with `cards`,
  `complete-once`, `complete-every` and `entire-line` review styles, and individual-move vs
  whole-line practice modes.
- **Wrong moves do not advance or decrement.** The board holds the position, the refutation
  panel appears, `Due` and the session counters stay unchanged, and the same position is
  asked again.
- **Skip / keep / start over / hint / show answer / resume**, session persistence, daily
  goal and streak counters, and a real "Session complete" state.
- **Refutations** are a deterministic local material/mate search (`server/refutation.js`,
  depth 2 + capture quiescence). The response always names the engine and depth. It is not
  Stockfish and is not presented as such.

### Repertoire

- **3,865 Lichess ECO openings** imported from the open-source `lichess-org/chess-openings`
  TSV set, with FEN/EPD search.
- **Move tree and transpositions.** Adding a move creates real branches and saved moves;
  transpositions resolve by EPD. Disable/enable a branch reversibly; batch remove with a
  snapshot and undo.
- **Captured candidate reports.** Builder/gap candidate rows use the captured Chessbook
  position reports: master percentage, engine eval, peer results, play-rate incidence,
  annotations and plans. When a report was not captured, the UI says the value is
  unavailable instead of hashing a number.
- **Gap finder** weighted by captured incidence and missing coverage, with `Expected in`
  values and the real candidate order (for Black after `1.e4`: `c5`, `e5`, `e6`, `c6`,
  `d5`, …).
- **Notes** per position and per move; PGN import (paste or `.pgn` file), PGN/JSON export,
  autofill, trim tools and repertoire rename/delete/clone.

### Model games and play drills

- **Model games** come from captured production data: the daily game is Kamsky–Anand,
  Candidats FIDE sf1, `1-0`, 45 moves, with captured FENs and eval samples. A history
  screen, interactive guess-the-move board, hints, progress and a local review are present.
- **Training games** (`/training-games`) play a deterministic local bot with rating
  (600–2600), time control and side selection, legal-move validation, server-authoritative
  clocks, resignation/flag, result and a local accuracy review.
- **Blunder puzzles** derive positions from captured model-game eval swings and from real
  wrong repertoire reviews. The list reports zero repertoire mistakes on a fresh database
  rather than inventing one.
- **Intuition builder** scores the move you actually played from captured candidate data and
  shows the real play rates.
- **Visualization** plays hidden moves from a captured model game or saved line; the SANs
  and expected answer stay on the server until scoring.
- **Vision** drills hanging/undefended pieces, undefended pawns, checks and king-zone
  squares on real positions, computed live with `chess.js`.

### Everything else

- **Dashboard** with real repertoire counts, today's review log, local openings report,
  streak/daily goal, PGN import and local issue-tracker feedback.
- **Settings** backed by one server `settings` row: rating system, time control, Elo range,
  coverage goal, practice/review style, pause switches, appearance, animation, sound,
  haptics, recommended-moves size, notifications, model-game source and reset.
- **Content routes** built from captured data: opening guides, coaches (directory + local
  application/review queue), blog posts, repertoires list and legal pages.
- **Accessibility and recovery**: click and drag-and-drop board interaction, a routed React
  **error boundary** with Try again / Reload / Dashboard, unknown routes redirect home, and
  a global **offline queue** banner.

---

## What is not implemented (explicitly)

These are intentional limits of this build, not hidden TODOs:

- **Stockfish 19 is bundled.** `stockfish@19.0.1` runs as a lazy local UCI worker
  (`server/engine.js`) for wrong-move refutations, model-game reviews, candidate
  evals and puzzle answers. Every result carries the engine name/version and
  depth. If the WASM worker cannot start, the response says `available:false` and
  falls back to the transparent local heuristic engine in `server/bot.js`; nothing
  is labelled Stockfish unless Stockfish actually produced it.
- **No WebSocket layer.** Practice, training games, puzzles and visualization are
  turn-based request/response exchanges. Move/answer responses carry the next authoritative
  state, and a reload re-fetches it. A socket would add a second source of truth for no
  local single-player benefit (audit D201), so it is deliberately omitted.
- **No online account, Chess.com/Lichess OAuth, cloud game import, coaches marketplace,
  billing or subscription.** PGN import is the local equivalent for your own games.
- **No social, notification server, telemetry or analytics.** Notification permission
  supports local browser reminders only.
- **Pre-made courses are the captured sample.** Opening guides, coaches, blog posts and
  courses come from the production captures; no additional marketplace content is fetched.
- **Position coverage comes from three offline datasets.** Captured production reports are
  authoritative where they exist. Every position in the 3,865-opening tree is otherwise
  backed by a 71k-game master archive and a 404k-game Lichess rated archive, aggregated
  locally; Stockfish supplies the engine eval. A position with no data in any source shows
  an explicit “unavailable” state.
- **Five complete piece sets** are bundled (`chessbook_monochrome`, `cburnett`, `merida`,
  `chessnut`, `shapes`) with attribution and licences in `pieces/README.md`; five board
  themes are available.
- **Two captured rating bands** (1800–2000 and 2000–2200) drive the reference report. The
  local peer corpus covers all rating bands, so changing your rating re-filters the peer
  statistics; a band with too few sampled games shows the sample size rather than reusing
  another band's percentages.
- **Playback/anti-cheat are local.** Visualization FENs are in the client payload; a local
  user could inspect network responses. Acceptable for a single-player trainer.
- **Mobile is a responsive clipped-board + sheet composition**, not the native app. The
  native app itself is not part of this repository.

Not every hosted screen has a local equivalent. The audit in `AUDIT.md` remains the
authoritative divergence list; `AUDIT_PROGRESS.md` records what each batch closed.

---

## Data provenance

Every number shown is either **captured from the reference account** or **computed from
your own local review history**. Nothing is hashed into a fake statistic.

| Data | Source |
| --- | --- |
| Openings | `server/data/*.tsv` — Lichess `chess-openings` (3,865 rows). |
| Position reports (masters, engine eval, peers, incidence, annotations, plans) | Captured production data in `server/data/captured-positions.json` (authoritative where present), plus `explorer-masters.json` (PGN Mentor archives, 71k games) and `explorer-lichess.json` (Lichess rated 2013-01/02/03, 404k games) for every position in the opening tree. |
| Opening guide/course/coach/blog content | `server/data/captured-openings.json`, `captured-courses.json`, `captured-content.json`. |
| Model game + history | `server/data/captured-model-games.json` (`recon/daily-game-full.json`, `recon/model-history-full.json`). |
| Repertoire/dashboard seed | Small readable starter state derived from the captured account; review state is generated locally and can be reset. |
| Practice schedule, daily goal, streaks, review log, play ratings | Computed from your local attempts and reviews. |
| Piece sets | Lichess assets (`lichess1.org`); licences and attribution in `pieces/README.md`. |
| Engine output | Stockfish 19 Lite WASM via `server/engine.js`, labelled with version and depth; local heuristic fallback only when the worker is unavailable. |

The captured production pages themselves are kept at the repository root (`*.html`, `m/`,
`recon/`) as design references; the React app is the primary experience. See
`server/data/OPENINGS-README.md` and `AUDIT.md` for the exact capture evidence.

---

## Routes

| Route | Screen |
| --- | --- |
| `/` | Landing until you enter; dashboard afterwards |
| `/dashboard` | Dashboard |
| `/repertoire/:id` | Repertoire overview (also accepts `white`/`black`/slug) |
| `/build/:id` | Builder (`?path=e4,c5`, `?line=…`, `?epd=…`) |
| `/gap/:id` | Biggest-gap candidate finder |
| `/learn/:id` | Training mode selector |
| `/practice/:id` | Practice session (`?mode=…`, `?line=…`, `?session=…`) |
| `/history`, `/history/:id` | Review-history browser, filters and recent mistakes |
| `/model`, `/model/:id` | Model games and history |
| `/training-games` | Training games vs the local bot (`?fen=&color=&from=`) |
| `/blunder-puzzles`, `/intuition-builder`, `/visualization`, `/vision` | Play drills |
| `/openings`, `/openings/:slug` | Opening guides |
| `/coaches`, `/coaches/:slug`, `/coaches/apply`, `/coaches/review` | Coach directory and local application queue |
| `/blog`, `/blog/:slug` | Captured blog posts |
| `/repertoires` | Repertoire list |
| `/welcome` | Local setup walkthrough |
| `/help` | Help, FAQ and deep anchors (`#practice`, `#builder`, `#training-games`, …) |
| `/settings` | Settings |
| `/add` | Create/import a repertoire |
| `/legal/:kind` | Privacy, fulfillment, terms |
| `/qr` | Honest local landing for the public app-store listings |
| unknown | Redirects home (matches production) |

---

## Architecture and project layout

```text
app/
  src/
    pages/          React screens
    components/     Board, UI rows, ErrorBoundary, OfflineBanner, play components
    styles/app.css  shell + component styles, desktop and mobile compositions
    api.ts          fetch client, in-flight GET dedupe, offline write queue
    profile.tsx     local profile/settings hydration
    prefs.ts        server-backed preference mirror
  public/           manifest, service worker, offline page, pieces, icons, sounds
  dist/             production build (generated)
server/
  index.js          Express app, static/PWA serving, SPA fallback
  api.js            profile, repertoires, practice, settings, model games, content
  repertoire.js     per-move graph, queues, review styles, branches
  srs.js            FSRS-style scheduler
  bot.js            deterministic local engine
  refutation.js     local material/mate refutation search
  play/             training games, puzzles, intuition, visualization, vision
  schema.js         migrations
  db.js             schema, opening import, seed
  data/             Lichess TSVs + captured JSON
tests/
  server/           unit, API and contract tests (node --test)
audit/
  e2e/              Playwright main-flow + route sweep, screenshots/logs
  progress/         batch reports and evidence
```

### Offline behaviour

The service worker caches the shell and previously opened API reads. GETs are
network-first with a cache fallback, so a previously opened screen stays readable offline.
Non-GET requests that cannot reach the local API are queued in `localStorage`
(`cb_offline_queue`) with their idempotency key (practice attempts already carry
`submissionId`). The global banner reports the queue, retries when the browser goes online
or when you press **Retry now**, and practice refreshes the authoritative session after a
replay. Rejected writes (4xx) are dropped so the queue cannot wedge.

### Testing

- `npm test` — `node --test tests`, including `tests/server/contract.test.js`, which pins
  the API response shapes, legality/idempotency contracts, absence of entitlement fields and
  error shapes.
- `npm run test:e2e` — builds the app, starts Express on port **8796** with a temp
  `CHESSBOOK_DB`, and drives real Chrome. It checks the full practice flow (wrong move,
  opponent auto-reply, next move, build hand-off, reload resume, completion and `Due: 0`),
  the offline queue, every route at 1440×900 and 390×844, console errors and unknown-route
  redirect. Screenshots land in `audit/e2e/`.

---

## Attribution

Opening data comes from the open-source
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) dataset.
Chessbook branding, the captured page design and the production shell belong to Chessbook.
This is a study/portfolio recreation and is not affiliated with Chessbook.
