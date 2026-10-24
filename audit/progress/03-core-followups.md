# Batch 3 — core follow-ups (practice modes, cards, refutation, branches, profile)

Owner: `core-followups`
Scope: `server/api.js`, `server/schema.js`, `server/repertoire.js`,
`server/gaps.js`, `server/opening-data.js`, `server/db.js`, new
`server/settings.js`, `server/refutation.js`, `server/common.js`,
`tests/server/modes.test.js`, `app/src/pages/PracticePage.tsx`,
`app/src/pages/SettingsPage.tsx`, `app/src/pages/LearnPage.tsx` (one row),
`app/src/components/Board.tsx`, `app/src/prefs.ts`, `app/src/types.ts`,
`app/src/styles/app.css`.

Status: **implemented and verified**. Nothing committed. No server left
running. All new preferences are server-backed; localStorage is only a
synchronous mirror + one-time migration source.

---

## 1. Schema (migration v3)

`PRAGMA user_version` 2 → 3. Applies in place to existing databases.

| Table | New columns / table |
|---|---|
| `users` | `rating_system`, `single_elo`, `elo_range`, `coverage_goal` (mirrors of `settings`) |
| `settings` | `rating_system`, `time_control`, `single_elo`, `elo_range`, `coverage_goal`, `practice_mode`, `review_style`, `pause_after_move`, `pause_on_fail`, `pause_on_low_score`, `pause_when_note`, `animation`, `haptics`, `piece_set`, `sound_volume`, `sound_effects` JSON, `recommended_moves_size`, `notifications` JSON |
| `practice_sessions` | `style`, `practice_mode`, `replays` |
| `lines` / `line_moves` | `disabled` |
| new `branch_states` | `(repertoire_id, epd, san_key, disabled, snapshot, …)` for reversible branch disable |

On a fresh install the captured account's `ratingSystem`/`singleElo`/
`eloRange` are copied into `settings` once (guarded by a
`capture_profile.profile_synced` marker), so the first run matches the
captured 2100 / 2000–2200 profile. Later user choices are never overwritten.

---

## 2. New / changed endpoint shapes

### Preferences and profile (D135/D197)

`GET /settings` now returns the whole server preference object plus metadata:

```json
{
  "settings": {
    "boardTheme": "green", "coordinates": true, "legalMoves": true,
    "sound": true, "showHints": true, "dailyGoal": 50,
    "modelSource": "historical",
    "ratingSystem": "Chess.com", "timeControl": "Blitz",
    "singleElo": 2100, "eloRange": "2000-2200", "coverageGoal": 50,
    "practiceMode": "individual", "reviewStyle": "cards",
    "pauseAfterMove": 0, "pauseOnFail": true, "pauseOnLowScore": false,
    "pauseWhenNote": false, "animation": "normal", "haptics": true,
    "pieceSet": "chessbook_monochrome",
    "soundVolume": 70, "soundEffects": { "move": true, "…": true },
    "recommendedMovesSize": "comfortable",
    "notifications": { "dailyPractice": false, "streak": false,
                       "modelGame": false, "mistakes": true }
  },
  "platforms": ["Chess.com","Lichess","FIDE","USCF"],
  "timeControls": ["Bullet","Blitz","Rapid","Classical"],
  "boardThemes": ["green","blue","brown","lichess-green","chesscom-green"],
  "reviewStyles": ["cards","complete-once","complete-every","entire-line"],
  "practiceModes": ["individual","whole-lines"],
  "animations": ["off","fast","normal"],
  "recommendedSizes": ["compact","comfortable","large"],
  "coverageOptions": [25,50,100,200,500],
  "pieceSets": [{ "id": "chessbook_monochrome", "label": "Chessbook Monochrome",
                  "available": true, "source": "pieces/chessbook_monochrome" }],
  "availablePieceSets": [ "…same single entry…" ],
  "ratingBand": { "available": true,
                  "capturedBands": ["1800-2000","2000-2200"],
                  "userBand": "2000-2200", "matches": true,
                  "source": "recon/live4/network.json#2 (/api/user)" }
}
```

`PATCH /settings` accepts any subset of `settings` (camelCase), validates each
value, and returns the same shape. Invalid values keep the previous value.
`singleElo` recomputes `eloRange` unless both are sent.

