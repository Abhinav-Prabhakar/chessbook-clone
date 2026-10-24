# Project status

_Last updated 24 Oct 2026._

This file is the honest state of the app: what was wrong, what was rebuilt, what works now, and what is still missing.
`AUDIT.md` is the earlier audit of the previous version and is kept for history; most of its findings no longer apply because the code it describes was replaced.

---

## 1. What was wrong with the previous version

The previous build passed its own checklist (`AUDIT_PROGRESS.md` claimed every audit item was closed), but using it as a chess player showed it did not work as an opening trainer:

| Problem | What you saw |
|---|---|
| **The repertoire made no chess sense** | The seeded White repertoire played 1.e4, 1.d4, 1.c4, 1.Nf3 *and* 1.h4; both 2.Nf3 and 2.Nc3 against the Sicilian; both the Italian and the Ruy Lopez. Practice said "You have 6 saved moves in this position. Any of them is accepted" at move 1. |
| **New moves could never be learned** | 125 of 126 moves were "new", yet "Everything that's due" said 0 due. There was no way to learn a new move from the main path. |
| **"Biggest gap" was a deep sideline** | Black's biggest gap was a Grünfeld position at move 7 "seen in 1 in 1 games", while Black had no answer to 1.e4 or 1.d4. It only looked at the last move's probability, not how often a position is actually reached. It took ~4 s. |
| **Builder semantics were wrong** | On White's own first move it said "Choose a move to prepare for" and "Expected in 1 in 2 games" (those apply to the opponent's moves). |
| **Thin, old data** | Peer statistics came from 5,122 positions of Lichess games from January–March 2013. Puzzles were 25 positions derived from two games. Model games were two captured games. |
| **Developer text on screen** | "No description available for this move in the capture", "The reference capture contained an empty report", "Local file only — no account, no OAuth", "Game link: No public game link was captured", "Engine review: No engine review is bundled with this build". |
| **Page transitions** | Every navigation remounted the whole page (the error boundary was keyed by URL), faded the screen in from black, and showed an empty board while loading. Pieces never animated between positions. |
| **Clutter** | Practice showed a review card (difficulty, expected wrong, seen, last grade) and nine action rows; builder showed style tabs, coverage panels, sections and explanatory copy that the real app does not have. |
| **Odd scheduling display** | "Rated Good · next in 3.714 days". |

## 2. What was done

The core was rebuilt rather than patched. Old code is in git history.

**Server (`server/core/`)**
- New schema: a repertoire is a graph of saved moves keyed by position, so transpositions share review state. The old database is replaced on first start (a backup of the previous database was made at `~/.cache/chessbook-data/backup/`).
- **Coverage & gaps** (`coverage.js`): walks your repertoire from the start; at your turn follows your move, at your opponent's turn branches into every reply weighted by how often players *at your rating* play it, until a line is rarer than your coverage goal. Completion = share of games that don't run into a gap. The biggest gap is the position you'll reach most often with no prepared move. ~1–30 ms per request.
- **Practice** (`practice.js`): sessions are lines walked from the start. Opponent moves (and your already-known moves) auto-play; new moves are taught with an arrow, then asked again from memory at the end of the session; that recall is what schedules the move (FSRS). Wrong moves never advance or reschedule twice; submissions are idempotent; only your own moves can be reviewed.
- **Autofill**: adds the moves masters play most (or the best-scoring popular move at your level), one gap at a time, up to your coverage goal.
- **Model games**: real master games matched to the deepest positions of your repertoire; daily game, random game, history, guess-the-move progress.
- **Puzzles**: Lichess puzzles from the openings in your repertoires, with a puzzle rating.
- **Training games**: a bot that plays real human moves for its rating in the opening (sampled from the Lichess data) and Stockfish with rating-scaled mistakes afterwards; tells you when the game leaves your repertoire and why.
- **Opening guides**: 103 named openings; any guide becomes a ready-made repertoire (guide moves + master autofill).
- PGN import with variations (paste or file), PGN export, notes per move and per position, rename/delete, reset progress.

**Data (all bundled, ~16 MB, built by scripts in `server/tools/`)**

| Dataset | Source | Size |
|---|---|---|
| Peer statistics by rating band | Lichess open database, Sept 2026, 3.2 M rated blitz/rapid/classical games | 35,633 positions |
| Master statistics | 434,258 games by 250 players, PGN Mentor archives | 77,425 positions |
| Model games | 45,000 complete strong games (both players 2500+, or classic-era greats) | 7 MB |
| Puzzles | Lichess puzzle database, popular puzzles that arise by move 22, tagged by opening | 39,030 puzzles |
| Opening names | Lichess chess-openings | 3,865 lines |
| Move explanations | Written for this app (`server/data/move-notes.json`) | 79 common moves |
| Engine | Stockfish 19 (WASM, local), cached per position | — |

