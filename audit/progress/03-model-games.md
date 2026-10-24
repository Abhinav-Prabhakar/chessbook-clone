# Batch 3 — model games (client)

Owner: `model-games`
Code file changed: **`app/src/pages/ModelPage.tsx` only** (no other client,
server, CSS or settings file was touched). Audit artifacts added:
`audit/model-check.mjs`, `audit/model-games-desktop.png`, this report.

Status: **implemented and verified**. Nothing was committed.

---

## What changed

The page was rebuilt around the real captured model-game API from
`audit/progress/01b-server-data.md`. The old mock (`/model-games` first row,
static board, flat `+0.3` line, hint toast) is gone.

### Real collection, daily game and history

- `/model-games?source=<historical|masters|online>` drives the collection. The
  initial game is the server's `dailyGameId` (persisted in
  `model_daily_selection`), falling back to the first captured game.
- The daily game is labelled **Today's model game** in the sidebar header.
- **Choose another random game** calls `/model-games/random?exclude=<id>`; if
  the returned game is outside the current source filter, a random game from
  the filtered list is used instead, so the source setting is respected.
- **View previous model games** opens a real history screen:
  - **By week** uses the server's `weeks[]` groups;
  - **By opening** fetches each game's `openingMatch` and groups by the real
    matched line/guide name (or “No matched opening”).
  - Rows show players, event, result and stored progress; clicking one opens
    that game.
- Empty sources (`online`, `masters`) show an explicit empty state with the
  server's reason instead of a fake game.

### Interactive guess-the-move

- `Board` is rendered with `interactive` and `onMove`.
- The expected SAN is compared to the move actually played from the current
  game position. A correct guess is recorded, advances the board and lets the
  **opponent reply auto-play** after 650 ms. A wrong guess is recorded and
  shown but does **not** advance or reveal the answer; the player can retry,
  take a hint, or reveal.
- The move list hides every future move (one `?` slot) until it is guessed or
  revealed. Played moves are coloured by result (green correct, red missed).
- A **Guess White / Guess Black** tab chooses the side being guessed before the
  first move (or after replay); mid-game switching is disabled so progress is
  not silently discarded. Choosing Black auto-plays White's opening move.
- `POST /model-games/:id/progress` persists the resume ply while playing.
  Reaching the end posts `POST /model-games/:id/review` with the score and the
  server's `reviewed`/`score` state is reloaded on the next visit.
- Per-ply outcomes and hint levels are kept in
  `localStorage["cb_model_session_<gameId>"]`. This is the only per-ply store
  the server does not provide; the server remains authoritative for position
  and review state.

### Hints (no SAN leak)

`Give me a hint` now cycles three real levels:

1. A captured annotation for the move/position when one exists; otherwise a
   partial description (“Knight move into the centre”, “It is a capture”).
2. The origin square is named **and** highlighted on the board (`.cb-highlight`
   via `Board highlights`), still without the destination.
3. `Show me the move` reveals the SAN, marks the move as **revealed** (not
   correct) and plays it plus the opponent reply.

No toast is used to leak the next SAN.

### Evaluation graph

- Replaced the hard-coded flat line with an SVG area chart built from the
  captured `evalSamples` (win-probability-style `tanh` mapping around the
  centre line), with a zero line, a labelled current eval (`+0.3` at the start
  of the daily game) and a playhead at the shown ply.
- Games without samples render an explicit **“No captured evaluation samples
  for this game.”** message (and the Game details row says “Unavailable”).
- After completion the graph is clickable to scrub the game.

### Game detail and completion

- Header: players, event, result, daily marker.
- Players row: full names, ratings (2695 / 2720), captured performance
  (blunders/mistakes/inaccuracies).
- Game rows: event, PGN result tag, game date (explicitly “Not captured” when
  absent), captured date, game link (explicit “Not captured” when null),
  annotation availability, eval-sample availability, engine-review
  availability/reason, review status.
