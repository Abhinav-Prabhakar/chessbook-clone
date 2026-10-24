# Batch 2 — builder & gap (client)

Owner: `builder-gap`
Scope: `app/src/pages/BuildPage.tsx`, `app/src/pages/GapPage.tsx` (plus the
verification script `audit/builder-gap-check.mjs` and its captures in
`audit/local-builder-gap/`).

Status: **implemented and verified**. No other page, component, stylesheet or
server file was edited. Nothing was committed. Local interfaces live in the two
page files, as requested.

---

## What changed

### Builder (`BuildPage.tsx`)

**Real data only**

- Deleted `evalFor()`, `peersFor()`, `hash()`, the 20-entry `NOTES` map and the
  local "Masters = mastery" rendering. The page now consumes
  `GET /repertoires/:key/candidates` directly (`masters`, `masterResults`,
  `eval`/`evalPawn`/`mate`, `peers`/`peerResults`, `probability`,
  `incidence`/`oneIn`/`incidenceLabel`, `annotation`, `saved`/`needed`/
  `excluded`, `available`).
- Every stat has an honest fallback: `—` for a missing Masters/Eval/Peer value,
  `Not available` under the value, `Expected in: not available` for incidence,
  and `No description available for this move in the capture.` for a missing
  annotation. Nothing is derived from local mastery.
- The root candidate list is no longer truncated to its first item. The full
  ranked list (saved **and** unsaved, 20 captured candidates for the start and
  after `1.e4`) is always rendered.
- Saved/covered state is computed from the saved line graph (`lines[].moves`)
  as well as `candidate.saved`. This matters at opponent-to-move positions,
  where the server's `savedMoves` only contains user moves: e.g. after `1.e4`
  the Black repertoire correctly shows `c5…d5` as "In your repertoire", while
  `d6/g6/Nf6…` are "Not saved yet".

**Adding moves inline (D041/D042/D043/D181)**

- The "Opening database / Import PGN" modal is gone.
- "Add an alternative move" expands an inline section. It explains that the
  ranked candidates above are the canonical list, offers a search that is
  **prefix-scoped and requires a query**, de-duplicates by next SAN, hides moves
  already covered, and preserves an inline PGN import.
- Clicking an unsaved candidate at your turn adds a real branch via
  `POST /repertoires/:key/moves` (fallback `POST /repertoires/:key/lines` with
  the full path when the position is not inside a saved line yet, e.g. after a
  previewed opponent move) and navigates to the new position. Opponent moves
  are previewed without writing a line; the next saved reply persists the path.
- The old client-side `path.every(...)` filter over an unfiltered alphabetical
  list is gone; the request always carries `prefix` and the client re-checks
  the exact prefix before showing a row.

**Position addressing and movement (D060/D067)**

- Supported URL contract:
  - `?path=e4,c5` — exact SAN path;
  - `?epd=<epd>` — exact captured position;
  - `?line=<id>[&ply=<n>]` — server-resolved position before the line's last
    move (the contract the practice screen uses for "View in build mode").
  - `path` wins over `line` even when it is empty, so practice's root task
    (`?path=&line=<id>`) opens the start position instead of the line's end.
- The board, heading and candidate list all come from the server response, so
  `?line=` opens the real quizzed position (verified against a seeded line:
  prefix `1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3`).
- Back/Forward buttons plus a clickable ply list in the board footer. Forward
  follows a saved line through the current prefix.

**Columns (D180)**

- One `Masters` cell with two lines: captured share (`43%`) and game count
  (`1.8M games`), plus `—` / `Not available` when the capture is partial.
- A clearly labelled eval badge (`+0.45`, `-0.20`, `+M3`; tooltip with
  centipawns), and a single labelled White/draw/Black peer bar
  (`49 … 46`) with a numeric `49% / 5% / 46%` second line. The two unlabeled
  grey bars are gone.
- Existing class names (`cb-candidate`, `cb-candidate-main`,
  `cb-candidate-move`, `cb-candidate-copy`, `cb-candidate-stats`,
  `cb-mastery`, `cb-eval`, `cb-peer`, `cb-candidate-actions`, `cb-table-head`)
  are retained so shared CSS still applies; the page only supplies local inline
  widths for the new two-line cells.

**Notes (D051/D070)**

- Position note editor calls `PUT /repertoires/:key/notes` (with or without
  `san`); per-move notes use the same endpoint with `san`.
- Every move row offers "Add a note to explain this move" / "Edit note", with
  Save/Cancel/Clear. Notes load from `GET /repertoires/:key/notes?epd=`.

**Autofill (D045/D046)**

- Style chips: Expected, Aggressive, Solid, Learnable, Sharp. Captured style
  scores are labelled as heuristics over captured fields.