**Frontend (`app/src/`)**
- One persistent board rendered by the app shell. Pages control it through `useBoard()`; breadcrumbs and the move strip render into fixed slots. Pieces keep their identity between positions, so moves, auto-replies, jumping back through a line and switching pages all slide pieces instead of redrawing.
- Only the sidebar content animates on navigation; data loads show the previous screen's data or small skeletons, never a blank board.
- Screens rebuilt to the real app's minimal layout: dashboard, repertoire, builder (your move / their replies), learn, practice, model games, puzzles, training games, opening guides, settings, new repertoire, history, how-it-works.
- Phone layout: board on top (two-rank peek on pages that don't use it), sheet below.
- All developer-facing copy removed.

## 2b. UI parity pass (compared against the production captures in `recon/`)

- **Page transitions** now work like production's sidebar stack: the old view fades out while sliding 20 px (160 ms), then the new one fades in from 20 px on the other side (160 ms). Going deeper enters from the right, going back from the left; each builder move counts as a step. Breadcrumbs persist and only new crumbs slide in. Implemented in `SidebarViews` (`app/src/shell/AppShell.tsx`) by snapshotting the outgoing view, so pages don't have to stay mounted.
- **Settings** is a flat list (label left, value right) with "Review settings" and "Board settings" groups. Every row opens its own page in the sidebar instead of a modal. "Your rating" has the big number, a slider with ticks, ‹ › steppers, and Platform / Time control rows (time control now feeds the rating conversion).
- **Repertoire page** in production order: % complete → Continue building → % mastered (orange) → Continue learning.
- **Learn page**: production wording, orange mastery bar, one filled row and a list, and a working "A specific opening…" page.
- **Builder**: compact saved-move rows, "Peer results" column, alternatives expand inline, "Show more", filled "Go to your biggest gap" row.
- **Practice**: "N Due" counter with filled orange clock, green check and red x badges.
- **Model games**: eval graph (Stockfish, computed in the background and cached), "Play next move" / "Give me a hint" buttons, production-style description; history page grouped by week with the opening of each game.
- **Add new repertoire**: checkmark color list, light name field, full-width "Create repertoire" row.
- List rows everywhere use production's style: transparent with dividers; only the main action on a page is a filled row.

Known differences that remain:
- Builder has no "Disable" action (only Remove).
- No "Stats" block (Effectiveness / Soundness / Learnability) on the repertoire page; the app doesn't compute those metrics.
- No swipe-back gesture on touch screens, and going back re-renders the previous page instead of restoring a cached copy.
- A wrong move is marked by a red square instead of production's small badge on the square.
- Account-related rows and sections (connected accounts, subscription, log out, online-game review, early access, haptics) are intentionally absent.

## 3. How it was verified

- `npm test` — 15 API tests on a throwaway database: starter repertoire is coherent (≤1 White move per position), builder statistics, reply ordering, gap ordering for Black (1.e4 then 1.d4), completion goes up/down with saves/removals, autofill, practice line walking (the open Sicilian asks e4, Nf3, d4, Nxd4), learning vs recall scheduling, idempotent submissions, opponent moves not reviewable, PGN variations, settings validation, puzzles, a bot game. All pass.
- `npm run build && npm run test:e2e` — real Chrome on a throwaway database: learns 10 new moves with arrows and auto-replies, makes a deliberate mistake during recall (shown, taken back, counters unchanged), completes the session, checks the dashboard, saves a move by playing it in the builder, checks the phone layout, no console errors. It also checks the forward and back transitions. 15/15 checks pass. Screenshots in `tests/e2e/output/`.
- Manual run in the browser of every screen at 1440×900 and 375×812.

## 4. Known limits and what's not done

Be aware of these:

- **Coverage depth.** Peer statistics include positions reached by at least 40 games in the sample (depth ≤ 20 plies). Beyond that a line counts as "covered" because there is no data. With the default goal (1 in 100 games) this rarely matters; at 1 in 500 some deep lines stop early.
- **Masters data is a player-archive sample**, not every master game ever played: 434k games from 250 strong players. Percentages are close to, but not the same as, the real Chessbook "Masters" column.
- **Move explanations exist for 79 common moves.** Elsewhere a move shows no explanation (the line is simply omitted). You can add your own notes.
- **Training games are untimed.** No clocks.
- **No account, sync, Lichess/Chess.com game import or notifications.** Intentionally local. PGN import is the way to bring in your own games or studies.
- **Pre-made courses by named authors and coach/blog pages are not included.** The captured courses had only marketing text and no moves, and the coach pages were real people's profiles. Opening guides → "Start a repertoire" replace courses.
- **The Intuition and Vision drills from the old version were removed and not rebuilt.** They were built on the old data layer that was replaced. Visualization was rebuilt around your own repertoire.
- **The landing page** (`/welcome`) is the captured chessbook.com marketing page and is shown once, before entering the app. Its links to blog/coaches lead into the app.
- **First start** imports the bundled data (~10 s) and then loads master games in the background (~1 min); model games say "still being prepared" until that finishes.
- **Rating conversion** (Chess.com/FIDE → Lichess) is an approximation used only to pick the rating band.
- **The repository root** still contains the earlier static HTML capture (`index.html`, `m/`, `_build/`, …) and `recon/`/`audit/` evidence from the first build. They are not used by the app.

## 5. Refreshing the data

```bash
npm run data:lichess   # ~1.8 GB streamed, ~20 min, then aggregated
npm run data:masters   # ~200 MB of PGN Mentor archives
npm run data:puzzles   # ~300 MB streamed
```

Downloads are cached in `~/.cache/chessbook-data/`, never in the repository. The app re-imports a dataset automatically when its file changes.
