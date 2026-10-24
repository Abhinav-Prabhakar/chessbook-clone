# Chessbook clone — full divergence audit

**Audited:** 23 Oct 2026
**Target:** `https://chessbook.com` (live account, verified as `ztoa777111@gmail.com`)
**Local build:** `npm run dev` on `localhost:5173` / `localhost:8787`
**Method:** live Playwright sessions against the real app, network/API capture, captured production DOM/CSS in `recon/`, local API probes, direct SQLite inspection, and screenshot comparison at 1440×900 and 390×844.

---

## Verdict

This is **not an exact clone**. The desktop *shell* is close: spacing, colours, typography, board geometry and most sidebar rows were measured from production and look very close in a side-by-side. The **product underneath the shell is a prototype**, not a reproduction.

The three biggest gaps are:

1. **The main training loop is structurally different.** The real app trains **individual positions/moves along a line**, auto-plays the opponent's reply, and tracks SRS per move. The local app quizzes **only the final move of a flat saved line**, has no opponent reply, and schedules the whole line with one fixed interval. In the live account, `1.e4 c5 → 2.Nf3` was answered, then `Nc6` was auto-played and `3.d4` was asked. The local app stops after `Nf3`.
2. **Most of the data is invented.** Builder eval/peer numbers are hashes; "Masters" shows local mastery; Effectiveness/Soundness/Learnability are arithmetic over `learned`/`mastered`; autofill just flips database flags; model-game eval is a hard-coded flat line; the model game is the wrong game.
3. **Large parts of the real product are absent.** Training games vs a bot, Blunder puzzles, Intuition builder, Visualization, Vision, opening guides, pre-made repertoires, coaches, blog, openings report, per-position notes/plans, per-move annotations, and dozens of settings are missing. The premium-gated features are absent too, even though the desired product has **no subscription, no account, no premium marks, and all premium features unlocked**.

**Intentional deviations — explicitly out of scope (do not count as bugs):**

- No login, signup, password reset, OAuth, profile, delete-account, or log-out surfaces.
- No subscription, billing, checkout, plan limits, upgrade rows, PRO badges, lock icons, or paywalls.
- No cloud account, telemetry, or analytics.
- Local SQLite is the source of truth; the app runs on one machine.
- Premium-gated capabilities (training games, puzzles, courses, reports, export, full model-game history, etc.) **should still exist and be available to everyone**, just without account/subscription UI around them.

Everything else below is an unintended divergence.

---

## What actually works

These are real and should be preserved while fixing the rest:

- Board renders 64 squares, legal-move generation, click-to-move, last-move highlight, sounds, piece animation.
- The 3,865-row Lichess ECO import is real and searchable.
- The desktop app shell, sidebar rows, progress bars, breadcrumbs, and the landing page are close to production.
- Dashboard/repertoire counts are seeded to mirror the reference account (4% complete, 34% mastered, 7 saved, 6 due).
- SQLite persistence exists for the local profile, repertoires, lines, attempts, settings, openings and model progress.
- PWA manifest/service worker/offline shell exist.
- Settings persistence exists for the subset that is actually implemented (board theme, coordinates, legal moves, sound, daily goal).

---

## Evidence highlights

| Observation | Real app | Local app |
|---|---|---|
| Practice start | `1.e4 c5` then `2.＿` | `1.e4 c5` then `2.__` |
| Answer `Nf3` | Auto-plays `Nc6`, asks `3.＿`, shows note | Shows `Nf3`, asks for "Next line" |
| Wrong move | Counters stay `3 Due / 2 ✔ / 0 ✘`; position retries | Due count drops `5 → 4`; next line pointer changes |
| Gap at `1.e4` for Black | `c5` (1 in 3), `e5` (1 in 4), `e6` (1 in 8), `c6` (1 in 9), `d5` (1 in 13) | `f6`, `g5`, `h6`, `f5`, `h5`, `Nh6`, `Na6` — alphabetical ECO junk |
| Practice/schedule API | `POST /api/v1/openings/moves_reviewed` with `epd`, `san_plus`, `side`, `correct`, `daily` | `POST /api/practice/attempt` with `lineId`, `san`, `mode` |
| Model game | Kamsky–Anand, Candidats FIDE sf1, Kamsky won in 45 moves, interactive guess-the-move | Kamsky–Anand, Dortmund 1992, 1/2, 10 moves, board not interactive |
| Rating setting | Opens a Platform/Time-control sheet | Cycles a string in localStorage |
| Settings scope | ~25 review/board/notification settings | 11 visible rows, 5 of which are no-ops |

---

## The 20 blockers that matter most

If only 20 things get fixed, fix these:

1. **D001/D002** — practice must walk the line move-by-move and auto-play opponent replies.
2. **D003/D009** — per-position SRS/review state, not one flat line schedule.
3. **D004/D005** — `due` and `all` sessions must actually terminate.
4. **D007/D008** — a wrong move must not decrement `Due` or change the next line.
5. **D006** — "moves I get wrong" must require real mistakes, not every line.
6. **D021** — validate played moves server-side.
7. **D035** — builder must show all common candidates, not only already-saved lines.
8. **D036/D037/D038** — stop showing mastery as Masters and hashes as eval/peers.
9. **D044** — autofill must add moves, not flip flags.
10. **D054/D055** — saving a move must create a real branch and increment Saved.
11. **D071/D072** — gap must use the biggest miss/incidence, not the lowest-mastery deep line.
12. **D083** — Learn "All moves" must count saved moves/positions, not 50 seed rows.
13. **D094/D095/D099** — real model-game data and an interactive guess-the-move board.
14. **D145/D157** — settings that exist must actually affect behaviour.
15. **D158** — training games vs the bot.
16. **D159/D160/D161/D162** — Blunder puzzles, Intuition, Visualization, Vision.
17. **D163/D164/D165** — opening guides, coaches, blog content surfaces.
18. **D186/D187** — mobile must use the production clipped-board/sheet composition.
19. **D218/D220** — tests for the core loop and API.
20. **D212** — README/claims must stop describing mocks as complete.

---

## Screen parity matrix

| Real screen | Local equivalent | Status |
|---|---|---|
| `/` dashboard | `/` (marketing until `cb_entered`) or `/dashboard` | Partial; data is seeded |
| `/repertoires/:slug` overview | `/repertoire/:key` | Partial; stats are fake and routes differ |
| Build / "Continue building" | `/build/:key` | Partial; candidates/stats/autofill wrong |
| "Biggest gap" / "Choose a move to prepare for" | `/gap/:key` | Wrong algorithm and wrong screen |
| Learn / "What do you want to practice?" | `/learn/:key` | Partial; modes and counts wrong |
| Practice / "Practicing moves" | `/practice/:key` | **Broken core loop**; single move only |
| Model game + history | `/model` | **Mock**; one wrong game, non-interactive |
| Settings | `/settings` | Partial; many no-ops |
| Add repertoire | `/add` | Close |
| Opening guides `/openings`, `/openings/:slug` | `/openings` → `/add` | Missing |
| Pre-made repertoires (catalogue) | none | Missing |
| Training games `/training-games` | none | Missing |
| Blunder puzzles `/blunder-puzzles` | none | Missing |
| Intuition builder `/intuition-builder` | none | Missing |
| Visualization `/visualization` | none | Missing |
| Vision `/vision` | none | Missing |
| Coaches `/coaches`, profiles, apply, review | none | Missing |
| Blog `/blog`, posts | none | Missing |
| Repertoire list `/repertoires` | none | Missing |
| Onboarding / welcome | none | Missing |
| Account, subscription, upgrade, PRO | none | **Intentionally excluded** (remove dead remnants) |
| Login/signup/reset | none | **Intentionally excluded** |
| Legal pages | `/legal/:kind` | Present |

