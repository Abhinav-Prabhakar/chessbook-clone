# Batch 2 — dashboard, settings, repertoire and add flow

Owner: `dashboard-settings`
Scope: `app/src/pages/Dashboard.tsx`, `app/src/pages/SettingsPage.tsx`,
`app/src/pages/RepertoirePage.tsx`, `app/src/pages/AddPage.tsx`,
`app/src/prefs.ts`, `app/src/profile.tsx`.
No other client file, server file, CSS file or `App.tsx` route was edited.

Status: **implemented and verified against the real server data**. Nothing was
committed.

---

## What changed

### `app/src/prefs.ts` — one client preferences source

All client-only preferences now live in a single versioned object
(`localStorage.cb_prefs_v1`), with legacy `cb_rating` / `cb_cover` / `cb_pause` /
`cb_animation` / `cb_haptics` / `cb_practice_mode` keys migrated on first read.
The module exposes getters plus effects; the legacy `cb_board_theme` /
`cb_sound` / … keys are still mirrored from server settings for the synchronous
board/sounds reads.

| Preference | Stored in | Actually read by |
|---|---|---|
| board theme, coordinates, legal moves, sound, daily goal, model source | SQLite `settings` (server) | Board, daily summary, `/model-games?source` |
| rating (platform, time control, value) | `cb_prefs_v1` | Settings row/sheet, Add flow rating-band note |
| coverage goal (1 in N games) | `cb_prefs_v1` | Repertoire trim (`rare` threshold and `pastGoal` fraction), Dashboard learnability task, Settings copy |
| practice mode, review style, pause-after-move, pause-on-fail/note/low-score | `cb_prefs_v1` | `getPracticePreferences()` contract for the practice screen |
| piece animation | `cb_prefs_v1` | injected global CSS rule (off = no animation, fast = 100 ms) |
| haptics | `cb_prefs_v1` | `haptic()` → `navigator.vibrate()` on real actions |
| sound volume + per-sound toggles | `cb_prefs_v1` | Settings sheet previews at the chosen volume; master switch is server-backed |
| recommended-moves size | `cb_prefs_v1` | injected global CSS rule (compact 8px / comfortable 12px / large 16px candidate rows) |
| notification channels | `cb_prefs_v1` | browser Notification permission + Dashboard reminders |
| piece set | `cb_prefs_v1` | explicit "only bundled set" state (no fake options) |

`applyClientPrefs()` is called on boot, on every save and on server-settings
hydration. It writes `data-cb-animation`, `data-cb-rec-size` and a single
`#cb-client-prefs` style element so animation/size apply to the builder, gap
finder, add flow and practice without duplicating code in pages I do not own.

### `app/src/profile.tsx` — hydration point

`ProfileProvider` now hydrates `/me`, `/settings` and `/practice/daily` once,
mirrors server settings into the board keys, applies client preferences, and
exposes `settings`, `daily`, `streak`, `prefs` and an optimistic `saveSettings`
that rolls back on failure. This is the single place both Settings and the
Dashboard read their defaults from.

### `app/src/pages/Dashboard.tsx`

- Real **daily practice/streak panel** from `/dashboard?tzOffset` and
  `/practice/daily`: reviews/correct/wrong today, goal progress bar, current
  streak, highest streak, last streak date.
- Real **daily reviews list**: `/practice/reviews?repertoire=<target>` filtered
  to `daily.date`, showing move, line, correct/played SAN, linking to the line.
- **Daily tasks**: practice (due / first pass), biggest gap (from
  `/repertoires/:key/gap`, prompt + `bestMissing.san` + `1 in N`), improve
  learnability (real `trim` dry-run count, opens the trim sheet), model game row
  from `dashboard.modelGame` (Kamsky–Anand, Candidats FIDE sf1, White won, progress).
- **Openings report** from `/openings/report`: weak/worst computed from local
  reviews; explicit "no wrong moves" / "no reviews yet" copy; the empty captured
  production report is labelled.
- Removed the dead **"Connect account"** row and the fake `Lichess ✕ Chess.com ✕`
  report rows. Replaced with a real **local PGN import** path (`/add?tab=import`)
  and copy that says there is no account/OAuth.
- Replaced the fake production **feedback/share** links with a real GitHub issue
  link for this repository and "copy this app's address" (`location.origin`).
- Added a **Back** affordance (history back, dashboard fallback).
- Notification channels are read here: daily-goal / streak / model-game reminders
  use the Notification API once per local day, and an inline row offers a fix
  when the browser permission is missing.
