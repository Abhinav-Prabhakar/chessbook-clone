# Batch 2 — practice UI, Learn screen and board

Owner: `practice-ui`
Scope: `app/src/pages/PracticePage.tsx`, `app/src/pages/LearnPage.tsx`,
`app/src/components/Board.tsx`, `app/src/types.ts`, `app/src/chess.ts`.
No other source file, server file, stylesheet or `package.json` was modified.
Nothing was committed.

Status: **implemented and verified**. The old single-move flow is gone; practice
is now driven by the real per-position session API (start at the task FEN, play
the saved move, auto-play the opponent reply, ask the next position).

---

## What changed

### PracticePage — real per-position session loop

- Replaced `GET /practice/next` + `POST /practice/attempt` with
  `POST /practice/sessions` and `POST /practice/sessions/:id/attempt`.
- The board is rendered at `task.fen`; the prompt shows the real task move
  number/side. On a correct answer the response's next task is applied
  immediately, so the opponent's auto-played reply appears on the board and in
  the line before the next prompt (verified `1.e4 c5` → `2.＿`).
- The board footer lists every move played so far from `task.prefix` (never
  `fullMoves`, so future line moves are not spoiled), highlights the latest
  auto-reply, and shows the current prompt glyph.
- Wrong answer:
  - the played move is briefly shown with a red refutation arrow, then the
    board resets to the **same** `task.fen`;
  - the notice explains the move was not saved, the task/EPD, session
    `remaining`, `stats.due` and the next task are unchanged (server contract);
  - the wrong counter increments, but the Due counter does not.
- Illegal/server errors: the API `error` text is shown, the board is reset to
  the same position, and a `session_complete` 409 refreshes the session.
- Session idempotency: every attempt carries `epd`, a fresh `submissionId`, a
  `tzOffset` and `hint` when an assist was used.
- Session actions are wired to the real endpoints:
  - hint ("I don't know, give me a hint") reveals the saved position/move note
    or a piece/origin hint and an orange origin highlight — it never reveals or
    submits the answer;
  - "I don't know, show me the answer" reveals the SAN and a hint arrow, but the
    user still has to play it (attempts are graded Hard via `hint:true`);
  - skip, keep for future review, start over (reset), pause/exit.
- `GET /practice/sessions?status=all` + `GET .../:id/current` restore the most
  recent active **or paused** session; `?session=<id>` resumes directly and
  shows "Resumed where you left off" without a false banner on freshly created
  sessions (StrictMode double-effect guarded).
- Multiple saved moves at a position show "You have N saved moves … any of them
  is accepted"; a played alternate produces "Accepted alternate Nc6".
- Daily goal (`GET /practice/daily?tzOffset=…`, then the attempt response's
  `daily`) is shown as reviews/goal + streak both during and after a session.
- Session end state distinguishes "Session complete" from "Nothing is due" and
  offers practice again / all moves / early review / Learn / repertoire. The
  extra global completion/mastery footer and all toasts were removed.
- "View in build mode" now sends both the current path and line:
  `/build/:key?path=<prefix SANs>&line=<lineId>` (D023).
- No "play a training game" link is rendered because no `/training-games` route
  exists (D034).

### LearnPage — real counts and modes

- Uses `GET /repertoires/:key/learn`'s real `due`, `weak`, `all` counts and
  repertoire move/position stats instead of `lineCount`.
  - Due: `repertoire.due` (moves);
  - mistakes: `data.weak` (real latest-incorrect reviews only);
  - all moves: `repertoire.moveCount` (saved user moves, not the old 50 seeds);
  - early: `repertoire.learned` scheduled moves;
  - specific: only `saved` lines.
- Modes: due, weak/mistakes, all, early, specific opening, and resume. The
  server has no "next common moves" mode, so that row is deliberately absent
  rather than faked (D016/D086).
- `cb_practice_mode` is read: "Whole lines" expands due/weak sessions into a
  `specific` session over the lines containing those positions (complete once
  per session), and the current style is shown with a link to Settings.
- Resume card appears when a non-complete session exists (active or paused),
  and links to `/practice/:key?session=<id>`.
- Daily goal/reviews/streak progress and a real review-state block (fresh,
  learned, mastered, due positions) replace the old static data.
- Mastery and per-opening mastery render with one decimal (`0.0%`, `34.0%`).
- The specific-opening modal lists only saved lines and their real move lists.
- Empty-due state is reachable both from Learn ("Nothing is due right now") and
  directly at `/practice/:key?mode=due`.
- Board preview shows the first queued position without revealing its move.

### Board — input, accessibility and overlays

- Drag-and-drop added while keeping click-to-move; both use the same
  legality-checked `tryMove` path and still expose `square-*`/`piece-*` test ids.
- Promotion picker (queen first/default, rook/bishop/knight available), with
  Escape/backdrop cancel and keyboard activation.
- Keyboard support: roving `tabIndex`, arrow-key square navigation (orientation
  aware), Enter/Space activation, Escape clears selection, `aria-pressed` and a
  polite live announcement.