---

## Data-model comparison

| Concern | Production | Local | Consequence |
|---|---|---|---|
| Repertoire unit | Position/move graph keyed by EPD + SAN, with reports/annotations | Flat `lines` row with `moves` string and one `expected_san` | Cannot branch, transpose, teach multiple moves, or train per move |
| Review state | Per-move FSRS (stability, difficulty, lapses, due) | Per-line `learned`, `mastered`, `due_at` | Wrong scheduling; whole-line due counts; no difficulty |
| Review transport | `POST /api/v1/openings/moves_reviewed` with `epd`, `san_plus`, `side`, `correct`, `daily`, `submission_id` | `POST /api/practice/attempt` with `lineId`, `san`, `mode` | No position-level history, no idempotency |
| Candidate stats | Masters %, engine eval, peer results, incidence, annotations | Local mastery, hashed eval, hashed peer bars | UI shows invented numbers |
| User/settings | Rich user + `frontendSettings` + flags | id/email/name/plan + a narrow `settings` row + localStorage | Half the settings cannot affect behaviour |
| Courses | Official/pre-made repertoires with author, coverage, characteristics | None | A whole acquisition/content path is missing |
| Opening metadata | Supplementary EPD names + `friendlyName` + transpositions | One ECO/name per Lichess TSV row | Wrong names/coverage; no friendly names |
| Model games | Daily game + history, SAN/EPD evals, players, performances | One hand-written short PGN | Wrong game and no review |
| Training games | Bot/Oxi + rating/time control + post-game review | None | A major product pillar is absent |
| Puzzles | Blunder/vision/visualization/intuition with rating and stats | None | A major product pillar is absent |

---

# Divergence register

Severity: **P0** breaks the core product, **P1** missing/incorrect product feature, **P2** UI/data quality.
Status: **BROKEN**, **MOCK**, **MISSING**, **DIVERGENT**.

## A. Core training engine / practice

- **D001 (P0, BROKEN) — Practice quizzes only the last move of a line.** `server/api.js:84` selects one line and compares against `line.expected_san`; the client never walks the line. Real Chessbook quizzes every move of the line at the position where it is the user's turn. Evidence: live practice continued `2.Nf3 → Nc6 → 3.d4 → cxd4 → 4.Nxd4 → e5 → 5.＿`.
- **D002 (P0, MISSING) — No opponent auto-reply.** Real app auto-plays `Nc6`, `cxd4`, `e5` after each correct move. Local board freezes after the user's move; the "line" display only shows the saved prefix.
- **D003 (P0, MISSING) — No per-position review state.** Real stores/updates per EPD+SAN (`moves_reviewed`) and SRS is per move. Local stores one `learned/mastered/due_at` per line.
- **D004 (P0, BROKEN) — `due` mode returns a line when nothing is due.** `GET /api/practice/next?repertoire=black&mode=due` returns line 51 with `remaining:0, complete:false`, even though the black repertoire has 0 due. Real app says there are no moves due and does not start a review.
- **D005 (P0, BROKEN) — "All moves" never completes.** For `mode=all`, `remaining` is always `COUNT(*)` of the repertoire (50), so the session can never reach `complete:true` (`server/api.js:111-121`, `:145`).
- **D006 (P0, BROKEN) — "Moves I often get wrong" includes never-attempted lines.** The `weak` query is a `LEFT JOIN attempts` ordered by `wrong DESC`; every line with zero attempts is included, and the fallback uses `mastered < 80`. Real "difficult" uses FSRS difficulty/expected-wrong data.
- **D007 (P0, BROKEN) — Wrong answers decrement the due counter.** `PracticePage.tsx:137` unconditionally applies `result.next.remaining`; `POST /attempt` moves the line's `due_at` +10 min, so the counter drops. Real wrong-move counters stay unchanged until the position is solved/skipped.
- **D008 (P0, BROKEN) — Wrong answers silently change the next line.** `POST /attempt` returns `next` computed after mutating the current line; `PracticePage` stores it and "Next line" advances to a *different* line than the one shown. The UI and the underlying session diverge.
- **D009 (P0, BROKEN) — SRS is not spaced repetition.** Correct: `mastered += 12`, `dueAt = +3 days`; every correct after 100 gives +30 days. There is no stability, difficulty, lapse count, or review history (`server/api.js:494-510`). Real uses FSRS and records each review.
- **D010 (P0, MISSING) — No training rating / adaptive difficulty.** Real account has `trainingRating: 1900`, deviation and volatility; practice difficulty adapts. Local has no rating model.
- **D011 (P0, MISSING) — No whole-line practice mode.** The setting "Practice: Individual moves / Whole lines" exists in the UI but is never read. `cb_practice_mode` is only localStorage.
- **D012 (P0, MISSING) — No "complete lines once per session" / "every time" review styles.** Real has `Complete lines (once per session)`, `Complete lines (every time)` and `Entire line`.
- **D013 (P1, MISSING) — Review modes missing.** Real: all due, difficult due, next common moves, all moves, specific, early, resume, common moves. Local: due, weak, all, specific only.
- **D014 (P1, MISSING) — No "resume where you left off".** Exiting practice loses the session; real offers resume and save-progress.
- **D015 (P1, MISSING) — No "early" review.** Real lets you review before due; local only has an "all" mode that is broken.
- **D016 (P1, MISSING) — No "next common moves" mode.** Real practices positions likely to appear at the user's level.
- **D017 (P1, MISSING) — No "common moves" opponent model.** Real uses incidence by rating; local seeds random ECO lines.
- **D018 (P1, MISSING) — No per-move notes.** Real practice shows e.g. "Breaking in the center, the main line of the Classical Sicilian" or "No notes added"; local has no notes field or display.
- **D019 (P1, MISSING) — Hint is wrong.** Real says "I don't know, give me a hint" and can reveal a hint/notes. Local says "show me the answer" and immediately plays the SAN.
- **D020 (P1, MISSING) — No Stockfish refutation on a wrong move.** Real computes a refutation and can explain the mistake. Local only flashes red and says "Not quite."
- **D021 (P0, BROKEN) — The API trusts the client's SAN.** `POST /practice/attempt` compares strings; it never verifies that the played move is legal from the line FEN or that the line/ply belongs to the user. A crafted request can mark any line correct.
- **D022 (P1, MISSING) — No move-level review upload/history.** Real posts `moves_reviewed` per move. Local only logs a row in `attempts`, with no EPD/ply/daily flag, and no UI history.
- **D023 (P1, BROKEN) — "View in build mode" loses the position.** `PracticePage.tsx:372` navigates to `/build/:key?line=:id`, but `BuildPage` only reads `?path` and never uses `selectedId` for the board (`BuildPage.tsx:99`). It always opens the start position.
- **D024 (P1, MISSING) — No skip/keep/changed-my-mind actions.** Real has "I don't know, skip this one", "skip this step", "Keep this position for future review", "I've changed my mind, start over".
- **D025 (P1, MISSING) — No alternate-response flow.** Real: "You have multiple saved moves for this position", "You have another response. Play it on the board." Local has one expected SAN per line.
- **D026 (P1, BROKEN) — No session start position control.** Practice always uses `line.fen` (before the last move). Real starts at the first due move, which can be anywhere in the line.
- **D027 (P1, MISSING) — No daily goal progress.** `getDailyGoal()` exists but no screen, API, or session uses it. Real tracks daily practice completion and streaks.
- **D028 (P1, BROKEN) — Streak calculation is wrong.** `server/api.js:181-196` only counts if the newest attempt is *today* and then walks backwards; a streak ending yesterday becomes 0, and `highestStreak`/`lastStreakDate` do not exist. Real account has `currentStreak`, `highestStreak`, `lastStreakDate`.
- **D029 (P1, MISSING) — No mistake queue from online games.** Real `get_lichess_mistakes` and game review feed practice. Local's "weak" is local attempt counts only.
- **D030 (P2, DIVERGENT) — Correct move shows a toast.** Real feedback is on the board/score; local adds `toast("Correct — Nf3")`. This is a clone addition, not production UI.
- **D031 (P2, DIVERGENT) — Extra practice footer.** Local shows `4% complete / 34% mastered` at the bottom of practice; the real practice screen does not.
- **D032 (P2, BROKEN) — Board only supports click-to-move.** Production supports drag-and-drop, and board interactions in model games; local board is click-only, always promotes to queen.
- **D033 (P2, MISSING) — No arrows/highlights/plans on the practice board.** Real uses arrows for plans, hints, and refutations.
- **D034 (P1, MISSING) — No "play a training game from here".** Real practice/build expose "Play a training game from here"; local has no bot at all.

