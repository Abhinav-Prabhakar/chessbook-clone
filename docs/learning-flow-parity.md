# How production Chessbook teaches openings, and where we differ

_Research notes, 24 Oct 2026. **Status: implemented** (see section 5 for what was built and the few remaining differences)._

## Sources

| Source | What it shows |
|---|---|
| `recon/live4`, `recon/live5` (run logs + screenshots) | Two real practice sessions on the reference account: what is on screen before/after each move, a wrong move (5.Nc3), the Due counter. |
| `recon/live*/network.json` | Calls made during practice, including `moves_reviewed` responses. |
| `recon/prod-js/SidebarTemplate-*.js` | The production client. The review state (queue building, give-up ladder, wrong-move handling, reporting), the practice view, the practice menu, the session-complete view and the setting definitions are all in this bundle. |

Confidence: behaviour below is read from the client code and cross-checked with the captures where possible. Anything only inferred is marked **(inferred)**. The SRS maths runs on the server and is not in the bundle.

---

## 1. Production's model

### 1.1 The unit of practice: a "quiz group"

- A quiz group is **one position where you have saved move(s) for your side**, plus the line (moves from the start) that leads to it.
- If you have several saved moves in that position, **you must play all of them**. After the first, the board steps back and the prompt says you have another response to play.
- Opponent moves are never quizzed; they are only played on the board.

### 1.2 Building the queue

- The repertoire is walked **depth-first from the start position**, or from a chosen position/line for "specific opening" or "practice from here".
- At each opponent turn, the opponent's replies are visited in an order **weighted by how common they are, with randomness**. Common replies tend to come first, but not always, so sessions don't repeat in the same order.
- Each of your positions is added as a quiz group if it matches the chosen filter:

| Filter | Includes a position when |
|---|---|
| `due` ("Everything that's due for review") | any saved move there is due |
| `daily` / `recommended` ("Daily practice" / "Recommended moves") | due, then trimmed to a batch the size of the **Daily practice goal** setting (10 / 20 / 50, default 10) |
| `difficult-due` ("Just the moves I often get wrong") | due **and** difficult |
| `difficult` (same label, shown when nothing is due) | difficult |
| `early` ("Moves that will be due soon") | not due; earliest due first, limited to the batch size |
| `all` ("All moves, even if they're not due") | every position |
| specific line | the positions along one chosen line |

- **"Due" is decided by calendar day**: a move is due if its due date is today or earlier, **or it has never been practised** (`firstReview`), or it has no due date. **New moves are therefore part of "due"** and of the Due count. There is no separate "learn new moves" queue.
- **"Difficult"** means the move's difficulty (0–1, from the server) is above 0.6.

### 1.3 Walking a session

- For each quiz group the board **plays the line from the start, animated**, up to the position, then waits for your move.
- In the "complete lines" review styles, consecutive groups on the same line are stitched together, so the line continues instead of restarting (see 1.8).

### 1.4 First practice (new moves)

A move that has never been practised (`firstReview`) is in **first practice** ("learning"):

- **Shown immediately:** an arrow for each saved move, the move's notation, and its note (if any).
- **No "I don't know" button.** Instead there's a secondary **"Skip first practice"** row. Its confirmation says it turns first-practice mode off for all moves.
- Playing the arrow move **does not add to the "correct" counter**.
- **The result of this first pass is what gets reported to the server.** The move then has `firstReview = false`, and locally its due date is pushed about 5 days ahead until the server responds.
- **A recall comes right after the current line finishes**, not at the end of the session. After the group, an unscored copy without the arrow is inserted into the queue just before the next shallower line starts. This recall is reinforcement only and is **not reported**.
- **The prompt changes:**
  - "Play your first move on the board" at the start position.
  - "You have N saved moves for this position. Play them all on the board" for a new position with several moves.
  - Otherwise, "Play the correct move on the board".

### 1.5 Reviewing a move you already know