- Cursors: grab/grabbing on own pieces and draggable squares, pointer on legal
  targets.
- New optional `arrows`, `highlights` and `lastMoveTint` props render SVG arrows
  and square tints; Practice uses them for the last auto-reply, hint origin,
  revealed answer and wrong-move refutation.
- `cb_animation` is honoured: `Off` disables the piece transition entirely,
  `Fast` uses 120 ms and `Normal` 240 ms. Verified with a MutationObserver.
- The green/red board pulse (`feedback`) is no longer passed by Practice; wrong
  feedback is a short red arrow/tint, not a clone toast/pulse.

### Types / helpers

- `types.ts`: additive optional repertoire/move stats and full session/task/
  attempt/daily types (`PracticeTask`, `PracticeSession`, `SessionPayload`,
  `AttemptResponse`, `DailySummary`, `TaskAlternative`, `TaskMove`, `Note`).
  Existing fields and imports used by other pages are unchanged.
- `chess.ts`: added `findMove` (SAN → squares) and `sideToMove`.

---

## Endpoints used

| Endpoint | Purpose |
|---|---|
| `POST /practice/sessions` | create a due/weak/all/early/specific session (`lineIds`, `resume`) |
| `GET /practice/sessions?repertoire=&status=all` | discover a resumable session (active or paused) |
| `GET /practice/sessions/:id/current` | load the current task on resume/reload |
| `POST /practice/sessions/:id/resume` | resume a paused session |
| `POST /practice/sessions/:id/pause` | save progress on Exit practice |
| `POST /practice/sessions/:id/skip` | skip this position |
| `POST /practice/sessions/:id/keep` | keep this position for future review |
| `POST /practice/sessions/:id/reset` | "I've changed my mind, start over" |
| `POST /practice/sessions/:id/attempt` | validated per-move answer (`san`, `epd`, `submissionId`, `hint`, `tzOffset`) |
| `GET /practice/daily?tzOffset=` | daily goal / reviews / streak |
| `GET /repertoires/:key/learn` | real due/weak/all queue and counts |
| `GET /repertoires/:key` | saved lines for the specific-opening picker |
| `/build/:key?path=&line=` | navigation only; BuildPage remains owned elsewhere |

The legacy `/practice/next` and `/practice/attempt` calls were removed from the
client. No notes are written by this batch (display only); note editing remains
with the builder owner.

---

## Verification

Environment: final verification ran against a **throwaway database**
(`CHESSBOOK_DB=<tmp>/cb-practice-ui-*.db`, `CHESSBOOK_SKIP_OPENINGS=1`) on an
isolated API port and an isolated Vite port; both processes were stopped after
the run. No server was left running.

- `npx tsc --noEmit -p app/tsconfig.json` → clean.
- `npm run build` → `✓ built` (45 modules).
- `node audit/practice-ui-flow.mjs` with `CB_APP`/`CB_API_PORT` →
  **41 passed, 0 failed**. It exercises:
  - Learn: one-decimal mastery, real move count, empty-due note, daily goal,
    absence of a resume card, saved-only specific list;
  - practice: `1.＿` start, note/"No notes added", alternate indicator, hint
    without the answer + origin highlight, keyboard arrow/Enter move,
    correct advance, auto-reply in the line and on the board;
  - wrong move: retry notice, unchanged Due, unchanged prompt/EPD, refutation
    arrow, board reset;
  - start over, alternate accepted, skip, keep → due count, exit → resume card →
    resumed session;
  - wrong move in a due session keeps Due; correct answer completes it and Due
    drops to 0;
  - whole-line setting expands due practice to `mode=specific&lines=…`;
  - saved note replaces "No notes added"; direct due route shows empty state;
  - drag-and-drop; animation Off suppresses the moving-piece class while Fast
    produces it.
- `node audit/practice-promotion-check.mjs` → **3 passed, 0 failed** on an
  isolated DB: the promotion picker opens on a last-rank pawn move,
  underpromotion (`gxh8=N`) is playable and validated as not saved, and queen
  promotion completes the line.
- Screenshots: `audit/practice-ui-learn.png`, `practice-ui-start.png`,
  `practice-ui-after-reply.png`, `practice-ui-hint.png`,
  `practice-ui-answer.png`.

Environment note: one intermediate exploratory run was pointed at a
concurrently running dev API before isolation and exercised the reset endpoint
on that database. Every result above comes from the isolated run; no source or
committed data files changed.

---

## Residual gaps / deliberate omissions

1. **D016 / D086 — next common moves.** The server has no `next-common` queue
   mode. Not rendered rather than faking a queue.
2. **D012 — "every time"/"entire line".** The server snapshots one queue style;
   "Whole lines" maps to `specific`/`all` and completes each line once per
   session. A true every-time/entire-line replay would need a new server mode.
3. **D020 / D033 — engine refutation and plan arrows.** No Stockfish or plan
   data is bundled. Wrong answers show the server error, a red played-move
   refutation arrow and keep the position; hints highlight the origin square;
   no plan arrow is invented.