## B. Repertoire builder

- **D035 (P0, BROKEN) — Root move list is not the real candidate list.** It only groups already-saved lines, so a repertoire with one saved `e4` line shows exactly one candidate (`e4`). Real shows `e4`, `d4`, `Nf3`, `c4`, `b3`, `g3` (and more) with stats.
- **D036 (P0, MOCK) — "Masters" is local mastery, not master-game percentage.** `candidate.mastery` is rendered in the Masters column (`BuildPage.tsx:401`). Real 48% means the move was played in 48% of master games; local 31% is the line's mastery.
- **D037 (P0, MOCK) — Engine eval is fabricated.** `evalFor()` returns fixed values for a few SANs and a hash for the rest (`BuildPage.tsx:65-71`). Real engine eval comes from Stockfish/position report.
- **D038 (P0, MOCK) — Peer results are fabricated.** `peersFor()` hashes the SAN (`BuildPage.tsx:73-76`). Real "Peer results" are win rates at the user's rating band.
- **D039 (P1, MISSING) — No real incidence/play-rate data.** Real shows "How often do players at your level play this move?" and "1 in 3 games". Local has no incidence field.
- **D040 (P1, MISSING) — No per-position annotations/plans.** Real builder/gap shows a note for each candidate. Local has a 20-entry `NOTES` map by SAN and falls back to the opening name.
- **D041 (P1, BROKEN) — "Add an alternative move" opens an alphabetical database dump.** `GET /api/openings?prefix=...` with an empty path has no `prefix`, so it returns all openings sorted by ECO/name (`Amar Opening`, `Anderssen's Opening`, ...). Real expands the ranked candidate list inline.
- **D042 (P1, DIVERGENT) — Modal vs inline candidate list.** Real "Add an alternative move" opens an inline list of candidates with Masters/Eval/Peers. Local opens a full modal with search and PGN import tabs.
- **D043 (P1, BROKEN) — Search prefix filter is redundant/ineffective.** `filteredOpenings` re-filters client-side on `path.every(...)`; the API already filtered, and when `path` is empty the result is the full alphabetical list.
- **D044 (P1, MOCK) — Autofill adds no moves.** `POST /repertoires/:key/autofill` only sets `learned=1, mastered>=15, due_at=-1` on up to six existing lines (`server/api.js:341-354`). Real autofill selects optimal moves and inserts them.
- **D045 (P1, MISSING) — No style-based autofill.** Real: "Autofill moves in this style", style points (aggressive, solid, learnable, etc.), "Pick a style, undo anytime".
- **D046 (P1, MISSING) — No "Autofill all moves from here".** Only a global six-line flag flip.
- **D047 (P1, MISSING) — No "Autofill this gap".** The gap button calls the global autofill and can mark unrelated lines.
- **D048 (P1, MISSING) — No "Exclude specific moves" / "Choose a move to prepare for" flow.** Real lists opponent moves with `Expected in`/`Completion` and lets you exclude them. Local has no exclusion state.
- **D049 (P1, MISSING) — No "Go to the next gap in this line".** Local gap always selects the single lowest-mastery line.
- **D050 (P1, MOCK) — "Plans" button is a toast.** `BuildPage.tsx:339` shows "Plans are covered in the model games section." Real opens plans/model games for the position.
- **D051 (P1, MISSING) — No "Add / edit notes" editor.** Real has a note editor per move/position, saved to the backend.
- **D052 (P1, BROKEN) — Disable is destructive and not reversible as a branch operation.** `disableBranch` patches every line to `learned:false, mastered:0, saved:false, dueAt:null`; real disables the move and all moves after it, with "Re-enable" and a clear undo path.
- **D053 (P1, BROKEN) — Remove uses sequential confirms and no batch API.** `removeBranch` loops `DELETE /lines/:id`; real has `delete_move`/`trim` APIs and handles dependencies.
- **D054 (P0, BROKEN) — Adding an opening stores the whole opening as one flat line.** It does not create a branch tree or intermediate positions; subsequent practice cannot walk the branch. Real stores moves per position.
- **D055 (P0, BROKEN) — Newly added moves are not "Saved".** `POST /lines` inserts `saved=0` (`server/api.js:424`), so the `7 Saved` counter does not increase after adding a move. Verified: adding Barnes Defense left `saved:0`.
- **D056 (P1, BROKEN) — Newly added moves are immediately due.** The insert sets `due_at=-1`, so adding a line immediately increases the due count, even though it has never been taught. Real first practice is a separate flow (`skip_first_practice`, first practice).
- **D057 (P1, BROKEN) — `total_lines` is hard-coded to 50.** Every repertoire has a denominator of 50 (`server/db.js:31`), so completion/mastery cannot reflect the actual move set.
- **D058 (P1, BROKEN) — Completion/mastery formulas are not the real metrics.** `completion = learned/50`, `mastery = count(mastered>=80)/50` (`server/api.js:29-52`). Real coverage/mastery are computed from position reports and SRS.
- **D059 (P1, BROKEN) — Effectiveness/Soundness/Learnability/Total are arithmetic fakes.** `RepertoirePage.tsx` renders `learned`, `mastery`, `100-mastery`, and `learned+mastered+saved` against `totalLines*3`. Real values come from `characteristics` (`effectiveness`, `soundness`, `learnability`, `avgCpLoss`, `expectedResults`, `sharpness`).
- **D060 (P1, BROKEN) — `?line=` is ignored by the builder.** The selected line is computed but never used for the board path or highlight.
- **D061 (P1, MISSING) — No repertoire list/rename/delete/clone.** There is no `/repertoires` screen; `PATCH` exists but no delete or clone endpoint. Real supports rename, delete, overview, chapters.
- **D062 (P1, MISSING) — No chapters/sections or course structure.** Real models chapters/sections and pre-made courses.
- **D063 (P1, MISSING) — No PGN file import.** Only a textarea paste; no `.pgn` file upload, no Lichess study import, no course import.
- **D064 (P1, MISSING) — No export.** Real exports all saved moves / PGN. Local has no export endpoint or UI.
- **D065 (P1, MISSING) — No transposition handling.** Real merges/transposes by EPD; local compares move strings and duplicates lines.
- **D066 (P1, MISSING) — No coverage goal / trim tools.** Real has "Trim moves past your goal", "Trim rare lines below your coverage goal", "Trim sideline transpositions", "Remove autofilled moves". Local has none.
- **D067 (P2, DIVERGENT) — Builder footer has no move navigation.** Real lets you click moves/back-forward in the line; local only shows a static breadcrumb-like move list.
- **D068 (P2, DIVERGENT) — Breadcrumb is wrong.** Local uses `White openings > Build`; real builder breadcrumb shows completion context (`White openings > Build > 4% complete` in the gap screen). Not identical.
- **D069 (P1, MISSING) — No "Build from here" / "Practice from here" actions.** Real exposes both from a position; local only "Go to your biggest gap".
- **D070 (P1, MISSING) — No "Add a note to explain this move" prompt.** Part of the notes system.