- **At the start**, the prompt shows the move number with a blank (`3. ＿`). The move's note exists but is **hidden** until you ask for a hint: the captured screenshot shows no note while the text is in the page.
- **The "I don't know" ladder.** Stages are Start → Hints → Arrows → Full.
  - When the move has a note, the button reads "I don't know, give me a hint". Pressing it reveals the note (Hints stage).
  - Otherwise, or after the hint, it reads "I don't know, show me the answer". Pressing it shows the arrow and the notation (Arrows stage).
  - Giving up at any stage marks the move incorrect for this session.
- **A correct move** gets a check badge on the destination square.
  - If more saved moves remain, the board steps back and asks for the next one.
  - When the group is done, it either pauses or moves on, depending on **"Pause after playing a move"**.
  - The pause choices are Never (default), Always, When you get it wrong, and When there's a note.
  - A pause shows "This is your saved move." (or a "multiple saved moves" line), the note, and a "Got it, continue practicing" button.
- **A move that isn't in your repertoire:**
  1. A small "thinking" ring appears on the square while a shallow Stockfish search scores the position before and after the move, as winning chances for the side to move.
  2. If you lose **less than 6%** (a good move or an inaccuracy), it's an **"alternative"**. It gets its own feedback badge and isn't counted as a miss (with an exception for moves that lead somewhere outside your repertoire **(inferred)**). Then it's taken back.
  3. **6–9%** is labelled an inaccuracy, **9–20%** a mistake, and **more than 20%** a blunder. Mistakes and blunders mark the move incorrect. **The engine's best reply is played on the board as the refutation**, then both moves are taken back.
  4. **After 3 wrong guesses** in the same group, the arrows appear automatically.
- **Back** during practice returns to the previous quiz group. "View in build mode" opens the current line in the builder.

### 1.6 Scoring and reporting

- **Counters:**
  - "N Due" (remaining moves) with a clock.
  - Correct: one per correctly recalled move that isn't in first practice.
  - Incorrect: one per group that had any failure.
- **Reported once per group, when the group ends**, never for retries. The call is `POST /api/v1/openings/moves_reviewed` with `{ submissionId, date, results: [{ side, epd, sanPlus, correct, daily }] }`. `correct` is false if anything went wrong in the group (wrong move or giving up). `daily` is true for daily-practice sessions.
- **The server answers each move's new schedule**: `{ needsReview, dueAt, firstReview, difficulty (0–1), interval (days) }`. Captured intervals after a correct answer were 11, 17 and 134 days.
- **Failed groups** get an unscored retry copy at the end of the queue, stitched onto the line.

### 1.7 Mastery

- Per move, mastery comes from the **interval**: `log(min(interval, 100) + 1) / log(101)` gives 0–100%.
- The labels are: interval ≤ 1 day "new", ≤ 15 days "learning", < 100 days "solid", otherwise "mastered".
- The repertoire's "x.x% mastered" is shown with one decimal place.

### 1.8 Review styles (setting "Practice")

| Value | Label | Behaviour |
|---|---|---|
| Selective (default) | Individual moves | Only the selected (e.g. due) positions are quizzed. |
| Entire line - every time | Complete lines (every time) | The other positions of yours along each line are added as unscored "synthetic" groups, so the whole line is played every time. |
| Entire line | Complete lines (once per session) | Same, but a synthetic position already seen in this session is not asked again. |

### 1.9 The practice menu ("What do you want to practice?")

Rows appear depending on state, in this order:

1. "Continue your practice session" (resume), if a session was paused.
2. "Daily practice" / "Recommended moves", only when more moves are due than the batch size. It is the filled row in that case.
3. "Everything that's due for review" with the due count.
4. "Just the moves I often get wrong", if any due moves are difficult.
5. If **nothing is due**: "Moves that will be due soon" (early), then "Just the moves I often get wrong" (difficult, not due).
6. "All moves, even if they're not due", only if there are more moves than due ones.
7. "A specific opening…": choose a repertoire, then go to a position or line and practice from there.

A mastery bar (one decimal place) sits above the rows.

### 1.10 End of session

- **Header:** "Daily practice complete!", "Review complete!", "Perfect practice!" (all correct) or "Practice complete!".
- **Body:** a mastery bar, then a "Your stats from this session" (or "today") list:
  - how many moves you practised;
  - either "you got all your moves right" or "you played the correct move N times";
  - then one of: your new streak; how many moves are still due; or when the next practice is due.