- Repertoire rows now link to the real list/manage experience (`/add?tab=manage`).

### `app/src/pages/SettingsPage.tsx`

Rebuilt as a normalised list with modal **sheets** (no inline string cycling, no
account/subscription chrome):

- **Your rating** — platform (Chess.com / Lichess / FIDE / USCF), time control
  (Bullet / Blitz / Rapid / Classical), numeric rating, computed band; explicit
  note that opening statistics were captured for the 1800–2000 Chess.com band.
- **Cover positions seen in** — 1 in 25/50/100/200/500 games; this value is read
  by the repertoire trim tools and the dashboard learnability task.
- **Model games source** — historical / masters / online; PATCHes the server
  (`online` is explicitly empty because no account exists).
- **Practice** (individual moves / whole lines), **Review style** (cards,
  complete lines once, complete lines every time, entire line), **Daily practice
  goal** (server), **Pause after playing a move**, and pause switches for fail /
  note / low score.
- **Notifications** — four channels plus a real browser permission request;
  Dashboard consumes them.
- **Board settings** — three real appearances (Chessbook, Chessbook blue,
  Lichess brown; verified the board colour changes and the server is patched),
  **piece animation** (real CSS rule), **sound effects** (master server switch,
  volume slider with preview, per-sound toggles), **haptics** (real vibration),
  **recommended moves size** (real CSS layout change).
- **Games and data** — PGN import, reset all learning, reset preferences.
- Deleted: subscription/upgrade row, connected-account row, early-access no-op,
  and the account section title.
- Piece set row is an explicit "only bundled set" state rather than a fake
  selector.

### `app/src/pages/RepertoirePage.tsx`

- **Real characteristics** from `repertoire.characteristics` (×100):
  Effectiveness, Soundness, Learnability, Expected results, Sharpness. Values
  are `—` when the captured field is null and the whole panel says
  "Unavailable: no captured position report" for legacy repertoires; nothing is
  computed from `learned`/`mastered`. Coverage comes from
  `/repertoires/:key/coverage` with "X of Y positions have a captured report".
- **Correct counts**: saved moves, lines, moves and positions, plus position-level
  completion/mastery.
- **Sections/chapters**: list with line counts, create, rename, delete, and a
  per-line section selector (`PATCH /lines/:id {chapterId}`). Deleting a section
  keeps its lines.
- **Rename / clone / delete** repertoires (modals + confirm), with navigation
  back to the list after delete.
- **Import**: PGN textarea + `.pgn` file upload (2 MB cap), multi-game, result
  toast and reload.
- **Export**: PGN and JSON downloads through the server export endpoint.
- **Trim tools**: past-goal (uses the coverage goal), rare sidelines, sideline
  transpositions, autofilled moves; dry-run preview lists the affected lines
  before anything is removed.
- Autofill copy fixed ("N moves added" with SANs, no "scheduled" claim).
- Deep links supported: `?line=<id>` selects a line, `?sheet=trim|import|chapters|
  lines`, `?mode=rare` preselects a trim mode (used by the dashboard task).

### `app/src/pages/AddPage.tsx`