## C. Gap finder

- **D071 (P0, BROKEN) — Wrong "biggest gap" algorithm.** `GET /repertoires/:key/gap` sorts all lines by `mastered ASC, learned ASC` and takes the first (`server/api.js:286-290`). Real uses `biggestMiss` weighted by incidence and position report. In local, the gap for White is a deep Scandinavian line, not `1.e4/1.d4` coverage.
- **D072 (P0, BROKEN) — Candidate moves are alphabetical ECO junk.** For Black after `1.e4`, local returns `f6`, `g5`, `h6`, `f5`, `h5`, `Nh6`, `Na6` because it orders by `eco, name` (`server/api.js:302-305`). Real returns `c5`, `e5`, `e6`, `c6`, `d5`, `d6`, ... by incidence.
- **D073 (P1, BROKEN) — Table labels are lies.** "Masters" renders `candidate.mastery`; "Eval" renders `evalFor()` (hash); "Peer results" renders hash bars (`GapPage.tsx:214-240`).
- **D074 (P1, MISSING) — No move descriptions.** Real gap rows include explanatory notes ("The most natural move, developing the Knight with tempo."). Local renders only a line-count/add action.
- **D075 (P1, BROKEN) — `Show more` does not paginate.** Live local gap showed the same set after clicking; the handler is not implemented (the label may be a static button). Real reveals more candidates.
- **D076 (P1, BROKEN) — "Autofill this gap" hits the global autofill.** `GapPage.tsx:110-124` calls `/autofill`, which marks up to six unrelated unlearned lines.
- **D077 (P1, BROKEN) — "Open in build mode" loses the position.** `navigate('/build/:key')` without a path. Real opens the exact gap position.
- **D078 (P1, BROKEN) — "Practice this line" practices the terminal move only.** `navigate('/practice/:key?line=:id')` then the old single-move engine.
- **D079 (P1, BROKEN) — Heading move/side is wrong.** For a prefix ending with Black's move, local says `Choose a response to 5… Nbd7` but the next move is White's `6.`; the `moveNumber` formula is off (`server/api.js:318`, `GapPage.tsx:82-84`).
- **D080 (P1, MISSING) — No "Add / edit notes" or "Exclude moves" actions.** Real gap has both.
- **D081 (P1, MISSING) — No coverage/completion context per opponent move.** Real shows `Expected in` and `Completion`; local shows mastery only.
- **D082 (P2, DIVERGENT) — Extra sections.** Local adds "Repertoire health" and "More"; real gap sidebar does not have them.

## D. Learn screen

- **D083 (P1, BROKEN) — "All moves" count is 50, not 7.** Local `repertoire.lineCount` is 50 because the seed creates 50 flat openings; real count is 7 saved moves/positions. The label is also semantically wrong: real counts saved moves.
- **D084 (P1, BROKEN) — "Just the moves I often get wrong" count is bogus.** It counts lines with any wrong attempt (4) and includes unattempted lines in the queue.
- **D085 (P1, MISSING) — No difficult-due mode.** Real separates "Everything that's due" from "Just the moves I often get wrong" (difficulty).
- **D086 (P1, MISSING) — No "next common moves" option.** Real practices likely opponent moves.
- **D087 (P1, MISSING) — No early review option.** Real "early" review while lines are not due.
- **D088 (P1, MISSING) — No resume card.** Real shows "Where you left off" / resume.
- **D089 (P1, BROKEN) — Specific-opening modal lists all 50 lines, including unsaved/unlearned.** Real lists saved openings with mastery.
- **D090 (P1, MISSING) — No card/FSRS review screen.** Real has cards, review difficulty, expected wrongs, etc.
- **D091 (P1, MISSING) — No daily practice summary.** Real shows daily goal/progress, reviews completed, streak.
- **D092 (P2, DIVERGENT) — Mastery formatting differs.** Local `34%`; real `34.0%`.
- **D093 (P2, BROKEN) — Empty-due state is unreachable from the route.** The button is disabled at 0 due, but direct `/practice` still starts a review of a non-due line.

## E. Model games

- **D094 (P0, MOCK) — There is only one model game.** `server/db.js` seeds a single row; real has a daily game plus a history (weeks of games).
- **D095 (P0, BROKEN) — The seeded game is the wrong game.** Local: Kamsky–Anand, Dortmund 1992, `1/2-1/2`, 10 moves, "model Caro-Kann". Real: Kamsky–Anand, Candidats FIDE sf1, Kamsky won in 45 moves, Sicilian Accelerated Dragon.
- **D096 (P1, MISSING) — No daily model-game selection.** Real calls `daily_model_game` with `force_new_game`; local always returns `ORDER BY id LIMIT 1`.
- **D097 (P1, BROKEN) — "Choose another random game" is not random.** It cycles to the next row and toasts "Only one model game is loaded" when there is one.
- **D098 (P1, MISSING) — "View previous model games" does nothing but stop playback.** Real opens a history screen grouped by week/opening.
- **D099 (P1, BROKEN) — Board is not interactive.** Copy says "Move the pieces on the board to guess the move"; `Board` is rendered without `interactive`/`onMove` (`ModelPage.tsx:112-119`).
- **D100 (P1, MOCK) — "Give me a hint" leaks the next SAN in a toast.** Real hints use notes/plans and can be partial; local simply reveals the answer.
- **D101 (P1, MOCK) — Eval graph is a hard-coded flat +0.3 line.** `ModelPage.tsx:145-160`; no eval samples, no source, no Stockfish.
- **D102 (P1, MISSING) — No game review.** Real reviews the game/mistakes with Stockfish and stores `model_game_reviewed`.
- **D103 (P1, BROKEN) — Progress is unvalidated.** `POST /model-games/:id/progress` accepts any ply, without clamping to the PGN; no completion/reviewed state.
- **D104 (P1, MISSING) — "Model games source" setting has no effect.** Real switches online vs master games.
- **D105 (P1, MISSING) — No link to the matching opening/plan.** Real says "This game matches your saved moves in the Sicilian Defense: ...".
- **D106 (P1, MISSING) — No player ratings, annotations or game link.** Real shows "Kamsky (2695) vs Anand (2720)" and the event; local only names/event/year.

