# Batch 5 — hardening, docs, recovery, offline, tests and final sweep

Owner: `hardening`
Scope: `app/src/App.tsx`, `main.tsx`, `api.ts`, `profile.tsx`,
new `components/ErrorBoundary.tsx`, new `components/OfflineBanner.tsx`,
`pages/PracticePage.tsx`, `pages/BuildPage.tsx` (link placement only),
`README.md`, `package.json`, `app/public/sw.js`, `app/public/offline.html`,
`tests/**`, `audit/e2e/**`, plus small cross-cutting fixes for the listed
D-IDs in `HelpPage`, `PlayLayout`, `LegalPage`, `landing-body.html`,
`server/api.js`, `server/db.js` and `server/index.js`.

Status: **implemented and verified.** Nothing committed. No server left running.
All verification used throwaway SQLite databases and the isolated port **8796**.

---

## 1. Changes

### D210 — recoverable render error boundary

- New `app/src/components/ErrorBoundary.tsx`: class boundary with
  `getDerivedStateFromError`, console diagnostics, and a fallback offering
  **Try again** (re-render), **Reload page** and **Back to dashboard**.
- `App.tsx` wraps the routed tree in the boundary, keyed by `pathname`, so
  navigating (including the fallback's dashboard link) clears the error.
- The boundary is inside `BrowserRouter`, so its `Link` fallback works. It does
  not catch event/async errors (those are handled by page `catch` blocks and
  the offline queue), which is the correct React contract.
- E2E injects a malformed `/api/dashboard` response, asserts the fallback is
  visible (the app is not blank), then removes the fault and clicks **Try
  again**: the dashboard recovers.

### D211 — offline reads + queued writes

- `app/src/api.ts` now queues failed non-GET requests in
  `localStorage["cb_offline_queue"]`:
  - pre-checks `navigator.onLine === false` and queues immediately;
  - catches network/`TypeError` failures when the browser is nominally online
    (local API stopped) and queues those too;
  - never queues 4xx responses (validation is terminal);
  - deduplicates by the existing `submissionId` idempotency key, so a repeated
    practice attempt cannot double-queue;
  - replays in order on the `online` event and exposes **Retry now**;
  - drops terminal 4xx entries so the queue cannot wedge; network/5xx stops the
    replay and leaves the rest queued.
- Practice attempts already send `submissionId`; the existing server idempotency
  makes replay safe. After a replay, `PracticePage` listens for
  `cb:offline-flushed` and re-fetches the authoritative session, so the board
  advances to the replayed state.
- New `app/src/components/OfflineBanner.tsx`: global, accessible banner with
  offline / queued / syncing / retry states, mounted in `App.tsx`.
- Service worker bumped to `chessbook-v5`; reads still use network-first with a
  cached fallback. `offline.html` now explains that changes are queued.
- E2E goes offline, toggles a SQLite-backed setting, asserts the banner and the
  queued PATCH, reconnects, and verifies the queue empties and SQLite received
  the change.

### D212 — README rewritten

`README.md` now describes the actual build and explicitly lists what is absent:
no Stockfish, no WebSocket, no auth/account/subscription, no online-game import,
no telemetry, limited captured position/course data, one piece set and two
rating bands. It documents the captured-data provenance table, the honest local
engine, the offline queue, accurate quick-start commands, real routes and the
test scripts. It no longer claims a completed production feature set.

### D218/D219/D220 — tests and scripts

- `package.json`:
  - `"test": "node --test tests"` (all tests, not just `tests/server`).
  - `"test:e2e": "npm run build && node audit/e2e/main-flow.mjs"`.
- `tests/server/contract.test.js` — **12 API contract tests**: health, profile
  and settings shapes, absence of entitlement fields, repertoire/candidate
  shapes, gap incidence ordering, practice session/attempt contracts,
  idempotent submissions, wrong-answer invariants and labelled refutation,
  400/404/422 error shapes, settings validation, play capabilities
  (`stockfish:false`), the 45-move model game, and JSON unknown-API responses.
- `audit/e2e/main-flow.mjs` — self-contained Playwright runner:
  - preflights port 8796 (fails instead of reusing a stale server);
  - spawns Express with a temp `CHESSBOOK_DB` and `CHESSBOOK_SKIP_OPENINGS=1`;
  - main flow: line `1.e4 c5 2.Nf3 Nc6`, wrong legal move, refutation,
    auto-replies, next move, reload resume, build hand-off, completion and
    `Due: 0`;
  - offline queue round-trip;
  - error-boundary recovery;
  - model-game wrong/correct guess and progress;
  - every route at **1440×900** and **390×844**, including unknown-route
    redirect, `/qr`, deep help anchors and the 136 px mobile board strip;
  - console/page-error capture, screenshots, `summary.json`, `server.log`;
  - always stops the server and verifies port 8796 is free.
  - `E2E_ONLY=flow|offline|error|model|routes|landing` allows targeted reruns.

### D222 — duplicate StrictMode fetches

StrictMode is retained. Two complementary dedupes were added:

- `api.get` shares an in-flight GET for the same path (removed when it settles,
  so no stale cache).
- `ProfileProvider.refresh` shares the whole `/me` → `/settings` →
  `/practice/daily` hydration across the second StrictMode mount.

This removes the duplicate profile/settings requests without hiding bugs or
caching stale data.

### D170 — unknown-route parity

Removed the custom 404 card and `NotFound` component. Unknown routes now
`<Navigate to="/" replace />`, matching production (the entered browser lands
on the dashboard). E2E asserts the redirect and the absence of “Page not found”.

### D169 — deep help anchors

- `HelpPage` now has ids: `top`, `start-here`, `drills`, `guides`, `faq`,
  `still-stuck`, plus per-feature anchors `training-games`, `blunder-puzzles`,
  `intuition-builder`, `visualization`, `vision`, `practice`, `builder` and
  `mobile-apps`.
- `PlayLayout` links **How this drill works** to `/help#<feature>` and **All
  help** to `/help#drills`.
- `ScrollToTop` now honours the hash after the target renders (and still scrolls
  to top for normal navigation).
- Practice/builder rows link to `/help#practice` and `/help#builder`; the Help
  Play Store card links to the local `/qr` route.

### D034 / D133 — real links

- Practice: **Play a training game from here** links to
  `/training-games?fen=<current FEN>&color=<repertoire color>&from=practice`.
- Builder: same row links with `from=build` and the exact current position.
- E2E reads both `href`s and asserts the FEN/`from` contract.
- `/qr` now exists outside the profile gate and renders **Chessbook on your
  phone** with the real Play Store and App Store links. Unlike production, it
  does not automatically redirect off-site: that would break offline use and the
  back stack. The route is reachable from Help’s mobile-apps card.

### D168/D217 — entitlement sweep

- Grepped the client and server for PRO/badge/lock/upgrade/subscribe/plan/
  account/login remnants. No PRO pill, lock, paywall, plan pill, upgrade row or
  entitlement gate is rendered. Remaining occurrences are explanatory copy
  (“no account”, “no subscription”, derivation `plans`/`planArrows`) or the
  captured public app-store links.
- Removed the last account-field residue: `users.plan` is gone from the fresh
  schema and seed, and `/me` no longer exposes `plan`. (`User.plan` removed from
  types.) Existing databases may retain the unused column; no code reads it.
- Rewrote the local legal pages so they no longer claim paid subscriptions,
  refunds, trials or connected Lichess/Chess.com accounts. They now state the
  build has no purchases/subscriptions and point contact at the project issue
  tracker.
- Corrected the captured landing copy that claimed account connection for game
  review; it now says to import a PGN. The pre-made-repertoires link points at
  the real local tab (`/openings?tab=pre-made`).

### D201 / D203 — honest documentation

`README.md` records both as intentional/limited:

- **D201:** no WebSocket. Every flow is turn-based request/response; responses
  carry the next authoritative state and reload re-fetches it. A socket would be
  a second source of truth with no local single-player benefit.
- **D203:** no Stockfish binary/WASM exists in the repository (the only
  `stockfish-*` file in `recon/` is a Sentry loader stub). Bot moves,
  refutations, puzzle answers and reviews use the local deterministic heuristic
  engine; every response carries `engine`, `stockfish:false`, depth and node
  budget. No engine output is labelled Stockfish.

### D225 — feedback links

Re-verified the dashboard: **Report an issue** opens this repository’s issue
tracker, and “Copy this app’s address” shares the local origin. No production
analytics, survey or account links remain in dashboard copy. No new code was
needed beyond the legal/landing copy clean-up.

---

## 2. Verification

### Unit / API

```text
npm test
ℹ tests 78
ℹ pass 78
ℹ fail 0
```

(66 existing + 12 new contract tests.)

### Build

```text
npm run build
✓ built in ~0.2–0.3 s
```

(Vite warns only about the single >500 kB client chunk, unchanged.)

### E2E (isolated DB, port 8796)

```text
npm run test:e2e
122 → 124 checks passed, 0 failed
```

Final `audit/e2e/summary.json`:

```json
{ "checks": 124, "passed": 124, "failed": 0, "failures": [], "consoleErrors": [] }
```

Artifacts:

- `audit/e2e/flow/01-start.png` … `07-complete.png`
- `audit/e2e/error-boundary.png`
- `audit/e2e/offline-queued.png`
- `audit/e2e/model-guess.png`
- `audit/e2e/desktop/*.png` (34 routes)
- `audit/e2e/mobile/*.png` (34 routes at 390×844)
- `audit/e2e/summary.json`, `console-errors.json`, `server.log`

Every route was loaded at both viewports; no unexpected console or page errors
were recorded. The server process was stopped and `lsof -ti :8796` was empty
after the run.

---

## 3. Acceptance checklist from `AUDIT.md`

Run against the production build on the isolated 8796 database.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Enter practice at `1.e4 c5`; `Nf3` auto-plays `Nc6`, next prompt, line visible | **PASS** | E2E starts the Open Sicilian line (`?mode=line&line=2`), answers `e4`→auto `c5`, `Nf3`→auto `Nc6`, sees `1. e4 c5 2. Nf3 Nc6`. Note: an unfiltered `all` session picks the seeded Najdorf line first and auto-replies `d6`; both are real saved lines. |
| 2 | Wrong legal move keeps `N Due`, shows refutation/retry, does not change line | **PASS** | E2E: `a3` rejected, notice “Nc6 is the strongest reply…”, same prompt/line/remaining/Due, correct count 0, refutation notice. The session’s wrong-attempt `✘` counter does increment (see residual gap 2). |
| 3 | Answering due moves reaches Review complete and `Due` → 0 | **PASS** | E2E completes a line session and asserts `Session complete` + `0 Due` + API `due:0`; a new due session is `complete:true`. Server test `due mode…` completes a non-empty due queue after `keep` and asserts black `due:0`. Fresh seed has 0 due, so the UI run starts the demonstration from the line/all queue. |
| 4 | Reload mid-session resumes the same position | **PASS** | E2E reloads after `Nf3/Nc6`; same prompt and same session/task (`d4`) returned. `PracticePage` now writes `?session=<id>` into the URL. |
| 5 | View in build mode opens the exact current position | **PASS** | E2E parses `?path=e4,c5,Nf3,Nc6` from `/build/white` and returns to the same practice position. |
| 6 | Adding a move increments `Saved`, is not immediately due, appears in the tree | **PASS** | `tests/server/practice.test.js` “adding a move creates a saved branch that is not immediately due”: `saved + 1`, `due:false`, `dueAt:null`, `totalLines/lineCount + 1`, duplicate/illegal/PGN cases. |
| 7 | Gap for Black after `1.e4` lists `c5,e5,e6,c6,d5,…` by incidence with Expected-in | **PASS** | `contract.test.js` asserts that exact top-six order, non-increasing top-10 incidence and `oneIn ≥ 1`; `/gap/black` loads in both viewports. |
| 8 | Model board accepts a guess, hides the answer, records pass/fail; 45 moves, correct event/result | **PASS** | E2E: captured Kamsky–Anand, Candidats FIDE sf1, `1-0`, 89 plies (45 moves); wrong guess is rejected and scored as a miss, correct `e4` is recorded and progress advances. |
| 9 | Mobile 390×844 shows the clipped two-rank board + full-width sheet, not a full board | **PASS** | E2E measures the mobile board strip at **136 px** (viewport 390×844); all 34 mobile routes load without console errors. |

---

## 4. D-ID checklist

- [x] **D034** — “Play a training game from here” added to Practice and Build with the real `?fen=&color=&from=` contract; E2E asserts both hrefs.
- [x] **D133** — `/qr` route added (public), rendering real Play Store/App Store links; no automatic off-site redirect (documented choice).
- [x] **D168** — no entitlement chrome; `users.plan`/API `plan` removed on fresh schema; legal/landing copy no longer claims subscriptions/accounts.
- [x] **D169** — Help deep anchors + PlayLayout “How this drill works” links + hash-aware scrolling.
- [x] **D170** — unknown routes redirect home; custom 404 card removed; E2E asserts redirect.
- [x] **D201** — documented as an intentional local-first omission (no WebSocket; turn-based).
- [~] **D203** — documented honestly and labelled everywhere (`stockfish:false`, engine/depth). No bundled Stockfish exists, so no WASM was wired.
- [x] **D210** — routed error boundary with Try again/Reload/Dashboard; E2E fault-injection recovery.
- [x] **D211** — offline write queue with idempotent replay + global banner; E2E offline round-trip; SW v5/offline page updated.
- [x] **D212** — README rewritten to match the implementation and explicit unavailability.
- [x] **D217** — final entitlement sweep clean; only explanatory/plan-arrow occurrences remain.
- [x] **D218** — `npm test` runs all tests; 78 pass.
- [x] **D219** — 12 contract tests pin response/error/entitlement contracts.
- [x] **D220** — main-flow E2E plus full desktop/mobile route sweep; 124/124 checks.
- [x] **D222** — StrictMode retained; in-flight GET + provider-refresh dedupe added.
- [x] **D225** — dashboard feedback verified local (GitHub issues/origin); no production analytics copy.

---

## 5. Residual gaps (exact owner/file)

1. **D203 is honest, not equivalent.** No Stockfish binary/WASM is available
   locally. Future engine work belongs in `server/bot.js` / a new engine asset;
   until then refutations/reviews are the local material/mate search and the UI
   says so.
2. **Wrong-attempt counter increments immediately.** Due/remaining/position are
   preserved, but `✘` goes 0→1 on a retry. Production holds it until the
   position is solved/skipped. Exact owner: `server/api.js`
   (`UPDATE practice_sessions SET wrong = wrong + 1` on a wrong attempt) and
   `app/src/pages/PracticePage.tsx` (`setSession(result.session)`). Attempts are
   separately recorded in `reviews`/`attempts`, so the session summary could stop
   incrementing `wrong` on retry without losing history if strict parity is
   wanted.
3. **Default `all` mode picks the Najdorf seed line first**, so `1.e4 c5 2.Nf3`
   auto-replies `d6`. The Open Sicilian line (`line=2`) gives `Nc6`, and the E2E
   uses that. If production’s primary-line ordering matters, owner:
   `server/db.js` seed order / `server/repertoire.js` queue ordering.
4. **Queued practice attempts are applied on reconnect but a rejected queued
   write leaves the page stale until reload** (the banner reports it). Owner if
   changed: `app/src/api.ts` + `app/src/pages/PracticePage.tsx`.
5. **Existing databases keep the unused `users.plan` column.** Fresh databases
   no longer create it; no code reads or exposes it. A strict schema cleanup
   would need a migration in `server/schema.js`.
6. **`/qr` does not auto-redirect off-site.** Intentional: automatic third-party
   redirects break offline use and the back stack. It is a real link page.
7. **E2E needs Google Chrome** (`CHROME_PATH` overrides the macOS default); no
   browser is bundled. This is a dev-environment requirement, not a product gap.
8. **No analytics/feedback parity (D225) by design.** Local GitHub issues and
   the local origin replace production surveys/account links.
