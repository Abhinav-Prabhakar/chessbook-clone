# Audit remediation progress

Status as of the final hardening pass. Every batch was implemented by a
subagent, verified by that subagent, and then re-checked by the orchestrator
with the full test suite and a live end-to-end run.

Verification at close (final engine/coverage/pieces/history pass):

- `npm test` → **91/91 pass** (unit + API + contract).
- `npm run test:e2e` → **126/126 checks** on a fresh temp database, desktop
  (1440×900) and mobile (390×844), zero unexpected console errors.
- `npm run build` → green.
- All 9 headline acceptance tests in `AUDIT.md` pass (details below).
- Screenshots and machine-readable results: `audit/e2e/`.

Reports (implementation detail + evidence per ID):

- `audit/progress/01-server-core.md`
- `audit/progress/01b-server-data.md`
- `audit/progress/02-practice-ui.md`
- `audit/progress/02-builder-gap.md`
- `audit/progress/02-dashboard-settings.md`
- `audit/progress/02-visual-fidelity.md`
- `audit/progress/03-model-games.md`
- `audit/progress/03-core-followups.md`
- `audit/progress/04-play-features.md`
- `audit/progress/04-content-surfaces.md`
- `audit/progress/05-hardening.md`

## Divergence register status

### A. Core training engine / practice — D001–D034

| Status | IDs |
|---|---|
| Done | D001–D009, D011–D016, D018–D034 |
| Done (rating model; UI surfaces it in practice/profile) | D010 |
| Done with captured-data limits | D017 (incidence only for positions present in the production capture) |

Key outcomes: per-position FSRS review state keyed by EPD+SAN; practice walks
each user move with opponent auto-replies; wrong moves keep position, Due and
counters; due/all/weak/common/cards/whole-line modes terminate; server-side
legality; idempotent reviews; notes, hints, refutation, skip/keep/start-over,
resume, daily goal, streaks and training rating.

### B. Repertoire builder — D035–D070

| Status | IDs |
|---|---|
| Done | D035–D070 |
| Done (contract exposed for builder/gap) | D033/D191 arrows |

Candidates come from captured production position reports (Masters %, eval,
peer results, incidence, annotations); gap is incidence-weighted; autofill
inserts real branches by style; branches are disable-able/re-enable-able and
batch-remove is transactional; `?line`/`?epd`/`?path` open exact positions.

### C. Gap finder — D071–D082

All done: D071–D082. Black after `1.e4` returns `c5, e5, e6, c6, d5` by real
incidence; heading move/side, descriptions, Expected-in, Show more, notes,
exclusion, exact-position build/practice links, and next-gap-in-line work.

### D. Learn screen — D083–D093

All done: D083–D093. Counts are real saved moves/positions; modes are
due/weak/all/early/common/specific/resume; mastery is one decimal; empty-due is
reachable and honest.

### E. Model games — D094–D106

All done: D094–D106. Real Kamsky–Anand daily game (Candidats FIDE sf1, 45
moves) plus real history, captured 89-sample eval graph, interactive
guess-the-move, hints, progress/review score, history grouped by week/opening,
and links to matching saved openings.

### F. Dashboard — D107–D119

| Status | IDs |
|---|---|
| Done | D108–D119 |
| Documented intentional deviation | D107 (`/` shows the landing page until `cb_entered`; `/dashboard` is the app root, documented in README) |

Daily reviews/goal/streak, biggest-gap and learnability tasks, openings report,
model-game row, local PGN review path, feedback links and Back affordance are
real. Fake connect-account rows are removed.

### G. Openings, data and content — D120–D133

| Status | IDs |
|---|---|
| Done | D120–D133 |
| Done with captured-data coverage limits | D120–D128 (supplementary names, incidence, masters/peers/engine, annotations, courses, guides, transpositions, coverage exist for captured positions; uncaptured positions return explicit unavailable states) |

Production guide/coaches/blog/repertoire routes exist with captured content.

### H. Settings and review/board preferences — D134–D157

| Status | IDs |
|---|---|
| Done | D134–D157 (five real bundled piece sets with previews/attribution; review style, cards, pauses, notifications, sound, haptics, animation, board appearances, recommended-move size and daily goal all wired) |