`GET /me` adds:

```json
"user": {
  "ratingSystem": "Chess.com", "singleElo": 2100, "eloRange": "2000-2200",
  "coverageGoal": 50,
  "profile": { "ratingSystem": "…", "timeControl": "…", "singleElo": 2100,
               "eloRange": "…", "coverageGoal": 50,
               "pieceSet": "chessbook_monochrome" },
  "preferences": { "…same object as GET /settings.settings…" },
  "ratingBand": { "…same object as GET /settings.ratingBand…" }
}
```

`PATCH /user` now also accepts `ratingSystem`, `singleElo`, `eloRange`,
`timeControl`, `coverageGoal` and writes through `updateSettings`, so `/user`
and `/settings` cannot diverge. `GET /repertoires/:key/candidates` candidates
now carry `capturedIncidence`, `bandMismatch`, `meetsCoverage`; when the
profile band has no capture, `incidence`/`incidenceAvailable` are explicitly
null/false. Gap/trim/common read `coverageGoal`.

### Practice sessions (D012/D090/D140/D156)

`POST /practice/sessions` accepts:

```json
{ "repertoire": "white", "mode": "due|all|weak|early|specific|line|common",
  "lineId": 12, "lineIds": [12,13], "resume": false,
  "style": "cards|complete-once|complete-every|entire-line",
  "practiceMode": "individual|whole-lines",
  "coverageGoal": 50 }
```

`style`/`practiceMode` default to the server preference. `Session` gains
`style`, `practiceMode`, `replays`. Semantics:

| Style | Queue |
|---|---|
| `cards` | one task per base queue position (due/all/weak/common/…), with card data |
| `complete-once` | every user position of every line containing at least one base entry, once |
| `complete-every` | same first pass; a **wrong** answer re-queues that line once (bounded to 3 replays / 3× queue) |
| `entire-line` | every saved line end to end, regardless of due state |
| `practiceMode: whole-lines` + `cards` | maps onto `complete-once` for due/weak/early/all |

`mode=common` is new: positions the opponent reaches with a captured move
whose real incidence ≥ `1 / coverageGoal` and where the repertoire has a saved
reply. `POST /practice/sessions` for common also returns:

```json
"commonMoves": [{ "epd": "…", "fen": "…", "path": ["e4","c5"],
                  "via": { "epd": "…", "san": "c5", "incidence": 0.2938,
                           "oneIn": 3, "source": "recon/live4/network.json#13" } }],
"commonSource": "captured-position-incidence"
```

`GET /repertoires/:key/learn` adds `common`, `commonMoves`,
`commonSource`, `reviewStyle`, `practiceMode`, `coverageGoal`, `ratingBand`.

Every `Task` adds:

```json
"card": {
  "difficulty": 5, "expectedWrong": 0.33, "expectedWrongPercent": 33,
  "recall": null, "grade": null, "lastCorrect": null,
  "lastReview": null, "dueAt": null, "intervalDays": null,
  "reps": 0, "lapses": 0, "wrongCount": 0, "state": "new",
  "reviewed": false, "mastered": false
},
"common": { "epd": "…", "via": { "san": "c5", "incidence": 0.29,
                                "oneIn": 3, "source": "…" } } | null,
"plans": [],
"planArrows": []
```

`POST /practice/sessions/:id/attempt` adds to every response:
`card` (post-review state, `grade`, `intervalDays`), and on a wrong answer:

```json
"refutation": {
  "available": true, "playedSan": "h3", "san": "Nc6",
  "uci": "b8c6", "from": "b8", "to": "c6", "fen": "…after h3…",
  "epd": "…", "line": ["Nc6","Nc3"], "evalPawns": 0.1, "mate": false,
  "depth": 2, "engine": "local-material-search", "source": "local",
  "explanation": "Nc6 is the strongest reply in this position.",
  "damagePawns": 0.1, "expectedEvalPawns": 0.1,
  "annotation": null, "annotationSource": null
}
```

Refutations are computed locally (no cloud, no Stockfish binary): a
deterministic material/mate search over `chess.js` (depth 2 + capture
quiescence, 60k-node / 400 ms budget). The expected saved move is searched for
the damage comparison; captured annotations are appended to the explanation
when present. The engine/depth fields are always returned, never faked.