## F. Dashboard

- **D107 (P2, INTENTIONAL/acceptable) — Dashboard is gated behind `localStorage.cb_entered`.** A fresh browser at `/` sees the marketing page, not the dashboard; production's logged-in `/` is the dashboard. Keep the landing page if desired, but document that `/` is not the app root on first visit.
- **D108 (P1, MISSING) — No daily reviews list.** Real `fetchHome_v2` returns `dailyReviews`; local dashboard has only aggregate tasks.
- **D109 (P1, MISSING) — No openings report.** Real calls `/api/v2/openings_report` and renders weak/worst openings. Local rows are static "Not connected".
- **D110 (P2, MOCK, optional) — "Connect account" is a dead row.** It navigates to Settings and the report rows only toast. External OAuth is out of scope, so either remove these rows or replace the feature with local PGN import; do not leave a fake connection flow.
- **D111 (P1, MISSING/optional) — No online-game review path.** `connected:false` is hard-coded and there is no Lichess/Chess.com import. If external accounts stay out of scope, the equivalent must be local PGN import (and the UI copy changed), or the "Review your online games" section should be removed.
- **D112 (P1, MISSING) — No "Go to the biggest gap" task.** Real surface promotes it; local only links from the builder.
- **D113 (P1, MISSING) — No "Improve learnability" task.** Real home has this action.
- **D114 (P2, DIVERGENT) — Feedback/share links are local toasts.** Real "Share your feedback" opens a survey; "Help us spread the word" opens a share flow. Local copies `https://chessbook.com` to the clipboard.
- **D115 (P1, BROKEN) — Model-game row uses the wrong game.** It shows Kamsky vs Anand but the underlying game is the wrong event/result/length.
- **D116 (P1, MISSING) — No app promo/native banner/notification prompts.** Real home has app promotion and notification settings.
- **D117 (P1, MISSING) — No account/streak panel.** No current/highest streak, last streak date, or daily goal.
- **D118 (P1, MISSING) — No repertoire list/creation flow parity.** Only two seeded rows; no `/repertoires` page, no delete/rename.
- **D119 (P2, DIVERGENT) — Dashboard has no Back affordance.** Real shows a Back control; local relies on the browser.

## G. Openings, data and content

- **D120 (P0, MISSING) — No per-EPD supplementary opening data.** Real `/api/v1/openings/supplementary` returns EPD-keyed `fullName`/`friendlyName` for thousands of positions. Local only has one name per ECO line.
- **D121 (P1, MISSING) — No incidence/play-rate by rating.** Real reports "1 in 3 games" etc.; local has no such data.
- **D122 (P1, MISSING) — No master/peer/engine result statistics.** Local has no masters DB, no peer DB, no Stockfish service.
- **D123 (P1, MISSING) — No per-position annotations/plans/notes.** Real `fetchPositionReportAndAnnotations` returns `annotations` and `reports` with courses, characteristics and move notes.
- **D124 (P1, MISSING) — No pre-made/official repertoires.** Real `courses` include Hanging Pawns' Spanish, QGD, Caro-Kann etc., with authors, move counts, coverage and descriptions. Local has none.
- **D125 (P1, MISSING) — No opening guides.** Real `/openings` has guides (Italian, QGD, English, Ruy Lopez, London, ...) with two-move diagrams, notes and plans. Local `/openings` redirects to `/add`.
- **D126 (P1, MISSING) — No slug/detail pages.** Real `/openings/:slug`; local has no opening detail route.
- **D127 (P1, MISSING) — No transpositions or aliases.** Local matches FEN/move strings only; real tracks transpositions and friendly names.
- **D128 (P1, MISSING) — No coverage per opening.** Real computes coverage from position reports; local completion is `learned/50`.
- **D129 (P1, MISSING) — No weak/worst openings report.** Real `/api/v2/openings_report`; local none.
- **D130 (P1, MISSING) — No FEN/position search.** Local search is name/ECO LIKE only.
- **D131 (P1, MISSING) — No coaches, blog or help routes.** Real `/coaches`, `/coaches/:slug`, `/coaches/apply`, `/coaches/review`, `/blog`, `/blog/:slug`; local none.
- **D132 (P1, MISSING) — No pre-made repertoire catalogue.** Real `/openings` "Pre-made repertoires" section; local none.
- **D133 (P2, MISSING) — No QR/app-store page.** Real `/qr` redirects to the Play Store listing.

## H. Settings and review/board preferences