- **Streak:** finishing a session counts the day toward the streak.
- **Bonus move** (behind a feature flag): when the last position has no saved continuation, Stockfish plays a bonus move for you to answer. Optional.

### 1.11 Out of scope

- Plans quizzes (tap the square where a piece usually goes, or which side to castle).
- Reviewing mistakes from online games (needs Lichess / Chess.com accounts).
- Admin-only difficulty prediction views.

---

## 2. Where our implementation differs

| Area | Production | Ours today | Change needed |
|---|---|---|---|
| Unit | Position group; all saved moves must be played | One asked ply per move; alternatives accepted instead of required | Group by position; require every saved move; "You have another response" step |
| New moves | Count as due; in the Due count and the normal queue | Separate "new" bucket, capped by "New moves per session"; "Everything that's due" adds up to N new | Treat never-practised moves as due; drop or hide the cap (production has none) |
| What schedules a new move | The first-practice pass is reported; the recall is unscored | The first pass is unscored ("learn"); the recall at the end of the session sets the grade | Report the first pass; make the recall an unscored repeat |
| When the recall happens | Right after the current line ends | At the end of the session | Insert the repeat before the next shallower line |
| First-practice UI | Arrow + notation + note, no give-up button, "Skip first practice" | Arrow + notation + note + "NEW" tag; no skip option | Add "Skip first practice" (global); remove the tag if production has none |
| Notes when reviewing | Hidden until "give me a hint" | Shown only after a hint (close), but our first hint highlights the piece instead | Hint ladder: note (if any) → arrows → answer |
| Give-up ladder | Hint → arrows; marks incorrect | 1st press highlights the piece, 2nd shows an arrow | Match the stages and labels |
| Wrong move | Stockfish judges it; good moves are "alternatives"; bad ones get the refutation played; arrows after 3 misses | Every non-repertoire move is wrong; shown red and taken back; piece highlight after 2 misses | Engine judging, alternative feedback, refutation reply, arrows after 3 |
| Feedback on the board | Badge on the destination square (correct, alternative, inaccuracy, mistake, blunder, thinking ring) | Square tints | Add square badges |
| After a correct move | Moves on, or pauses per "Pause after playing a move" | Always moves on; the setting means opponent reply delay | Rework the setting to Never / Always / When wrong / When there's a note, with a "Got it, continue practicing" pause |
| Queue order | DFS from the start, opponent replies weighted by incidence with randomness | Alphabetical DFS by move text | Order by incidence with randomness |
| Line playback | Line played from the start, animated, per group | Jumps straight to the first asked position | Animate the line from the start (stitched for consecutive groups) |
| Due granularity | Calendar day | Exact timestamp | Compare dates by day |
| Difficult | Difficulty > 0.6 (0–1) | Lapses ≥ 1 or FSRS difficulty ≥ 7 (1–10) | Map to the same threshold |
| Daily / recommended batch | Batch = Daily practice goal (10/20/50); shown only when due > batch | No batch mode; daily goal is a progress bar | Add "Daily practice" / "Recommended moves" |
| Early review | "Moves that will be due soon", only when nothing is due | Always listed | Show only when nothing is due |
| Review styles | Individual / Complete lines every time / once per session, with unscored synthetic groups | "Whole lines" toggle asks and grades every move | Three styles; synthetic groups unscored; per-session dedupe |
| Reporting | Once per group at group end; idempotent; server returns new SRS | Once per move, at answer time | Report at group end with the same shape |
| Scheduling | Server SRS; difficulty 0–1; intervals like 11/17/134 days | Local FSRS-4.5; first Good ≈ 3.7 days | Keep local FSRS (server code isn't visible); expose a 0–1 difficulty and an interval, and check first intervals against the captures |
| Mastery | Log of interval (0–100%), labels new / learning / solid / mastered | Binary: stability ≥ 21 days | Use the interval-based percentage and labels |
| Counters | Due = remaining; correct excludes first practice; incorrect once per group | Similar, but counts per move | Count incorrect per group |
| Practice menu | Dynamic rows (see 1.9) | Fixed five rows plus "Learn new moves" | Match the conditional rows; remove "Learn new moves" |
| Resume | "Continue your practice session" | Leaving loses the session | Persist the paused session |
| Back in practice | Returns to the previous group | Leaves practice | Step back one group |
| End screen | Header variants + stats list + streak / next due | "Session complete" + three tiles | Match headers and stats list |
| Bonus move | Feature-flagged | None | Optional |

## 3. Suggested order of work

1. **Data model for groups:** queue of position groups (all saved moves), incidence-weighted randomized DFS, day-based due, new moves counted as due.
2. **First practice semantics:** report the first pass; unscored repeat after the line ends; "Skip first practice".
3. **Wrong-move judging:** Stockfish before/after win chances with the 6 / 9 / 20% thresholds; alternatives; refutation reply; arrows after 3 misses; square feedback badges.
4. **Give-up ladder and pause setting:** note → arrows → answer; "Pause after playing a move" with "Got it, continue practicing".
5. **Reporting and mastery:** one report per group; 0–1 difficulty; interval-based mastery and labels; difficult = > 0.6.
6. **Review styles:** Individual / Complete lines every time / once per session.
7. **Menu, resume and end screen:** conditional rows, Daily / Recommended batch, resume, previous-group back, end-of-session summary.
8. **Tests:** extend `tests/api.test.js` and `tests/e2e/practice-flow.mjs` for each of the above (e.g. a non-repertoire good move is accepted as an alternative; a blunder shows the refutation; the first pass schedules the move).

## 4. Open questions

- **Server SRS:** production's scheduler isn't visible. A bundle tooltip mentions FSRS reviews, so FSRS is likely, but the parameters are unknown. Proposal: keep our FSRS and calibrate the first intervals.
- **Alternatives outside the repertoire:** the exact rule for when an "alternative" still counts as a miss isn't clear from the code **(inferred)**. Proposal: an alternative never counts as a miss, and the line continues with the saved move.
- **Hidden note:** confirm visually how production hides the note before a hint (blur vs. not rendered). The behaviour is the same either way.

---

## 5. Implementation status

Implemented in `server/core/practice.js`, `server/core/judge.js` and `app/src/pages/PracticePage.tsx` / `LearnPage.tsx`, covered by `tests/api.test.js` (19 tests) and `tests/e2e/practice-flow.mjs` (24 checks).

| Item | Status |
|---|---|
| Position groups; every saved move must be played; "You have another response" | Done |
| Depth-first queue, opponent replies ordered by incidence with randomness | Done |
| Calendar-day due; never-practised moves are due | Done |
| Filters: due, daily, recommended (batch = Daily practice goal), difficult-due, difficult, early, all, line | Done |
| First practice: arrows + notation + note, no give-up, "Skip first practice" (global setting) | Done |
| First pass is reported; unscored repeat inserted where the current line ends | Done |
| Hint ladder: note → arrows; giving up marks the move incorrect | Done |
| Engine judging (6 / 9 / 20% thresholds), alternatives, refutation reply, arrows after 3 misses | Done |
| Feedback badges on the destination square (correct, alternative, inaccuracy, mistake, blunder, thinking) | Done |
| "Pause after playing a move" (Never / Always / When you get it wrong / When there's a note) + "Got it, continue practicing" | Done |
| One report per group, idempotent; server returns dueAt, firstReview, 0–1 difficulty, interval, mastery | Done |
| Difficult = difficulty > 0.6; mastery = log(interval + 1)/log(101), averaged per repertoire | Done |
| Review styles: Individual moves / Complete lines (every time) / Complete lines (once per session) | Done |
| Failed groups re-queued at the end, unscored | Done |
| Back to the previous position; resume a paused session | Done |
| Conditional practice menu; end-of-session summary with production's headers and stats | Done |

Remaining differences:

- **Scheduling maths:** still our local FSRS (production's server scheduler isn't visible). A first correct answer gives about 4 days.
- **Repeat placement:** for the first group in the remaining queue, the repeat compares against the group just finished. Production's code skips that case, which can push the repeat one line later. Ours follows the stated intent ("after the current line ends").
- **Not built:** the feature-flagged bonus move at the end of a session, and plans quizzes.