### Branch disable / batch remove (D052/D053)

```
GET    /repertoires/:key/branches
POST   /repertoires/:key/branches/disable   { epd, san }
POST   /repertoires/:key/branches/enable    { epd, san }
DELETE /repertoires/:key/branches           { lineIds?, branches?:[{epd,san}], dryRun? }
POST   /repertoires/:key/branches/restore   { lines:[{moves,name?,openingId?}] }
```

Disable response:

```json
{
  "ok": true,
  "disabled": { "epd": "…", "san": "c5", "lineIds": [1,2,3,4], "lineCount": 4 },
  "snapshot": { "lines": [{ "id": 1, "name": "…", "moves": ["e4","c5","…"] }] },
  "state": { "lines": 4, "moves": 27 },
  "repertoire": { "…stats with disabled moves excluded…" }
}
```

A disabled branch removes the move and every later move of the affected lines
from practice/statistics. Moves also reachable through an enabled transposition
stay playable. Review state is untouched, so `enable` restores exactly the
previous queue; `state.lines/moves` drop to 0.

Batch remove resolves `lineIds` and/or `{epd,san}` branches to one line set,
deletes in one transaction, rebuilds the graph/totals once and returns
`{ok, dryRun, removed:[{id,name,moves,openingId}], removedLineIds,
removedCount, snapshot:{lines}, repertoire}`. `POST …/branches/restore` accepts
that `snapshot.lines` as an undo.

**Contract for the builder/gap owner (BuildPage/GapPage not edited here):**
replace the sequential `DELETE /lines/:id` loop with
`DELETE /repertoires/:key/branches {lineIds}` and keep `snapshot` for Undo
(`POST …/branches/restore`). Replace the destructive "disable" patch with
`POST …/branches/disable`; render `GET …/branches.disabled` with an Enable
action. Do **not** mutate `learned/mastered/saved` for disable.

### Board overlay props (D033/D191)

`Board` already exposes and now documents/supports:

```ts
arrows?: { from: string; to: string;
           kind?: "plan" | "hint" | "refutation" | "last" | "wrong";
           color?: string }[]
highlights?: { square: string;
               kind?: "plan" | "hint" | "refutation" | "last" | "wrong";
               color?: string }[]
theme?: "green" | "blue" | "brown" | "lichess-green" | "chesscom-green"
pieceSet?: string   // only chessbook_monochrome is bundled
lastMoveTint?: string
```

Practice renders last-move/auto-reply, hint origin, revealed answer, captured
plan arrows (when `task.planArrows` is non-empty) and the wrong-move +
refutation arrows. The captured `plans` arrays are empty in this dataset, so no
plan arrow is invented; the props are ready for the builder/gap owner to pass
`arrows`/`highlights` without changing `Board`.

---

## 3. How each preference now reaches behaviour

| Preference | Stored | Behaviour it drives |
|---|---|---|
| rating system / time control / single Elo / Elo range | `settings` (mirrored to `users`) | `/me`, Settings row, Add band note; candidate `ratingBand.matches` gates band-specific `incidence`; next-common is empty when the profile band has no capture |
| coverage goal (1 in N) | `settings` | gap `bestMissing` filtering (`probability ≥ 1/N`), next-common incidence cutoff, trim `threshold` / `pastGoal` fallback |
| practice mode (individual / whole lines) | `settings` + `practice_sessions.practice_mode` | session queue expands due/weak/early/all into complete lines |
| review style | `settings` + `practice_sessions.style` | queue shape (cards / once / every / entire line) and the practice card panel |
| pause after playing a move | `settings` | PracticePage holds the board for 1 s / 2 s before the next task |
| pause on fail | `settings` | wrong position stays on the board with the refutation until Continue |
| pause when there's a note | `settings` | next task with a position/move note waits behind Continue |
| pause on low score | `settings` | after 4+ answers at <50% accuracy the next task waits behind Continue |
| animation / recommended-moves size / haptics | `settings` → mirror → global CSS/vibrate | unchanged effects, now persisted server-side |
| sound volume / per-sound switches | `settings` | Settings previews; board sounds still read the mirror |
| notifications | `settings` | Dashboard browser-notification channels |
| board theme / coordinates / legal moves / sound | `settings` | Board rendering and sound gate |
| piece set | `settings` | explicit single bundled set (`availablePieceSets` length 1); Board falls back to it |

