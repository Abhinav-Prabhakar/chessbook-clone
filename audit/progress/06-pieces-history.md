# Batch 6 — real piece sets + review-history browser (D144, D018/D022)

Owner: `pieces-history`.
Status: **implemented and verified**. Nothing committed. No verification server
left running.

Scope:

- `app/public/pieces/**` and the mirrored root `pieces/**`
- `server/settings.js` (`PIECE_SETS` metadata only)
- `app/src/components/Board.tsx`
- `app/src/pages/SettingsPage.tsx`
- `app/src/prefs.ts`
- `app/src/types.ts`
- new `app/src/pages/HistoryPage.tsx`
- `app/src/App.tsx` (history routes)
- `app/src/styles/app.css` (new block at the end only)
- one targeted assertion update in `tests/server/modes.test.js` for the new
  piece-set list

No server API, schema, engine/data file, other page, or `package.json` was
edited.

---

## 1. Piece sets (D144)

### Sets added

Five real sets are now bundled. `chessbook_monochrome` remains the default and
fallback; all twelve files exist in every folder.

| id | Name | Author | Licence | Files |
|---|---|---|---|---|
| `chessbook_monochrome` | Chessbook Monochrome | bundled with this build | project assets | 12/12 |
| `cburnett` | Cburnett | Colin M.L. Burnett | GPLv2+ | 12/12 |
| `merida` | Merida | Armando Hernandez Marroquin | GPLv2+ | 12/12 |
| `chessnut` | Chessnut | Alexis Luengas | Apache 2.0 | 12/12 |
| `shapes` | Shapes | flugsio (`chess_shapes`) | CC BY-SA 4.0 | 12/12 |

Source and licence check:

- SVGs downloaded from the Lichess asset CDN:
  `https://lichess1.org/assets/piece/<set>/{wK,wQ,wR,wB,wN,wP,bK,bQ,bR,bB,bN,bP}.svg`.