4. **D090 — card-by-card review screen.** Learn exposes real FSRS-derived
   fresh/learned/mastered/due counts and per-move scheduling copy, but there is
   no dedicated card UI with difficulty/expected-wrong controls.
5. **D178 piece rendering** (shadow/scale) lives in shared CSS/assets owned by
   the visual-fidelity batch and was not touched here.
6. **D023** relies on BuildPage honouring `?path`; the current builder does, and
   the practice link now supplies it. BuildPage itself is owned elsewhere.
7. **D034** is deliberately omitted: no `/training-games` route exists.

---

## D-ID checklist

- [x] **D001** — practice walks every user move from `POST /practice/sessions` tasks; E2E `1.e4` → `2.＿`.
- [x] **D002** — opponent reply is auto-played and shown (`1.e4 c5`, c5 pawn on board, footer highlight); E2E.
- [x] **D007** — wrong answer keeps the Due counter in both all and due sessions; E2E asserts equal values.
- [x] **D008** — wrong answer keeps the same task/EPD and `remaining`; E2E `current` EPD comparison.
- [x] **D011** — `cb_practice_mode` is read; "Whole lines" expands due/weak to `specific`; E2E URL assertion.
- [~] **D012** — complete-lines-once via `specific`/`all`; every-time/entire-line requires a missing server mode.
- [x] **D013** — Learn offers due, mistakes/weak, all, early, specific and resume (next-common absent, see D016).
- [x] **D014** — resume card + `?session=` restore active/paused sessions; E2E exit→resume.
- [x] **D015** — "Review moves before they're due" starts `mode=early`.
- [ ] **D016** — no server `next-common` mode; omitted rather than faked.
- [x] **D018** — prompt note line shows saved position/move note or "No notes added"; E2E both states.
- [x] **D019** — "I don't know, give me a hint" shows note/piece hint + origin highlight without the answer; E2E glyph stays `＿`.
- [~] **D020** — shows server error + red played-move arrow and retries the same position; no Stockfish refutation available.
- [x] **D023** — "View in build mode" sends `?path=<prefix>&line=<lineId>`, preserving the position.
- [x] **D024** — skip, keep-for-review and start-over call the real session actions; E2E.
- [x] **D025** — multi-saved-move indicator and accepted-alternate feedback; E2E played an alternate.
- [x] **D027** — daily goal/reviews/streak rendered during and after practice and on Learn; E2E after an attempt.
- [x] **D030** — correct/wrong toasts removed from practice.
- [x] **D031** — extra `4% complete / 34% mastered` practice footer removed.
- [x] **D032** — drag-and-drop (E2E) and a queen-default promotion picker with playable underpromotion (E2E picker + `gxh8=N` + `gxh8=Q`); click-to-move preserved.
- [~] **D033** — arrows/highlights for last move, hint and refutation; no plan data to draw plan arrows.
- [x] **D034** — no training-game action added because no training-games route exists.
- [x] **D083** — "All moves" shows `moveCount` (69 saved moves), not 50 seed lines; E2E.
- [x] **D084** — mistakes row uses `data.weak` (real latest-incorrect reviews); unattempted positions excluded server-side.
- [x] **D085** — difficult/mistake practice is the real weak queue, separate from due/all/early.
- [ ] **D086** — next-common row omitted (no server mode).
- [x] **D087** — early review row and `mode=early` wired.
- [x] **D088** — "Where you left off" resume card appears for active/paused sessions; E2E.
- [x] **D089** — specific-opening modal lists only saved lines; E2E row count equals `saved`.
- [~] **D090** — real FSRS review-state counts + scheduling copy; no dedicated card review screen.
- [x] **D091** — daily practice summary (reviews/goal, accuracy, streak) on Learn and practice.
- [x] **D092** — mastery formatting is one decimal (`0.0%`, `34.0%`); E2E regex.
- [x] **D093** — direct `/practice/:key?mode=due` shows "Nothing is due"; E2E.
- [x] **D145** — `cb_animation=Off` suppresses the piece transition, Fast/Normal set duration; MutationObserver E2E.
- [x] **D172** — practice action rows use the production 12px/18px, 45px row rhythm (shared `cb-row`), no extra padding.
- [x] **D173** — dedicated note line ("No notes added" or saved note) under the prompt.
- [x] **D174** — prompt glyph is the full-width `＿`.
- [x] **D175** — practice footer reports session remaining/counters, not global completion/mastery.
- [x] **D176** — no correct/wrong toasts (duplicate of D030).
- [x] **D177** — removed green/red pulse from practice feedback; only a short red arrow/tint for a wrong move.
- [~] **D178** — piece shadow/scale is shared CSS/art; board markup left compatible for the visual batch.
- [x] **D179** — last move/auto-reply uses a production-style blue tint on both squares plus the current move token.
- [x] **D194** — keyboard navigation (arrows/Home/End), Enter/Space, Escape and live announcements; E2E arrow+Enter move.
- [x] **D195** — grab/grabbing cursors on pieces/drag and pointer on legal targets.