- "Autofill remaining gaps" sends the start EPD with `allFromHere:true,
  maxMoves:1`; "Autofill all moves from here" sends the current EPD with
  `maxMoves:5`. The request always includes `style` and an explicit `epd`.
- The response's created line ids are kept so "Undo autofill" can delete exactly
  the lines the action created (batch delete, single refresh). Server reasons
  (`not-your-turn`, `no-captured-report`, none selected) are surfaced verbatim
  as human text.

**Branch UX (D052/D053 adjacent)**

- "Remove branch" is batch-aware: one confirmation lists the number of saved
  lines containing the move; all matching line ids are deleted in parallel and
  the page refreshes once. The deleted `moves`/`name` are snapshotted and an
  "Undo remove" row recreates them via `POST /lines`.
- There is no server "disable branch" endpoint. `PATCH /lines/:id` does not
  change `line_moves`, so a `saved:false` "disable" would keep the branch in
  practice — the old bug. Instead the reversible disable is the server's
  persisted exclusion: "Exclude from autofill" (`POST /exclusions`) and
  "Re-enable" (`DELETE /exclusions?epd&san`). Candidates stay visible with an
  `Excluded` state, and autofill skips them.

**Shell/actions**

- Breadcrumb: `Black openings > Build > 0% complete` (D068).
- "Build from here" opens the exact position (`?epd=` when known); "Practice
  from here" opens a line-scoped session
  (`/practice/:key?mode=line&line=<id>&epd=<epd>`; the `epd` is forwarded for
  the practice UI's exact-position work).
- The "Plans" button no longer toasts. It opens an inline panel using
  `GET /openings/position?epd=` (captured plans + annotations, explicit "No
  plans are captured" when empty) with a real link to `/model`.
- A Coverage panel reports covered candidates / total captured candidates, or
  `—` + "Not available for this position".
- The unused `Modal`, `formatDue`, `ProgressRing` and `Opening`-modal flow were
  removed from the page.

### Gap (`GapPage.tsx`)

- Uses `GET /repertoires/:key/gap?limit=8` (optionally `epd`, `path`, `line`,
  `after`). Gap selection, candidate ordering, masters/eval/peers/incidence,
  annotations, coverage and `bestMissing` are all server values.
- Heading is `position.heading.prompt` (server-derived move/side; D079). The
  old local `moveNumber`/`lastRef` formula is gone.
- Breadcrumb shows completion: `Black openings > Build > 0% complete` (D182).
  "Fill gap" and the duplicate navigation rows are gone.
- Position summary line: `This position occurs in 1 in N games · Coverage x%
  (saved of total) · Best missing: … · Captured biggest miss`.
- Candidate rows use the same two-line Masters / clear Eval / labelled peer bar
  as the builder, and add per-row `Expected in 1 in N games` and
  `Completion: in your repertoire / not saved` (D081), plus the captured
  annotation (D074) or an explicit "No description available…".
- "Show more" requests the next server page (`limit=8&offset=nextOffset`) and
  appends it; verified 8 → 16 rows (D075).
- "Autofill this gap" posts `{ epd: <position epd>, style, maxMoves: 1 }` — the
  gap-scoped autofill, not the global flag flip (D076). Style chips + "Undo
  autofill" (deletes created line ids).
- Actions: "Build from here" navigates to
  `/build/:key?epd=<exact gap epd>` (D077); "Practice this line" navigates to
  `/practice/:key?mode=line&line=<gap line id>&epd=<exact epd>` (D078);
  "Go to the next gap in this line" reads `/gaps?lineId=` and moves to the next
  ranked gap, or says "This line has no other gap" (D049).
- Notes (position + per move), Exclude from autofill / Re-enable, and
  Remove branch / Undo remove are wired exactly as in the builder
  (D048/D051/D080).
- Removed the clone-only "Repertoire health" and "More" sections, and the
  duplicate "Open in build mode" / "Back to the builder" / "Open the practice
  queue" rows (D082/D183). Production keeps Back, the candidate table,
  notes/exclude, autofill, build and practice.
- No-gap and no-capture positions have explicit empty/unavailable states;
  nothing is invented.

---

## Endpoints used

| Endpoint | Use |
|---|---|
| `GET /repertoires/:key` | saved lines (coverage, branch removal, practice target) |
| `GET /repertoires/:key/candidates?epd\|path\|line[&ply]` | builder position + full ranked candidates + heading/annotations/stockfish |
| `GET /repertoires/:key/gap?epd\|path\|line\|after&limit&offset` | gap position, candidates page, heading, coverage, bestMissing |
| `GET /repertoires/:key/gaps?lineId&limit` | next gap in the current line |
| `POST /repertoires/:key/moves` | add one candidate at an existing position |
| `POST /repertoires/:key/lines` | PGN import, fallback branch creation, remove undo |
| `DELETE /lines/:id` | batch branch removal, autofill undo |
| `POST /repertoires/:key/autofill` | gap/style autofill (`epd`, `style`, `maxMoves`, `allFromHere`) |
| `POST /repertoires/:key/exclusions` | reversible "Exclude from autofill" |
| `DELETE /repertoires/:key/exclusions?epd&san` | Re-enable |
| `GET/PUT /repertoires/:key/notes?epd[&san]` | load/save position and per-move notes (PUT via page-local fetch because `api` exposes no `put`) |
| `GET /openings?q&side&prefix` | inline prefix-scoped fallback search |
| `GET /openings/position?epd` | Plans panel (plans + captured annotations) |
| `DELETE /repertoires/:key/exclusions/:id` | not needed by these pages but supported |

---

## Branch disable/remove behaviour (and its limits)

The server has no endpoint that disables a saved branch for practice: queues
are built from `line_moves`, and `PATCH /lines/:id` only changes the legacy
`lines` columns. A "Disable" button that patched `saved`/`learned` would look
reversible but the branch would still be practised — the original D052 bug.

What this batch does instead:

1. **Exclude from autofill** — persisted in `repertoire_exclusions`, visible in
   candidate responses (`excluded:true`, `playable:false`) and skipped by
   autofill. Fully reversible with Re-enable. It does **not** change the gap
   ranking (`server/gaps.js` ignores exclusions) and does not remove an already
   saved line.
2. **Remove branch** — one confirmation, every saved line that contains the
   move at this exact prefix is deleted in parallel (batch), then the page
   refreshes once. The deleted moves/names are snapshotted, so "Undo remove"
   recreates them through `POST /lines`. Review state, chapter assignment,
   opening linkage and notes attached to individual positions are **not**
   restored; the UI says so on the undo row.
3. **Undo autofill** deletes only the line ids the last autofill created
   (transpositions that returned `created:false` are left alone).

This is the safest reversible behaviour available with the current endpoints;
no fake disable state is persisted in localStorage.

---

## Verification

### Typecheck and build

- `npx tsc --noEmit -p app/tsconfig.json` → clean (after the last edit).
- `npm run build` → `✓ built in 198ms` (45 modules; final bundle
  `index-BGc_5LuL.js`).

### API probes (own server on 8787, temp DB from the curated seed)

```
Black after 1.e4:
1 c5 Sicilian Defense masters=42.7 eval=45 peers={48.5,5.4,46.1} 1 in 3 games
2 e5 King's Pawn Game masters=21.2 eval=27 1 in 4
3 e6 French Defense masters=13.1 eval=35 1 in 8
4 c6 Caro-Kann Defense masters=8.7 eval=37 1 in 9
5 d5 Scandinavian Defense masters=3.5 eval=78 1 in 13
total 20 available true

Gap: prompt "Choose a response to 1. e4", prefix ["e4"],
incidence 0.539…, oneIn 2, order c5,e5,e6,c6,d5,
hasMore true / nextOffset 8 when limit=8.

POST /autofill {epd:start, allFromHere:true, dryRun:true, style:"solid"}
→ filled 5, styleSource "heuristic-from-captured-fields"; no writes.
```

### Playwright

`node audit/builder-gap-check.mjs` (Chrome through the Vite app, API on 8787,
fresh temp DB) → **32/32 checks passed**, including:

- full 20-row candidate list at the start and the exact `c5,e5,e6,c6,d5` order
  after `1.e4`;
- `43%` Masters, `+0.45` eval, `49 / 5 / 46` peers;
- no `Amar Opening` / `Anderssen` database junk;
- `?line=` opens the real quizzed prefix; `?path=&line=` opens the start;
- inline add-alternative (no modal) and Plans panel;
- gap heading, completion breadcrumb, Expected-in/coverage, descriptions;
- removed "Repertoire health"/"More";
- Show more 8 → 16;
- Build-from-here `?epd=`, Practice `mode=line&line=17&epd=…`;
- note save/reload, exclude/re-enable, exact-epd autofill request, undo row;
- next gap in line navigates to the next `?epd=`.

Artifacts: `audit/local-builder-gap/report.json` and screenshots
`01-build-start`, `02-build-after-e4`, `03-build-line-param`,
`04-build-inline-alternative`, `04b-build-plans`, `05-gap`, `06-gap-note`,
`07-gap-excluded`, `08-gap-autofill`.

Manual unavailable-state check: `/build/black?path=a3` renders "Captured
candidate data is not available for this position", `—` values, and a disabled
"Practice from here" ("No saved line reaches this position yet").

No server was modified and no `npm run dev` was started while a port was busy;
verification used a private API port and a fresh temp DB.

---

## Residual gaps

1. **Practice starting ply.** Practice still owns session creation. This page
   passes `epd` and a line id, but the current practice UI/server contract
   starts at a line's first due task, not necessarily the exact gap ply. The
   link is line-scoped and carries `epd` for the practice agent to consume.
2. **No true branch disable.** See above; exclusions are reversibly "excluded
   from autofill", removal is batch + undo but loses review state.
3. **Remove undo does not restore** review history, chapter, opening id or
   position notes. The undo row states this.
4. **Exclusions do not affect gap ranking** (server ranking ignores them), only
   autofill suggestions.
5. **Captured data is partial.** Masters is null on truncated captures; eval/
   peers/plans can be absent. The UI renders `—`/`Not available`; it never
   falls back to local mastery or a hash.
6. **Coverage at opponent-to-move positions** is computed from exact saved SAN
   prefixes; a transposition to the same EPD with a different move order is not
   counted locally (the server still reports the EPD-level saved move for your
   own turns).
7. **Plans** are only the captured field (mostly empty for these captures)
   plus a real link to the model-game library; there is no dedicated plans
   screen in the app yet.
8. **Inline stats widths** are page-local inline styles so the shared CSS is
   untouched. The visual-fidelity owner may want to promote the two-line cells
   into `app.css`.
9. **PGN import** remains inline inside "Add an alternative move" rather than a
   modal; it accepts a single pasted game/line as before (multi-game import is
   available through the server `/import` but not surfaced here).

---

## D-ID checklist (one-line evidence)

- [x] **D040** — rows render `candidate.annotation` (e.g. "A counter-attacking opening…") or explicit "No description available"; no `NOTES` map.
- [x] **D041** — "Add an alternative move" is an inline panel; no alphabetical opening dump; search always sends the current prefix and requires a query.
- [x] **D042** — the add-line modal (database/import tabs) was removed from the builder.
- [x] **D043** — prefix search is server-filtered (`?prefix=…`) and client-rechecked per move; empty prefix shows no DB rows until a query is typed.
- [x] **D045** — Expected/Aggressive/Solid/Learnable/Sharp chips drive `/autofill style`; "Undo autofill" reverts created lines.
- [x] **D046** — "Autofill all moves from here" posts `allFromHere:true, maxMoves:5` at the current EPD.
- [x] **D047** — gap autofill posts `{epd: position.epd, style, maxMoves:1}` (verified request body).
- [x] **D048** — Exclude from autofill is persisted and reversible (re-enable verified round-trip).
- [x] **D049** — "Go to the next gap in this line" reads `/gaps?lineId=` and navigates to the next ranked EPD (or reports none).
- [x] **D050** — Plans opens a real `GET /openings/position` panel and a `/model` link; no toast.
- [x] **D051** — position and per-move notes load/save through `/notes` (PUT) with Save/Clear.
- [x] **D060** — `?line=` opens the server-resolved position before the line's last move (prefix verified).
- [x] **D067** — clickable ply list plus Back/Forward move navigation in the board footer.
- [x] **D068** — builder breadcrumb is `repertoire > Build > N% complete`.
- [x] **D069** — "Build from here" (`?epd=`) and "Practice from here" (`mode=line&line=&epd=`) exist in the builder; the gap has the same pair.
- [x] **D070** — each move row offers "Add a note to explain this move" with the exact prompt as placeholder.
- [x] **D073** — gap Masters/Eval/Peer labels show captured `42.7 → 43%`, `45 → +0.45`, `48.5/5.4/46.1`.
- [x] **D074** — gap rows render the captured descriptions (or an explicit unavailable line).
- [x] **D075** — Show more paginates (`limit=8&offset=8`), 8 → 16 rows.
- [x] **D076** — "Autofill this gap" is the `epd`-scoped autofill, not the global call.
- [x] **D077** — "Build from here" navigates to `/build/:key?epd=<gap epd>`.
- [x] **D078** — "Practice this line" navigates to `/practice/:key?mode=line&line=<gap line>&epd=<gap epd>`.
- [x] **D080** — gap has the note editor plus exclude/re-enable and remove/undo flows.
- [x] **D081** — gap rows show `Expected in 1 in N games` and `Completion: in your repertoire / not saved`, with a position Coverage line.
- [x] **D082** — "Repertoire health" and "More" sections removed from the gap sidebar.
- [x] **D180** — two-line Masters (share + games) and labelled peer percentages, clear eval badge, unlabeled bars removed.
- [x] **D181** — no generic position-less add modal; the inline list is ranked by captured play rate with position context.
- [x] **D182** — gap breadcrumb is `repertoire > Build > N% complete` (links to Build).
- [x] **D183** — duplicate gap navigation removed; only Back, candidates/notes/exclude, autofill, Build, Practice and next-gap remain.

Adjacent (not separately tracked): D052/D053 are handled honestly as
exclude + batch remove with undo, with the server limitations stated above.