- **D134 (P1, MISSING) — Rating opens a sheet in real, cycles a string locally.** Real "Your rating" has Platform (Chess.com/Lichess/FIDE/USCF) and Time control (Bullet/Blitz/Rapid/Classical). Local cycles `RATINGS` in localStorage.
- **D135 (P1, BROKEN) — Rating/coverage are not sent to the backend.** `cb_rating`/`cb_cover` are localStorage only; they never affect candidate stats, incidence or gaps. Real `eloRange`/`ratingSystem` drive opponent-move probabilities.
- **D136 (P1, MISSING) — Coverage goal has no effect.** `cb_cover` is never read by the API/UI.
- **D137 (P2, MOCK, optional) — External account rows are fake.** Local renders `Lichess ✕ Chess.com ✕` and only toasts. Real uses OAuth. Because auth is out of scope, either remove these rows or replace the feature with local PGN import for game review; do not leave a fake connection UI.
- **D138 (P1, MOCK) — Model games source row is a no-op.** `onClick={() => {}}`.
- **D139 (P1, MOCK) — Early access features row is a no-op.** `onClick={() => {}}`.
- **D140 (P1, BROKEN) — "Practice: Whole lines" is a no-op.** Stored in localStorage, never read by the practice engine.
- **D141 (P1, BROKEN) — Daily practice goal is not used.** `dailyGoal` is persisted but no daily counter or completion logic exists.
- **D142 (P1, BROKEN) — Pause-after-move is not applied.** `cb_pause` is stored but practice never pauses.
- **D143 (P1, MISSING) — Appearance is only three themes.** Real supports multiple board appearances (`Chessbook`, `Lichess brown`, others), piece sets, and separate board/piece settings. Local has green/blue/brown only.
- **D144 (P1, MISSING) — Piece set is fixed.** Real user has `pieceSet:"chessbook_monochrome"` and can change it; local hard-codes `/pieces/chessbook_monochrome`.
- **D145 (P1, BROKEN) — Piece animation setting is unused.** `cb_animation` only cycles a label; the Board always animates for 180 ms.
- **D146 (P1, MISSING) — Playback speed is missing.** Real has playback speed for visualization/puzzles; local none.
- **D147 (P1, MISSING) — Hidden moves / number of hidden moves is missing.** Real visualization setting.
- **D148 (P1, MISSING) — Sound effects has no volume/sub-options.** Bool only; real has sound effects category and more granular controls.
- **D149 (P1, BROKEN) — Haptics is a no-op.** `cb_haptics` is stored; no vibration calls exist.
- **D150 (P1, MISSING) — Recommended moves size is missing.** Real `frontendSettings.recommendedMovesSize`.
- **D151 (P2, DIVERGENT) — Subscription row is a dead toast and should be deleted.** Desired product has no subscription UI; remove the "Upgrade to add unlimited moves" row rather than implementing Stripe.
- **D152 (P2, INTENTIONAL) — No delete account/log out.** Correct: account surfaces are out of scope. Do not add them.
- **D153 (P1, BROKEN) — Reset all learning does not clear attempts.** It sets `learned=0, mastered=0, saved=0, due_at=NULL` but leaves `attempts`, so the "wrong moves" queue still has data afterwards.
- **D154 (P2, DIVERGENT) — "Reset board preferences" is an extra row.** Acceptable after account rows are removed, but it is not in the production settings list; the row set should be normalised.
- **D155 (P2, DIVERGENT) — Settings use inline cycling instead of sheets.** Real opens dedicated panels/modals for rating, coverage, appearance, review style, etc.
- **D156 (P1, MISSING) — No review style settings.** Real: cards vs complete lines, "pause on fail", "pause on low score", "when there's a note", "when you get it wrong", hidden moves.
- **D157 (P1, MISSING) — No notification settings.** Real notification channels/mistake notifications.

## I. Missing screens / routes

- **D158 (P0, MISSING) — `/training-games`.** Real page: play a human-like bot, rating, 3+2 time control, side, "Moves at your level", post-game coach review. Local none.
- **D159 (P1, MISSING) — `/blunder-puzzles`.** Real Blunderbash with rating, pause behavior, board appearance, playback speed.
- **D160 (P1, MISSING) — `/intuition-builder`.** Real style-rating training.
- **D161 (P1, MISSING) — `/visualization`.** Real hidden-move visualization training with difficulty.
- **D162 (P1, MISSING) — `/vision`.** Real board-vision drills (undefended pieces/pawns, backward/hanging/overloaded pawns, checks).
- **D163 (P1, MISSING) — `/openings` guide index and `/openings/:slug`.**
- **D164 (P1, MISSING) — `/coaches`, `/coaches/:slug`, `/coaches/apply`, `/coaches/review`.**
- **D165 (P1, MISSING) — `/blog`, `/blog/:slug`.**
- **D166 (P1, MISSING) — `/repertoires` list and slug URLs.** Local uses `/repertoire/:key` and `/build/:key`, not production's `/repertoires/:slug`.
- **D167 (P1, MISSING) — Onboarding/welcome flow.** Real: "Set up your Chessbook", rating, style, "Let's add your first move", "You've added your first moves!", "Now let's fill in the gaps".
- **D168 (P2, INTENTIONAL) — Account/subscription/upgrade screens must stay absent.** Ensure no residual `PRO` pill, plan text, upgrade row, lock icon, or paywall remains. Premium capabilities themselves still need to exist (see L).
- **D169 (P1, MISSING) — Help/wiki links in-app.** Real links to `wiki.chessbook.com`; local only an external link for repertoire stats.
- **D170 (P2, DIVERGENT) — Custom 404 page.** Local has a styled "Page not found" card; real redirects unknown routes home.
- **D171 (P2, MISSING) — Mobile-specific compositions.** Production mobile is not a reflow; it has a dedicated clipped-board layout and captures under `m/`. Local is a CSS reflow (see J).

## J. UI / visual fidelity

- **D172 (P1, DIVERGENT) — Practice rows are too tall.** Local "I don't know..." / "View in build mode" / "Exit practice" rows have more vertical padding than production, pushing content down.
- **D173 (P1, DIVERGENT) — Missing notes line.** Real has a dedicated position-note line (`No notes added` / note text); local has no row, so the prompt block is shorter and the layout does not match.
- **D174 (P2, DIVERGENT) — Prompt glyph differs.** Real uses a full-width `＿`; local renders `__`.
- **D175 (P2, DIVERGENT) — Practice footer reports global repertoire progress, not session progress.** It shows `4% complete / 34% mastered` even while a specific line is being drilled, which is meaningless inside a practice session.
- **D176 (P2, DIVERGENT) — Toast feedback is a clone addition.** Correct/wrong toasts do not exist in production.
- **D177 (P2, DIVERGENT) — Board feedback is a clone addition.** Selected square ring, legal-move dots, green/red pulse are not production visuals.
- **D178 (P2, DIVERGENT) — Piece rendering is slightly off.** Local pieces look larger/higher-contrast; production pieces have a softer shadow/scale.
- **D179 (P2, DIVERGENT) — Board highlight colours differ.** Real highlights the opponent's reply/target squares; local only highlights the last move.
- **D180 (P1, DIVERGENT) — Builder candidate columns are compressed/misaligned.** Local renders `48% +0.3` in a tiny row with unlabeled bars; real has two-line Masters/Peers percentages and clear columns.
- **D181 (P1, DIVERGENT) — The add-line modal has no position context or ranking.** Its list is a generic database search with ECO codes; it does not show the candidates for the current position, their stats, or their notes.
- **D182 (P1, DIVERGENT) — Gap breadcrumb.** Local says `White openings > Build > Fill gap`; real shows completion (`White openings > Build > 4% complete`).
- **D183 (P2, DIVERGENT) — Gap sidebar has redundant navigation.** "Open in build mode", "Back to the builder", and "Open the practice queue" duplicate paths already available in the header/back button, adding noise the real gap screen does not have.
- **D184 (P2, DIVERGENT) — Settings rows hide their available options.** Cycling gives no checkmarks, sheet, or list of choices, so users cannot discover what values exist and cannot jump directly to one.
- **D185 (P1, DIVERGENT) — Model eval graph is a flat line with a fabricated +0.3.** Real graph is a filled win-probability/eval area chart.
- **D186 (P0, DIVERGENT) — Mobile board is full-size.** Real mobile crops the board to a two-rank peek at the top, dimmed behind the content; local shows a full 8×8 board taking most of the viewport (verified 390×844).
- **D187 (P1, DIVERGENT) — Mobile sidebar is not the production composition.** Real mobile uses a full-width page sheet beneath the clipped board; local still renders the desktop board+sidebar stack.
- **D188 (P2, DIVERGENT) — Mobile stats bars are missing.** Real repertoire stats use segmented bars (Effectiveness/Soundness/Learnability/Total); local uses generic progress rows.
- **D189 (P2, DIVERGENT) — Mobile top bar differs.** Real mobile has Back/Settings in a dedicated top bar; local shows a breadcrumb and a Settings link inside the sidebar.
- **D190 (P2, DIVERGENT) — Mobile board coordinates appear on the edge.** Production’s clipped mobile board does not show local coordinates in the same way.
- **D191 (P2, MISSING) — No board arrows/plan overlays.** Real builder/plans/gap screens use arrows; local none.
- **D192 (P2, DIVERGENT) — Loading states differ.** Local uses a full-screen spinner (`Splash`); production uses inline skeletons/shimmers.
- **D193 (P2, DIVERGENT) — Local landing nav is incomplete.** Production logged-out landing has Pre-made repertoires/Openings/Coaches/Blog/Help; the captured local body only has `Open app`, and all pricing CTAs are `href="#"`.
- **D194 (P2, DIVERGENT) — Accessibility/keyboard parity.** Real board supports drag; local click-only; no keyboard move entry, no focus management beyond buttons.
- **D195 (P2, DIVERGENT) — No hover/drag cursors on pieces.** Local pieces are `<img>` inside buttons; production board uses a piece layer with drag semantics.