- The CDN serves the sets from the
  [lila repository](https://github.com/lichess-org/lila/tree/master/public/piece).
- Authors and licences were checked against
  [`lila/COPYING.md`](https://github.com/lichess-org/lila/blob/master/COPYING.md)
  on 24 Oct 2026:
  - `public/piece/cburnett` — Colin M.L. Burnett — GPLv2+
  - `public/piece/merida` — Armando Hernandez Marroquin — GPLv2+
  - `public/piece/chessnut` — Alexis Luengas — Apache 2.0
  - `public/piece/shapes` — flugsio — CC BY-SA 4.0
- The request mentioned `alpha` and `chess7` as examples, but the same Lichess
  licence table lists `alpha` (Eric Bentzen) as *“free for personal
  non-commercial use”* and `chess7` (Style-7) as *“freeware”*. Neither is a
  clear open-source/CC licence, so they were **not** bundled. `chessnut`
  (Apache 2.0) and `shapes` (CC BY-SA 4.0) are the permissive alternatives.
  The full attribution table is repeated in `pieces/README.md` and
  `app/public/pieces/README.md`.

### File layout

```text
pieces/                              # Express static mount (/pieces)
  README.md
  chessbook_monochrome/{wK,wQ,wR,wB,wN,wP,bK,bQ,bR,bB,bN,bP}.svg
  cburnett/...        merida/...      chessnut/...      shapes/...

app/public/pieces/                   # Vite public dir (copied into app/dist)
  README.md
  chessbook_monochrome/...           # same five folders, same 12 files each
  cburnett/...        merida/...      chessnut/...      shapes/...
```

All 60 files are real `<svg>` documents (viewBox + vector paths, no placeholders)
and are byte-identical between the root mirror and `app/public`.

### Server metadata

`server/settings.js` → `PIECE_SETS` now has five entries with:

```json
{
  "id": "merida",
  "name": "Merida",
  "label": "Merida",
  "available": true,
  "source": "pieces/merida",
  "attribution": "Armando Hernandez Marroquin",
  "license": "GPLv2+"
}
```

`GET /settings` returns them as `pieceSets` and `availablePieceSets`;
`PATCH /settings { pieceSet }` already validated against `PIECE_SETS` with
`available: true`, so all five are accepted and an unknown id keeps the previous
value. Verified by curl (see below).

### Client + UI

- `app/src/prefs.ts` mirrors `PIECE_SETS` (same ids/labels/licences),
  validates `getPieceSet()`, and migrates a local old choice to the server only
  while the server still has the default.
- `Board.tsx` uses the selected id for `/pieces/<set>/<piece>.svg`, exposes
  `data-piece-set`, and falls back to `chessbook_monochrome` for an
  unknown/invalid id.
- `SettingsPage.tsx` adds a **Board settings → Piece set** row and a dedicated
  sheet:
  - live preview of king, knight and pawn per set on board-coloured tiles;
  - checkmark on the active set;
  - author + licence line under each name;
  - selection PATCHes `/settings`, updates the synchronous mirror and the board
    behind the sheet immediately.
- `app.css` adds the preview grid plus per-set board scale/contrast tuning
  (Cburnett/Merida/Chessnut 96 %, Shapes 94 %, soft drop shadows; the default
  monochrome keeps the existing 96.5 % + shadow).

---

## 2. Review history (D018/D022)

New route: **`/history/:key`**, and **`/history`** defaults to `white`
(`App.tsx`, inside the local-profile outlet). `key` accepts a numeric
repertoire id or a colour name; an unknown key falls back to the first
repertoire. If there are no repertoires the page shows an empty state with a
link to add one.

### APIs used

| Request | Purpose |
|---|---|
| `GET /repertoires` | resolve id/colour key → repertoire name, colour, links |
| `GET /practice/reviews?repertoire=<id>&limit=500` | the real per-position review log (`reviews` table) |
| `GET /practice/daily?tzOffset=<offset>` | today, current/highest streak, goal |
| `GET /repertoires/<id>/mistakes` | outstanding mistakes + exact EPD/line for practice links |
| `api.offlineSnapshot()` / `onOfflineChange()` / `flushOfflineQueue()` | queued-write banner + **Sync now** (no change to `api.ts`) |

Each review row has `epd`, `ply`, `san`, `playedSan`, `side`, `correct`,
`grade`, `mode`, `daily`, `lineId`, `lineName`, `createdAt`. The history UI
shows expected SAN in the title, line + mode + grade in the meta line, and
“Correct” or “Played <san>” with a check/x on the right. Date is the group
heading. The endpoint does not return the scheduled interval, so the UI shows
the recorded grade when present and omits interval; adding interval later would
require exposing the stored scheduled response in `server/api.js` (not edited).

### Page behaviour

- Summary: **Reviews, Correct, Wrong, Accuracy, Streak** (best streak as a
  hint), computed from the real log.
- Filters:
  - result tabs: All / Correct / Wrong, with live counts;
  - date: All time / Today / Last 7 days / Last 30 days / Specific day;
  - review mode: every mode present in the log (due, weak, all, early, common,
    line, etc.).
- Grouped list by local day (`daily` field, falling back to `createdAt`),
  newest first, with per-day counts; “Today” and “Yesterday” labels.
- Empty states for “no history yet” and “no reviews match these filters” with
  clear-filters/start-review actions.
- **Recent mistakes** panel (up to six) from `/mistakes`:
  - expected move + line + side to move + number of saved answers;
  - **Practice** → `/practice/<id>?mode=weak&line=<lineId>` (server-side weak
    queue filtered to that line);
  - **Position** → `/build/<id>?epd=<epd>&line=<lineId>` for the exact position.
- Review rows similarly link to the weak queue for their line.
- Offline/pending state: if `cb_offline_queue` has entries, a banner shows the
  pending count and a **Sync now** action; if the browser is offline, a second
  note says the stored history is being shown. After a successful flush the
  page reloads the authoritative rows.
- Uses the existing `cb-app` / board-column / `cb-sidebar` composition, so
  desktop is board+sheet and 390×844 keeps the clipped two-rank board + full
  sheet. All new CSS is additive; no existing selectors were changed.

### Links / routes

- **Done here:** `/history` + `/history/:key` routes; Settings → Review
  settings → **Review history**; Settings board now renders the selected set.
- **One-line links needed in files this batch does not own** (add near an
  existing `Section`/`Row`):
  - `app/src/pages/LearnPage.tsx`:
    ```tsx
    <Row title="Review history" meta="Every logged review, grouped by day" to={`/history/${key}`} right={<i className="fa fa-arrow-right" aria-hidden />} />
    ```
  - `app/src/pages/RepertoirePage.tsx`:
    ```tsx
    <Row title="Review history" meta="Reviews, mistakes and streaks" to={`/history/${key}`} right={<i className="fa fa-arrow-right" aria-hidden />} />
    ```
  - `app/src/pages/Dashboard.tsx`:
    ```tsx
    <Row title="Review history" to={`/history/${target?.id ?? "white"}`} right={<i className="fa fa-arrow-right" aria-hidden />} />
    ```

---

## 3. Verification

### Build / types

```text
npm run build            → ✓ built (67 modules)
npx tsc --noEmit -p app/tsconfig.json → no errors
```

### API exercise (isolated DB, port 8793)

Because the concurrent engine/coverage agent was mid-write and
`server/db.js` imported a not-yet-created `server/explorer-data.js`, the API was
run from a detached **HEAD worktree** (clean engine) with this batch's
`server/settings.js` and built assets copied in, on a throwaway SQLite DB.
This does not touch the main working tree or the other agent's changes.

Generated real reviews through `POST /practice/sessions` + `/attempt`:

```text
GET /practice/reviews?repertoire=white&limit=500 → 7 rows
  correct=5, wrong=2, accuracy=71 %
  groups: 2026-10-24 (6), 2026-10-23 (1, moved for grouping)
GET /repertoires/white/mistakes → 1 outstanding (Nc3, Sicilian Defense: Closed)
GET /practice/daily?tzOffset=-330 → reviews 7, streak current 1 / best 2
```

Piece-set API:

```text
GET /settings → pieceSets/availablePieceSets =
  chessbook_monochrome, cburnett, merida, chessnut, shapes
  every entry: available:true, attribution + license present
PATCH /settings {"pieceSet":"merida"} → settings.pieceSet = "merida"
PATCH /settings {"pieceSet":"nope"}   → keeps "merida" (safe fallback)
```

All five sets returned HTTP 200 for `/pieces/<set>/wK.svg`, and the browser
check fetched all 60 files and confirmed each body starts with `<svg>`.

### Browser (Playwright + installed Google Chrome, 1440×900 and 390×844)

**17/17 checks passed**, zero console/page errors:

- summary shows 7 reviews / 5 correct / 2 wrong / 71 % / 2 streak;
- Today + Yesterday groups, line/mode/grade rows, Recent mistakes (Nc3);
- Wrong filter keeps exactly the two wrong rows (`Played a3`, `Played h3`);
- `/history` defaults to a repertoire;
- piece sheet lists five sets, all 15 preview images load;
- selecting each of `cburnett`, `merida`, `chessnut`, `shapes` and restoring
  `chessbook_monochrome` updates `data-piece-set`, `cb_piece_set`, and renders
  32/32 loaded board images from `/pieces/<set>/` (12 distinct sources);
- mobile history and mobile piece sheet have **0 px** horizontal overflow.

Evidence files:

- `audit/06-history-desktop.png`
- `audit/06-history-wrong-filter.png`
- `audit/06-history-mobile.png`
- `audit/06-piece-sets.png`
- `audit/06-piece-sets-mobile.png`
- `audit/06-board-cburnett.png`
- `audit/06-board-shapes.png`
- `audit/06-history-check.json` (`{checks:17,passed:17,failed:0,consoleErrors:[]}`)

Targeted server regression:

```text
node --test tests/server/modes.test.js → 10 tests, 10 pass
```

The only test edit is the preference round-trip assertion that previously
hard-coded `availablePieceSets.length === 1`; it now asserts at least two
available sets, the default first, attribution/licence on each, `cburnett`
present, and a `pieceSet:"merida"` PATCH round-trip.

The temporary server, worktree and databases were removed; port 8793 is free.

---

## 4. D-ID / limitation checklist

- [x] **D144** — five real, licensed sets bundled and mirrored; server
  `PIECE_SETS` metadata with id/name/available/attribution/licence; PATCH
  accepts them; Settings picker with live king/knight/pawn previews,
  checkmarks, author/licence, server + prefs persistence; Board renders the
  chosen set with `data-piece-set`; unknown ids fall back to
  `chessbook_monochrome`; all 60 SVGs verified as real SVGs; board rendering
  verified for every set.
- [x] **D018** — history rows expose the expected move, line/opening, mode,
  grade and result; practice links return to the same line's weak queue and
  exact-position builder links are available for mistakes.
- [x] **D022** — dedicated review-history browser over the real `reviews` log
  (`GET /practice/reviews`), with summary, filters, date grouping, expected vs
  played move, correct/wrong, mode/grade, recent mistakes and queued-write
  state.
- [x] **D108 follow-up** — history is now a full standalone surface rather than
  only the dashboard's “today” slice.
- [ ] **Interval in history** — not shown because `GET /practice/reviews` does
  not return the scheduled interval; `grade` is shown when present. Owner if
  wanted: `server/api.js` review response (outside this batch).

Residual notes:

1. `/history/:key` silently falls back to the first repertoire if the key is
   unknown; the page never invents rows.
2. `alpha`/`chess7` were deliberately not bundled because their Lichess-listed
   terms are non-commercial/freeware rather than open-source/CC;
   `chessnut`/`shapes` were used instead. Full table in `pieces/README.md`.
3. Additional links in Learn/Repertoire/Dashboard are the three one-liners
   above; those files belong to other owners.