Client `prefs.ts` is now a **mirror**, not a second store:
`applySettingsPrefs(settings)` rebuilds the in-memory `ClientPrefs` from the
server row and rewrites the synchronous `cb_*` keys. `migrateLocalPrefs(api)`
runs once (flag `cb_prefs_migrated_v3`) and PATCHes old localStorage values to
the server only where the server field is still at its default, so a stale
browser cannot overwrite a later server choice.

---

## 4. Files changed

- `server/schema.js` — migration v3.
- `server/settings.js` — defaults, validation, read/write, metadata, band match.
- `server/common.js` — captured-incidence "next common moves" queue.
- `server/refutation.js` — local material/mate refutation search.
- `server/repertoire.js` — review styles, common queue, card data, plan
  passthrough, disabled filtering, `disableBranch`/`enableBranch`/
  `removeBranches`/`recomputeDisabled`.
- `server/opening-data.js` — band match, coverage flags, disabled saved moves.
- `server/gaps.js` — coverage-goal filtering, disabled subtree exclusion.
- `server/api.js` — settings/profile, session style, common mode, refutation,
  branch endpoints, learn/gap metadata, trim fallbacks.
- `server/db.js` — one-time captured-profile sync.
- `tests/server/modes.test.js` — 10 tests for the new modes/endpoints.
- `app/src/pages/PracticePage.tsx` — styles/mode, card panel, refutation panel,
  pause switches, common info, plan arrows, grade feedback.
- `app/src/pages/LearnPage.tsx` — “Next common moves” row; practice/review style
  read from the server response; removed the localStorage whole-lines guess.
- `app/src/pages/SettingsPage.tsx` — every preference PATCHes SQLite; 5 board
  appearances; explicit single piece set; migration + server reset; chevrons.
- `app/src/components/Board.tsx` — 5 themes, `pieceSet`, plan/refutation arrows.
- `app/src/prefs.ts` — server mirror, `migrateLocalPrefs`, `getPieceSet`.
- `app/src/types.ts` — typed settings/styles/cards/refutation/common.
- `app/src/styles/app.css` — piece shadow/scale, review card, refutation,
  settings value/chevron, new theme previews, mobile guard.

---

## 5. Verification

- `node --test tests/server` → **56 tests, 56 pass, 0 fail** (46 existing + 10
  new in `modes.test.js`).