## K. Backend, data integrity and architecture

- **D196 (P1, MISSING) — The local profile is a stub for the non-account fields the trainer needs.** Real user state includes `eloRange`, `singleElo`, `ratingRange`, `ratingSystem`, `pieceSet`, `theme`, `flags`, `frontendSettings`, `currentStreak`, `highestStreak`, `lastStreakDate`, `trainingRating`, `trainingRatingDeviation`, `trainingRatingVolatility`, `missThreshold`. Local has id/email/name/plan. Account-only fields (`stripeCustomerId`, `subscribed`, `subscriptionSource`, `betaAccess`, `lichessToken`, etc.) are intentionally out of scope and must not be cloned.
- **D197 (P1, BROKEN) — Settings are split between SQLite and localStorage.** Board theme/sound/coordinates/legal moves/goal are backend; rating/coverage/pause/animation/haptics/practice mode are localStorage; some are never read. There is no single source of truth.
- **D198 (P1, BROKEN) — No migrations.** `db.js` runs `CREATE TABLE IF NOT EXISTS` only; schema changes will not upgrade an existing `chessbook.db`.
- **D199 (P1, BROKEN) — Openings are imported once.** `loadOpenings()` returns if any rows exist; there is no versioning or incremental update.
- **D200 (P1, MISSING) — No APIs for the missing features.** No notes/annotations/plans, reports, courses, import/export, delete repertoire, training games, puzzles, or notifications endpoints.
- **D201 (P1, MISSING) — No WebSocket layer.** Real uses `/api/ws` with a ticket for live training/game updates; local has no socket.
- **D202 (P1, MISSING) — No bot/Oxi integration.** Real training games play a human-like bot with rating/time control; local none.
- **D203 (P1, MISSING) — No Stockfish.** Real has a bundled `stockfish` asset for evals/refutations; local has no engine.
- **D204 (P1, MISSING) — No FSRS/review-log tables.** No stability/difficulty/lapses; no `moves_reviewed` equivalent.
- **D205 (P1, BROKEN) — `practice/attempt` has no idempotency/submission ID.** Real accepts a `submission_id`; local can double-submit.
- **D206 (P2, BROKEN) — Date handling is brittle.** ISO strings are compared lexicographically and seeded via JS; no timezone/date normalization. `due_at` can be compared incorrectly if formats differ.
- **D207 (P2, BROKEN) — Model progress has no completed/reviewed state.** Progress is only a ply number; there is no "reviewed" flag, score, or completion screen, so reopening a finished game looks identical to a fresh one.
- **D208 (P1, MISSING) — No delete repertoire API.** Only `PATCH`; the app cannot delete a repertoire.
- **D209 (P1, MISSING) — No PGN/import/export APIs.** Only `POST /lines` with an openingId or pasted PGN.
- **D210 (P2, MISSING) — No error boundary.** A render error in a page blanks the app; only per-page `catch` blocks.
- **D211 (P2, BROKEN) — Offline writes fail without feedback.** PWA caches reads but `POST/PATCH` silently fail offline; no queue.
- **D212 (P2, BROKEN) — README overclaims the product.** It claims spaced repetition, real model games, stats, autofill and "what works" that are mocked/incomplete. This is misleading documentation.

## L. Premium-gated feature availability (with no subscriptions, accounts or paywalls)

- **D213 (P0, MISSING) — "Premium" capabilities are absent, not unlocked.** The desired product has no subscription and every premium feature available to everyone. Today the *features themselves* (training games, puzzles, courses, reports, export, full model history) simply do not exist. Removing the paywall is only half the job; the capabilities must be built.
- **D214 (P2, INTENTIONAL) — No free-plan 200-move limit.** Correct. Do not add a limit or an upgrade path.
- **D215 (P2, INTENTIONAL) — No checkout/billing/subscription management.** Correct. Delete the dead "Upgrade to add unlimited moves" row; do not add Stripe.
- **D216 (P1, MISSING) — The premium feature set is missing.** Official courses, full model-game history, opening reports, PGN export, training games, puzzles, and advanced review modes are not available in any form.
- **D217 (P2, INTENTIONAL) — No PRO/Free badges, locks, paywalls, or plan pills.** Correct; verify no residual entitlement chrome remains in the shell.

## M. Testing and process quality

- **D218 (P0, MISSING) — No automated tests.** No unit, API, or E2E tests in the repo; `package.json` has no `test` script.
- **D219 (P1, MISSING) — No API contract tests.** The local API is untyped at runtime; the frontend can drift from the backend.
- **D220 (P1, MISSING) — No main-flow E2E.** No test that starts practice, answers multiple moves, verifies opponent replies, and verifies scheduling.
- **D221 (P1, MISSING) — No data-integrity checks.** No validation that lines are legal PGN, that `fen` matches `moves`, or that due counts equal queue size.
- **D222 (P2, BROKEN) — Multiple duplicated fetches.** React StrictMode causes `/me`, `/settings`, and page endpoints to be called twice; harmless but noisy, and some pages reload after every action.
- **D223 (P2, BROKEN) — Seed data is artificial.** `seedRepertoireLines` picks openings by a pseudo-random `(id * 1103515245 + 12345) % 997` formula, producing a meaningless repertoire (Scandinavian deep lines as "biggest gap", obscure openings).
- **D224 (P2, BROKEN) — `db.js` seeds stats that don't correspond to real review state.** `learned`, `mastered`, `saved`, and `due_at` are assigned per line by index; attempts are seeded with `"e4"` as the played move for four lines. This makes the dashboard look right while the data is not derivable from any training history.
- **D225 (P2, DIVERGENT) — No production analytics/feedback link parity.** Not required for a local clone, but the dashboard copy points at production services that do not exist locally.

---

## How to reproduce the headline failures