- **Candidate-based add flow**: pick a repertoire, walk the saved tree with move
  pills, and get the real ranked candidates from
  `/repertoires/:key/candidates` with masters %, engine eval, incidence ("1 in
  N"), annotation, saved/needed state. Saved moves open the branch (through the
  opponent's saved reply); unsaved moves are added at the current EPD.
- Adding calls `POST /repertoires/:key/moves`; **Saved increments** (verified
  8→9, 17→18, 21→22 in runs) and the **new branch** is shown with its PGN and an
  "Open in builder" link.
- Manual SAN entry with server-side legality validation; rejected moves show the
  server error.
- Captured-vs-your rating band note (the rating preference is actually read).
- **New repertoire** tab (colour + name) now lands directly in the add flow.
- **Import** tab: PGN file upload + paste, target repertoire selector that
  honours `?repertoire`, result counts, and the **pre-made course** catalogue
  from `/courses` with clone + explicit "metadata captured, move tree not
  captured" note.
- **Manage** tab: the repertoire list with open/rename/clone/delete and
  saved/lines/completion/due stats. This is the `/repertoires` list experience
  until a route exists (see route additions).

---

## Endpoints used

- Profile/dashboard: `GET /me?tzOffset`, `GET /settings`, `PATCH /settings`,
  `GET /dashboard?tzOffset`, `GET /practice/daily?tzOffset`,
  `GET /practice/reviews?repertoire&limit`, `GET /openings/report`.
- Repertoires: `GET|POST /repertoires`, `GET|PATCH|DELETE /repertoires/:key`,
  `POST /repertoires/:key/clone`, `POST /repertoires/:key/reset`,
  `POST /repertoires/:key/autofill`, `GET /repertoires/:key/gap`,
  `GET /repertoires/:key/candidates`, `GET /repertoires/:key/coverage`,
  `POST /repertoires/:key/moves`, `POST /repertoires/:key/import`,
  `GET /repertoires/:key/export?format=pgn|json&download=1`,
  `POST /repertoires/:key/trim`.
- Chapters/lines: `GET|POST /repertoires/:key/chapters`, `PATCH|DELETE /chapters/:id`,
  `PATCH /lines/:id`.
- Courses: `GET /courses`, `POST /courses/:slug/clone`.
- Verification only: `POST /practice/sessions`, `POST /practice/sessions/:id/attempt`,
  `GET /model-games?source=…`.

---

## Route additions needed (for the orchestrator; `App.tsx` was not edited)

1. **`/repertoires`** — production list route. Today the list lives at
   `/add?tab=manage` (functional, verified). A dedicated route would need an
   `App.tsx` entry and a page wrapper; the list/markup already exists inside
   `AddPage`.
2. **`/repertoires/:slug`** — production overview URL. The server returns
   `slug: null` for the seeded/legacy repertoires and `POST /repertoires` does
   not set one, so slug URLs need a server slug backfill plus a redirect. The
   app keeps `/repertoire/:id` (and `/build|gap|learn|practice/:key`).
3. **D107** — `/` is still gated by `localStorage.cb_entered` in `App.tsx`
   (owned elsewhere), so a first visit shows the landing page while `/dashboard`
   is the app home. Follow-up for the shell owner: route `/` to the dashboard
   once the local profile exists, or document the gate in the README.

No other route is required for this batch.

---

## Verification

All checks below were run locally; nothing was committed.

### 1. Build / types

- `npm run build` → passes (`45 modules transformed`).
- `npx tsc -p app/tsconfig.json --noEmit` → **no errors in the six owned files**
  (remaining errors are in `BuildPage.tsx` / `PracticePage.tsx`, owned by the
  builder-gap and practice-ui agents).

### 2. API persistence (temp copy of the real DB, `PORT=8799`, `tzOffset=-330`)

- `PATCH /settings {dailyGoal:30,sound:false,modelSource:"masters",boardTheme:"brown"}`
  round-trips on `GET /settings`; `/dashboard.daily.goal` and
  `/practice/daily.remaining` reflect the new goal; `/model-games?source=masters`
  uses the stored source.
- Chapters: create → `PATCH /lines/:id {chapterId}` → `GET /chapters` shows
  `lineCount:1` → rename → delete (line keeps existing, chapter id null).
- Clone → rename → delete a repertoire; `DELETE /repertoires/:key` removes it.
- Import `1. a3 e5 2. h3 Nc6` into the black repertoire: `1 imported`, saved
  increments; export returns `attachment; filename="…pgn"`.
- Trim previews return real counts (`rare` removed 4 on the legacy move set);
  coverage goal is passed as both `threshold` (1/N) and `coverageGoal` (1−1/N).
- A real practice session/attempt updated `/practice/daily` (reviews 2→4,
  wrong 1), the review list and the weak/worst opening report.

### 3. Built app in Chrome (Playwright, server on `8799`)

- `50/50` dashboard/settings/repertoire/add checks pass, including:
  - no "Connect account", no "Upgrade/Subscription/PRO", no early-access or
    connected-account rows;
  - rating sheet saves 1650 · Lichess and the row shows it;
  - coverage persists (1 in 100), recommended-moves size applies
    (`data-cb-rec-size=large`), animation-off injects `animation:none`;
  - daily goal saves to the server (40) and the dashboard progress bar uses it;
  - repertoire stats show explicit "Unavailable", coverage, correct counts;
    trim preview returns a real count; chapters sheet opens from `?sheet=chapters`;
  - adding a candidate increments Saved and shows the branch; manual SAN also
    increments Saved; PGN import from the UI increases Saved; course clone
    creates a repertoire;
  - manage tab rename/clone/delete all mutate the server.
- `10/10` create/rename/clone/delete/import/export/course-clone flow checks.
- Trim **apply** through the UI removed 13 of 65 lines on a cloned repertoire
  (65 → 52) and a line was assigned to a chapter through the sections sheet
  (`PATCH /lines/:id` confirmed).

### 4. Fresh curated DB (`PORT=8798`, `CHESSBOOK_SKIP_OPENINGS=1`)

- White repertoire renders captured characteristics: Effectiveness 1.0%,
  Soundness 93.6%, Learnability 58.6%, Expected results 51.3%, Sharpness 40.4%,
  coverage and counts; no "Unavailable" note.
- Black repertoire shows `Learnability —` (null is explicit, not 0).
- Dashboard shows "Nothing due — start the next pass", the biggest-gap row,
  and Kamsky–Anand; the real model game row is correct.
- Notification channels are read: enabling the daily reminder stored
  `notifications.dailyPractice=true`, and the Dashboard offered the permission
  fix row.
- Effects: the three themes change the rendered board colour and persist
  (`brown`); recommended-moves size changes candidate padding
  8/12/16 px; haptics fires `navigator.vibrate(20)` on rating save.
- Mobile 390×844: dashboard/settings/repertoire/add tabs have no horizontal
  overflow.

The verification servers (`8798`, `8799`) were started by this agent and were
stopped afterwards; no pre-existing server was touched.

---

## Residual gaps / notes

1. **Practice-side consumption of review preferences.** Practice mode, review
   style and pause-after-move are stored and exported as
   `getPracticePreferences()`, but `PracticePage`/`LearnPage` are owned by the
   practice-ui agent and do not read them yet. Follow-up (one import + a few
   reads):
   `const { mode, reviewStyle, pauseAfterMove, pause } = getPracticePreferences();`
2. **Sound volume/category gating on the board.** Volume, per-sound toggles and
   previews work in Settings, but `sounds.ts` (not owned) hard-codes
   `audio.volume = 0.38` and only reads `getSound()`. One-line follow-up:
   `audio.volume = getSoundVolume()` and skip when `!getSoundEffect(name)`.
3. **Piece sets.** Only `pieces/chessbook_monochrome` is bundled and
   `Board.tsx` hard-codes the path, so the sheet states this explicitly instead
   of offering fake sets. Additional appearances also need `Board.tsx` theme
   entries; the three real themes work.
4. **Rating on the server.** `/me` / `PATCH /user` / `PATCH /settings` have no
   rating-system/rating-value fields and `capture_profile` is read-only, so the
   rating sheet persists locally and is read where it can be (band note, Settings
   label). Coverage *does* reach the server through the trim body.
5. **Trim effectiveness depends on captured reports.** `rare`/`pastGoal` only
   remove lines whose parent position has a captured candidate report; on the
   fresh curated seed this is currently 0, while the legacy 50-line set removes
   4. The UI shows the real preview count either way.
6. **Course move trees.** `/courses` has real metadata; chapter/move trees were
   not captured, so clones can start with one matching guide line or none. The
   UI says so before cloning.
7. **Haptics are a no-op on desktop** where `navigator.vibrate` is absent; the
   call is made and returns false, mobile devices vibrate.
8. **Notifications** are browser-local (no email/account), one per channel per
   local day; that is the only honest local-first delivery available.
9. `/` gating (D107) and the `/repertoires` route are shell-level follow-ups
   (see above).

---

## Owned D-ID checklist

- [x] **D059** — Characteristics read from `repertoire.characteristics`
  (fresh DB: 1.0% / 93.6% / 58.6% / 51.3% / 40.4%); `available:false` renders
  an explicit "Unavailable" panel instead of learned/mastered arithmetic.
- [x] **D061** — Rename/clone/delete on the repertoire page and in
  `/add?tab=manage`; verified via UI (server rows changed) and curl.
- [x] **D062** — Chapters list/create/rename/delete and per-line
  `chapterId` assignment through `PATCH /lines/:id`; chapter counts are real.
- [x] **D063** — PGN import UI with `.pgn` file input (FileReader, 2 MB cap),
  paste box and multi-game support; UI import verified to increase Saved.
- [x] **D064** — PGN and JSON export rows download through
  `GET /repertoires/:key/export?format=…&download=1` (verified attachment).
- [x] **D066** — Four trim tools with dry-run preview; coverage goal from prefs
  is sent as `threshold`/`coverageGoal`; dashboard learnability opens the same
  tool with a real preview count.
- [x] **D107** — `/` gate documented as a shell follow-up; `/dashboard` is the
  working app home and the route note is in this report.
- [x] **D108** — Today's reviews rendered from `/practice/reviews` filtered to
  `daily.date`, with move, line, correct/played SAN and line links.
- [x] **D109** — `/openings/report` weak/worst rendered with real accuracy;
  empty state distinguishes "no reviews yet" from "no wrong moves" and labels
  the empty captured report.
- [x] **D110** — "Connect account" and fake "Not connected" report rows deleted;
  replaced by a local PGN import section with explicit no-account copy.
- [x] **D111** — Game-review path is the local PGN import flow
  (`/add?tab=import` → repertoire import); no online/OAuth path remains.
- [x] **D112** — Dashboard "Go to your biggest gap" uses the real `/gap`
  response (`bestMissing.san`, `1 in N`, heading prompt) and links to `/gap/:key`.
- [x] **D113** — "Improve learnability" runs a real `rare` trim dry-run, shows
  the candidate count and opens the trim sheet preselected.
- [x] **D114** — Feedback opens this repository's real GitHub issue form;
  share copies `location.origin`; the fake `https://chessbook.com` clipboard row
  is gone.
- [x] **D115** — Model-game row comes from `dashboard.modelGame`
  (Kamsky vs Anand, Candidats FIDE sf1, "White won", event/result/progress).
- [x] **D117** — Daily panel shows reviews/goal progress, current streak,
  highest streak and last streak date from `/practice/daily`.
- [x] **D118** — Repertoire list + creation flow live at `/add?tab=manage`
  (open/rename/clone/delete and stats); a dedicated `/repertoires` route is noted
  for the shell.
- [x] **D119** — Back affordance at the top of the dashboard (history back,
  `/dashboard` fallback).
- [x] **D134** — Rating row opens a Platform + Time control + value sheet
  (4 platforms, 4 time controls); no more string cycling.
- [~] **D135** — Coverage reaches the server through trim; rating cannot (no
  server field/endpoint) so it persists in prefs and is read for the band note
  in Add/Settings. Server gap recorded above.
- [x] **D136** — Coverage goal changes trim `threshold`/`coverageGoal` and the
  dashboard learnability preview; Settings copy explains the effect.
- [x] **D137** — Connected-account row removed; no fake Lichess/Chess.com state
  remains.
- [x] **D138** — Model-games source opens a sheet and PATCHes
  `settings.modelSource` (historical/masters/online); `/model-games?source`
  honours it and `online` has an explicit reason.
- [x] **D139** — Early-access no-op row deleted.
- [~] **D140** — Practice mode (individual/whole lines) persists in
  `cb_prefs_v1` and is exposed via `getPracticePreferences()`; the practice
  screen must read it (owned by practice-ui).
- [x] **D141** — Daily goal is the server `settings.daily_goal`, shown on the
  dashboard progress bar and counted by `/practice/daily`.
- [~] **D142** — Pause-after-move persists and is exported through
  `getPracticePreferences()`; practice-screen application is the practice-ui
  follow-up.
- [~] **D143** — Three real board appearances work and persist (verified colour
  change); more appearances need `Board.tsx` theme entries (not owned).
- [~] **D144** — The sheet states Chessbook Monochrome is the only bundled set
  and does not fake alternatives; adding sets needs `Board.tsx`/bundled assets.
- [~] **D148** — Master sound switch is server-backed; volume + per-sound
  toggles persist and preview at the chosen volume; board playback volume is a
  one-line `sounds.ts` follow-up.
- [x] **D149** — Haptics calls `navigator.vibrate` on rating save/add/trim and
  was verified with a stubbed vibrate (`[20]`).
- [x] **D150** — Recommended moves size changes the candidate row padding
  (verified 8/12/16 px in the built app) and applies to builder/gap/add.
- [x] **D151** — Subscription/upgrade row deleted; no subscription/paywall copy
  remains in Settings.
- [x] **D154** — Row set normalised into rating / review / notifications /
  board / data sections; account, subscription, early-access and
  connected-account rows removed; reset rows retained in Data.
- [x] **D155** — Every setting opens a dedicated modal/sheet with choices and a
  checkmark; no inline cycling.
- [~] **D156** — Review style (cards / complete once / complete every time /
  entire line) and the three pause switches persist and are exported; the
  practice screen consumes them via `getPracticePreferences()` (follow-up).
- [x] **D157** — Four notification channels + browser permission request;
  Dashboard reads them and offers a fix when permission is missing.

Legend: `[x]` implemented and verified in this batch; `[~]` implemented on the
client but with an explicit dependency/limitation recorded above.