- Position data section shows the current EPD plus ply count.
- Completion/review screen shows the score, correct/answered guesses, hints
  used, Reviewed/Complete pill, **Play again**, and **Review moves** with
  previous/next navigation through the completed game.
- Matching opening: the real `openingMatch.line` links to
  `/build/:color?epd=<position after the matched prefix>` (falls back to
  `?path=`), where the position and its plans live. The captured
  `openingMatch.guide` name/ECO is shown separately.
- `Model games source` reads and displays `settings.modelSource`, opens an
  `OptionSheet`, and saves through `saveSettings({ modelSource })`; the list
  reloads for the new source.

### Production look

The existing shell, `BoardHeader`, `Sidebar`, `Row`/`Section`, `.cb-page-head`,
`.cb-model-*`, `.cb-tabs`, `.cb-move-list/.cb-move-pill`,
`.cb-practice-prompt`, `.cb-plan-card`, `.cb-status-pill`, `.cb-evalgraph` and
the board-footer row classes are reused. `.cb-evalgraph` and
`.cb-model-actions` are kept present so the existing mobile full-board/sheet
CSS hooks still apply.

---

## Endpoints used

| Endpoint | Use |
|---|---|
| `GET /api/model-games?source=` | Collection, source filter, `dailyGameId`, availability/reason |
| `GET /api/model-games/:id` | Daily detail: players, performances, plies/SAN/EPD, eval samples, annotations, opening match, progress/review |
| `GET /api/model-games/random?exclude=` | Choose another random game |
| `GET /api/model-games/history?groupBy=week&includeDaily=1` | History weeks and games |
| `POST /api/model-games/:id/progress` | Persist resume ply (and review flag) |
| `POST /api/model-games/:id/review` | Persist completed review + score |
| `GET /api/settings`, `PATCH /api/settings` (via `useProfile`) | Read/save `modelSource` |

`GET /api/model-games/daily` is not called directly: the list response already
exposes the persisted `dailyGameId`, so the page and the collection always use
the same selection.

---

## Verification

### 1. Build

```
npm run build
✓ 45 modules transformed
✓ built in 121–198ms
```

`npx tsc -p app/tsconfig.json --noEmit` reports no `ModelPage.tsx` errors. The
only remaining type error is an unrelated `OpeningsPage.tsx` key type from
another workstream.

### 2. Live API — temp DB on `PORT=8787`

Started the API only (`node server/index.js`, temp `CHESSBOOK_DB`,
`CHESSBOOK_SKIP_OPENINGS=1`) and confirmed:

- `/model-games?source=historical` → 2 games, `dailyGameId` = Kamsky–Anand;
- `/model-games/1` → Kamsky–Anand, Candidats FIDE sf1, `1-0` / “White won”,
  89 plies (45 moves), 90 eval samples, ratings 2695/2720, opening match
  Sicilian Defense: Accelerated Dragon;
- `/model-games/history?groupBy=week` → weeks of 2026-10-19 and 2024-12-23;
- `/model-games/random?exclude=1` → Stein–Myagmarsuren;
- `source=online` → 0 games with “No online games are connected…”;
  `source=masters` → 0 games with “No model games match this source.”;
- `POST /model-games/1/progress {ply:4}` → `ply:4, percent:4`;
- `POST /model-games/1/review {reviewed:true, score:75}` → review and score
  reload from `GET /model-games/1`.

Servers and the temp DB were removed after verification.

### 3. Playwright UI check — `audit/model-check.mjs`

Ran against Vite `:5173` + API `:8787` (temp DB):

```
RESULT 31 passed, 0 failed
```

Covered: real daily game/event/result/ratings, sampled eval graph (89 path
segments, label `+0.3`), hidden next move (no `Nf3` leak), matching saved
opening link, correct guess `e4`, auto reply `c5`, wrong guess `h3` without
revealing or advancing, hint level 1 (knight), hint level 2 (origin `g1`
highlight), reveal `Nf3` + auto reply `Nc6`, server progress `ply 4`, history
week/opening grouping, online source empty state + switch back, random game to
Stein–Myagmarsuren, captured completed-game review screen, completion screen
with a score, and the persisted review (`ply 89`, `reviewed:true`, score).