```bash
# 1. Start the clone
npm run dev

# 2. Due mode returns a line even when nothing is due (black repertoire)
curl -s 'http://localhost:8787/api/practice/next?repertoire=black&mode=due' | jq
# => { line: {...}, remaining: 0, complete: false }

# 3. Gap for Black after 1.e4 returns alphabetical ECO junk
curl -s 'http://localhost:8787/api/repertoires/black/gap' | jq '.candidates[].san'
# => "f6", "g5", "h6", "f5", "h5", "Nh6", "Na6", ...

# 4. Add a line; Saved does not increment
curl -s -X POST http://localhost:8787/api/repertoires/black/lines \
  -H 'Content-Type: application/json' -d '{"openingId":824}' | jq '.line.saved, .repertoire.saved'
# => false, 0

# 5. UI comparison captures
open audit/compare-dashboard.png
open audit/local/03-practice.png
open recon/live5/01-start.png
```

The Playwright evidence scripts are in `audit/local-test.mjs`, `audit/local-mobile.mjs`, `recon/live-flow.mjs`, `recon/live-practice.mjs`, `recon/live-play.mjs`, `recon/live-play2.mjs`, and `recon/live-other.mjs`. Captured screenshots are in `audit/local/`, `audit/local-mobile/`, `recon/live2/`, `recon/live3/`, `recon/live4/`, `recon/live5/`, and `recon/live6/`.

---

## Prioritised remediation plan

### Phase 0 — stop the lying (1–2 days)
1. Replace the fake stats with either real data or explicit "unavailable" states. Delete `evalFor()`, `peersFor()`, the `NOTES` fallback, and the arithmetic `Effectiveness/Soundness/Learnability` values.
2. Fix `practiceNext`: `due` must return `complete:true` when nothing is due; `all` must decrement/terminate; `weak` must require an actual wrong attempt.
3. Fix wrong-answer handling in `PracticePage`: never decrement `remaining`, never switch `nextLine`, never advance on incorrect.
4. Mark newly added lines `saved=1`, make completion denominators dynamic, and fix the reset endpoint to clear attempts.
5. Make `?line=` in Build open the correct position and make practice "View in build mode" pass the current path.
6. Remove the dead subscription row and any residual account/premium marks; do not replace them with new account UI.

### Phase 1 — make the core trainer real (3–5 days)
1. Add a `line_moves`/`reviews` schema (`line_id`, `ply`, `epd`, `san`, `side`, `due_at`, `stability`, `difficulty`, `lapses`, `reps`).
2. Seed/populate it from every saved line; enforce server-side legality.
3. Practice walks the line move-by-move: user moves are quizzed, opponent moves auto-play. This is the single most important fix (D001/D002/D003).
4. Add notes per position and display "No notes added"/note text.
5. Add hint/skip/keep/resume semantics and session persistence.
6. Wire FSRS (or a faithful spaced-repetition implementation) and per-move review uploads.
7. Add whole-line vs individual-move modes and pause behavior.

### Phase 2 — restore the real data model (1–2 weeks)
1. Ingest position reports: ECO/supplementary names, incidence by rating, master/peer stats, engine eval, annotations, plans, courses.
2. Replace builder/gap candidate rows with real report data.
3. Add per-position annotations and plans; add the note editor.
4. Add coverage, weak/worst openings reports, trim/autofill/exclude tooling.
5. Add official/pre-made repertoire import and Lichess study/PGN import/export.

### Phase 3 — screens and premium features, without account/subscription noise (2–3 weeks)
1. Implement missing routes: `/training-games`, `/blunder-puzzles`, `/intuition-builder`, `/visualization`, `/vision`, `/openings`, `/coaches`, `/blog`, `/repertoires`.
2. Delete every account/subscription/premium-mark surface: the PRO pill, `plan` display, "Upgrade to add unlimited moves", dead subscription toast, and any fake connect-account rows. Do **not** add onboarding/account/billing/paywall screens.
3. Build the feature set that used to be premium so it is available to everyone: training games, puzzles, courses, reports, export, full model-game history.
4. Add the bot/Stockfish/WebSocket services needed by training games, game review and refutations.
5. Add model-game daily/history/review and an interactive guess-the-move board.
6. Match the mobile composition (clipped board + sheet) rather than a reflow.

### Phase 4 — fidelity and hardening
1. Convert practice/build/gap/settings to the exact production DOM structure and row heights; remove clone-only toasts/pulses or gate them behind a "clone feedback" setting.
2. Add API contract tests, main-flow E2E, data-integrity checks and migrations.
3. Add error boundaries, offline write handling, keyboard/drag board support.

---

## Handoff notes for the next agent

- **Do not add** login/signup, profile/account management, subscription/billing, free-plan limits, PRO badges, lock icons, paywalls, or "upgrade" rows. Delete the dead "Upgrade to add unlimited moves" row.
- **Do build** the capabilities that were premium-gated so they are available to everyone: training games, puzzles, courses, reports, export, full model-game history.
- **Priority order:** core practice loop → honest data/statistics → gap/builder correctness → model games → missing screens → UI/mobile fidelity.
- **Do not trust the existing stats or seed data.** `server/db.js` assigns `learned/mastered/saved/due_at` by index and seeds `"e4"` as a wrong attempt; `BuildPage`/`GapPage` hash SANs for eval/peers. Replace, don't preserve.
- Captured production data that can be used immediately:
  - `recon/daily-game-full.json` — the real daily model game: 45 moves (`sans`), 90 FENs (`epds`), 90 eval samples (`evals`), players/ratings, event, result, performances.
  - `recon/model-history-full.json` — the real model-game history entry (Stein–Myagmarsuren, Sousse Interzonal, 85 plies).
  - `recon/live2/`, `recon/live3/`, `recon/live5/` — screenshots/JSON of the real dashboard, repertoire, build, gap, learn, practice, settings, model, add, connect, openings.
  - `recon/live5/01-start.png` + `recon/live5/02-after-Nf3.png` + `recon/live5/03-after-d4.png` — the move-by-move practice evidence.
  - `recon/prod-js/` — the production JS bundles containing the real feature strings, routes and API names.
- The live account is a real account; do not run destructive actions against it (delete repertoire, reset learning, submit many reviews) while re-testing. Read-only navigation and a single practice line are enough.
- `AUDIT.md` intentionally separates **intentional exclusions** from **unintended divergences**. Keep that distinction in the fix PRs.

---

## Acceptance tests for "main feature works"

- [ ] From a fresh seed, entering practice at `1.e4 c5` asks `2.＿`; answering `Nf3` auto-plays `Nc6` and asks `3.＿`, with the line `1.e4 c5 2.Nf3 Nc6` visible.
- [ ] A wrong legal move keeps the counter at `N Due`, shows refutation/retry, and does not change the line.
- [ ] Answering all due moves eventually reaches a real "Review complete" state and `Due` goes to 0.
- [ ] Reloading mid-session resumes at the same position.
- [ ] `View in build mode` opens the exact current position, not the start.
- [ ] Adding a move increments `Saved`, does not create an unrelated due line, and appears in the builder tree.
- [ ] The gap screen for Black after `1.e4` lists `c5`, `e5`, `e6`, `c6`, `d5`, ... ordered by incidence, with `Expected in` values.
- [ ] The model-game board accepts a guess, hides the answer, and records pass/fail; the game is 45 moves and the correct event/result.
- [ ] Mobile 390×844 shows the clipped two-rank board and full-width sheet, not a full board.