- `npx tsc --noEmit -p app/tsconfig.json` → no errors in owned files (one
  pre-existing error remains in another agent's `OpeningsPage.tsx`).
- `npm run build` → **✓ built in 169 ms** (45 modules).
- Isolated API exercise: `PORT=8794`,
  `CHESSBOOK_DB=<tmp>/test.db`, `CHESSBOOK_SKIP_OPENINGS=1`; then the process
  was killed and the temp directory removed. Exercised:
  - `GET/PATCH /settings` rating 2150 → `eloRange 2000-2200`, review style,
    practice mode, coverage, pauses, notifications, `boardThemes` 5,
    `availablePieceSets` 1;
  - `/me` profile + `ratingBand.matches`;
  - `/learn` `common: 7` with captured incidence (`c5`/`Nf6`, 1 in 3);
  - `mode=common` → 7 positions with `task.common`; answer graded `Good`,
    interval 3.7 days;
  - wrong answer → `refutation {san:"Nc6", from:"b8", to:"c6",
    engine:"local-material-search", damagePawns:0.1}`; card difficulty 2.8,
    expected wrong 31%;
  - disable `1…c5` → 4 lines / 27 moves disabled, move count 69 → 55;
    enable → 69 again;
  - batch remove dry-run → 1 line, snapshot returned.

The existing tests remained green, including the full per-move practice loop,
wrong-answer invariants, idempotency, notes, reset, legacy upgrade and
integrity.

---

## 6. Residual gaps / deliberate limits

1. **`complete-every` replay** is triggered by a *miss* (up to 3 replays), not
   by every due prompt. Session identity is EPD-based (`queue`/`seen` store
   EPDs), so repeating the same position inside one session would require an
   index-based seen model. The visible behaviour is a real replay and is
   labelled in the attempt response (`session.replays`).
2. **Refutation is not Stockfish.** It is a deterministic local material/mate
   search (depth 2 + capture quiescence, 400 ms cap). It finds hanging pieces
   and mates but is weaker than Stockfish; `engine`/`depth` are returned and
   displayed so the UI never claims otherwise.
3. **Plan arrows** are supported end-to-end but the captured `position_reports.plans`
   arrays are empty, so practice shows none. No arrow geometry is invented.
4. **Only one piece set exists** (`chessbook_monochrome`). No alternative piece
   SVGs exist in `recon/`, so Settings states this explicitly and the server
   exposes one `availablePieceSets` entry.
5. **Two captured rating bands only** (1800–2000 and 2000–2200). A profile band
   outside them hides band-specific incidence (`bandMismatch:true`) instead of
   reusing another band's numbers.
6. **BuildPage/GapPage were not edited.** The disable/batch/restore and Board
   overlay contracts above are ready for their owner; until wired, Build keeps
   its existing sequential remove and exclusion UI.
7. **`migrateLocalPrefs` runs from Settings/Practice** (the pages this batch
   owns). Other pages receive the server mirror through `ProfileProvider`
   hydration; no preference is written only to localStorage any more.
8. **`/user` and `/settings` share one writer** but `users` still mirrors four
   rating columns for `/me` compatibility; `settings` is canonical.

---

## 7. D-ID checklist

- [x] **D012** — `complete-once`, `complete-every`, `entire-line` queues + per-session replay; `session.style`; test “review styles change the session queue”.
- [x] **D016** — `mode=common` derived from captured candidate incidence, `/learn.common`, Learn row, `task.common`; test “next common moves…”.
- [x] **D020** — wrong attempts return a legal `refutation` (SAN/UCI/from/to/EPD/explanation/engine); practice draws it as a red arrow; tests “wrong moves return a real refutation” + hanging-queen unit.
- [x] **D033** — Practice renders hint, revealed-answer, plan (`task.planArrows`) and refutation arrows/highlights; Board props documented.
- [x] **D052** — reversible `branches/disable` + `branches/enable` + `branch_states`; queue/stats exclude subtree, review state preserved; test asserts counts and restore.
- [x] **D053** — transactional `DELETE /branches` batch with dry-run + snapshot + `branches/restore`; test dry-run/apply/restore.
- [x] **D090** — real card panel (FSRS difficulty, expected-wrong %, seen count, last grade, next due/interval) and post-attempt `card`; test asserts grade/interval/lapse.
- [x] **D135** — `ratingSystem`/`singleElo`/`eloRange`/`coverageGoal` persisted and exposed; `/me` profile; band mismatch hides incidence; coverage drives gap/trim/common; test round-trip + band gating.
- [x] **D140** — `practiceMode` stored on the session; whole-lines expands the queue server-side; test cards vs whole-lines totals.
- [x] **D142** — pause-after-move honours the server setting; also pause-on-fail/note/low-score hold the board; verified by code path and settings round-trip.
- [x] **D143** — five board appearances (`green`, `blue`, `brown`, `lichess-green`, `chesscom-green`) accepted by server, Board, Settings previews and CSS.
- [x] **D144** — piece set is explicit and singular: `PIECE_SETS` metadata, Settings “only bundled set” copy, Board `pieceSet` prop with safe fallback.
- [x] **D156** — review style + pause switches persist in SQLite and shape the session/card UI; test round-trip + queue.
- [x] **D178** — pieces scaled to 96.5% with a soft drop shadow in shared CSS; mobile layout untouched.
- [x] **D184** — Settings rows show a value chip and chevron; every value opens a sheet with checkmarked choices (existing sheet set retained).
- [x] **D191** — Board accepts `arrows`/`highlights` with `plan`/`hint`/`refutation`/`last`/`wrong` kinds; Practice uses them and the builder/gap can pass them without editing Board.
- [x] **D197** — `settings` is the single source of truth for rating/coverage/review/board/sound preferences; client is a mirror with a one-time migration; `/user` writes through the same store.