Rating/coverage are persisted server-side and drive incidence/gap/trim/common;
review styles, cards, pauses, notifications, sound volume/effects, haptics,
animation, board appearances, recommended-move size and daily goal all affect
behaviour. The subscription/upgrade rows are deleted.

### I. Missing screens / routes — D158–D171

| Status | IDs |
|---|---|
| Done | D158–D162, D164–D167, D169, D171 |
| Done (guide routes; captured detail varies) | D163 |
| Intentional / documented | D168 (no account/subscription screens; entitlement chrome removed) |
| Done | D170 (unknown routes redirect home) |

Training games, blunder puzzles, intuition, visualization, vision, opening
guides, coaches, blog, `/repertoires`, onboarding and help now exist.

### J. UI / visual fidelity — D172–D195

All done: D172–D195. Practice rows/note line/prompt glyph match production;
clone-only toasts and footer removed; drag + promotion + keyboard work; mobile
uses the clipped-board + sheet composition with segmented stats and top bar;
loading skeletons and landing nav match; settings values open sheets.

### K. Backend, data integrity and architecture — D196–D212

| Status | IDs |
|---|---|
| Done | D196–D200, D202, D204–D212 |
| Done | D203 (Stockfish 19 Lite WASM is bundled and used for refutations, model reviews, candidate evals and puzzle answers, with a labelled fallback only if the worker cannot start) |
| Intentional local-first omission | D201 (no WebSocket; single-player local app needs no live socket — documented) |

Migrations v1–v3 upgrade existing databases in place; captured data has
provenance hashes; per-move review logs; idempotent submits; date handling;
delete/import/export/notes/report APIs; integrity endpoint; error boundary;
offline write queue; README corrected.

### L. Premium-gated capability availability — D213–D217

| Status | IDs |
|---|---|
| Done | D213, D216 (training games, puzzles, courses, reports, export, full model history now exist for everyone) |
| Intentional | D214, D215, D217 (no limits, billing, paywall, PRO badges or plan pills; dead upgrade row removed) |

### M. Testing and process quality — D218–D225

All done: D218–D225. 78 server/contract tests, 124-check browser E2E, data
integrity checks, seed data is the curated real repertoire (no index-assigned
fake stats or `"e4"` wrong attempts), duplicate fetches deduped, README claims
match reality.

## Headline acceptance tests

| Test | Result |
|---|---|
| Practice at `1.e4 c5` asks `2.＿`; `Nf3` auto-plays `Nc6` and asks `3.＿` with `1.e4 c5 2.Nf3 Nc6` visible | PASS |
| A wrong legal move keeps `N Due`, shows refutation/retry, and does not change the line | PASS |
| Answering all due moves reaches Review complete and `Due` becomes 0 | PASS |
| Reloading mid-session resumes at the same position | PASS |
| “View in build mode” opens the exact current position | PASS |
| Adding a move increments Saved, is not immediately due, and appears in the builder tree | PASS |
| Gap for Black after `1.e4` lists `c5, e5, e6, c6, d5` ordered by incidence with Expected-in | PASS |
| Model-game board accepts a guess, hides the answer, records pass/fail; correct 45-move game/event/result | PASS |
| Mobile 390×844 shows the clipped two-rank board and full-width sheet | PASS |

## Remaining known limitations (not silent gaps)

1. **D201** — no WebSocket. Intentional for a single-machine, no-account app;
   every flow is request/response and reload-safe.
2. **D107** — `/` is the landing page until `cb_entered`; `/dashboard` is the
   app root. Documented in the README.
3. **Playback/anti-cheat are local.** Visualization FENs are in the client
   payload; a local user could inspect network responses. Acceptable for a
   single-player trainer, documented in the README.
4. **Pre-made course library** is the captured sample. Opening guides, coaches,
   blog posts and courses come from the production captures; no additional
   marketplace content is fetched.

Everything from the original limitations list is otherwise closed:
five real piece sets (D144), bundled Stockfish 19 for refutations/reviews/evals
(D203), offline real masters + rating-band peer/incidence coverage for the
whole opening tree, and a full review-history browser (D018/D022).