Screenshot: `audit/model-games-desktop.png`.

---

## Residual gaps / honest limits

1. **Per-ply guess history is client-side.** The server stores only
   `ply`/`completed`/`reviewed`/`score`; there is no model-game per-move review
   endpoint. Outcomes live in `localStorage` and are cleared by **Play again**.
2. **No engine review.** `engineReviewAvailable:false` is displayed with the
   server reason; the captured performances are shown instead.
3. **No captured annotations for either seeded game.** Hints therefore use the
   partial piece/region → origin-square → reveal path; real annotations are
   preferred automatically if a future game has them.
4. **History is not source-filtered.** `GET /model-games/history` has no
   `source` parameter, so the history screen lists all captured games even when
   the selected source is `masters`/`online`. The main collection and the daily
   game do follow the source.
5. **`masters` is empty.** The captured `model_game_data.source` values are
   file paths without “master”, so the server's master filter yields no rows.
   The page shows the explicit empty state rather than mislabelling games.
6. **No game link or year in the capture.** Both are shown as “Not captured”;
   the captured date is labelled separately.
7. **Only two captured games exist** (server caveat), so random/history are
   small; no fake weeks or invented games were added.
8. **Score denominator is the moves actually guessed**, not all 45/44. The
   completion card states both (`correct/answered` and `answered/total`), so a
   resumed partial playthrough is not overstated.
9. **Keyboard arrow navigation on the page is not implemented** (the Board's
   own keyboard square navigation still works). Eval-graph scrubbing is enabled
   only after completion so the answer cannot be skipped to.
10. **Mobile was not re-captured in this batch**; the page keeps the
    `.cb-evalgraph`/`.cb-model-actions` markers that the existing mobile CSS
    uses to unclip the board and show the sheet.

---

## D-ID checklist

- [x] **D094** — Real daily game plus history collection (Kamsky–Anand daily, Stein–Myagmarsuren history) with a week/opening history screen; no single hard-coded game.
- [x] **D095** — Daily detail is Kamsky–Anand, Candidats FIDE sf1, 1-0 / White won, 89 plies (45 moves), White 2695 / Black 2720.
- [x] **D096** — Initial selection uses the server's persisted `dailyGameId` (`model_daily_selection`) and labels the daily game.
- [x] **D097** — “Choose another random game” calls `/model-games/random?exclude=` and stays inside the current source; verified swap to Stein–Myagmarsuren.
- [x] **D098** — “View previous model games” opens a real history view grouped By week (server `weeks[]`) and By opening (real `openingMatch`).
- [x] **D099** — `Board` is `interactive` with `onMove`; `e2→e4` accepted, `h2→h3` rejected, answer hidden until reveal, opponent reply auto-played.
- [x] **D100** — Hints cycle captured annotation → piece/region → origin-square highlight → reveal; no toast contains the next SAN.
- [x] **D101** — Eval area chart is built from 89 captured sample segments with a real current label (`+0.3`), playhead and an explicit “No captured evaluation samples” state.
- [x] **D102** — Completion posts `/model-games/:id/review` with the score; the card shows score, correct/answered, hints used and Reviewed status; captured performances and engine availability are displayed.
- [x] **D103** — Resume ply is persisted through `/progress`; the final review persisted `ply 89`, `reviewed:true` and a numeric score, and reloaded correctly.
- [x] **D104** — Source row reads `settings.modelSource`, saves via `PATCH /settings`, filters `/model-games?source`, and shows explicit online/master empty reasons.
- [x] **D105** — Real `openingMatch.line` links to `/build/:color?epd=<matched position>` (path fallback), where the saved opening and Plans live; the captured guide is shown too.
- [x] **D106** — Players/ratings, event, result, performances, captured date, link availability, annotation count and engine-review availability are all shown from captured data.
- [x] **D185** — The flat fabricated `+0.3` SVG is replaced by the sampled win-probability/eval area chart (verified 89 segments in the browser).
