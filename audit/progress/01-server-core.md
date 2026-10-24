# Batch 1 — server core training engine

Owner: `server-core`
Scope: `server/db.js`, `server/api.js`, `server/index.js`, new `server/*.js`,
new `tests/server/**`, plus the notes/session/alternate-response endpoints the
client agents need.

Status: **implemented and verified**. No client file, `package.json`, or
`server/data/chessbook.db` was modified. Nothing was committed.

---

## What changed

### Data model (migration v1)

`server/schema.js` adds a real `PRAGMA user_version` migration and applies it
automatically when the process starts:

| Table | Purpose |
|---|---|
| `line_moves` | One row per unique **(repertoire, EPD, SAN)**. Stores board FEN, ply, move number, side, `is_user`, UCI, and the complete per-move review state: `state`, `stability`, `difficulty`, `lapses`, `reps`, `wrong_count`, `last_correct`, `due_at`, `last_review`, `kept`, `learned`. |
| `reviews` | Immutable review log: `epd`, `ply`, `san`, `played_san`, `side`, `correct`, `grade`, `mode`, `daily`, `session_id`, `submission_id UNIQUE`, `response_json`, `created_at`. |
| `practice_sessions` | Persisted sessions: `queue` (JSON array of EPDs), `seen`, `cursor`, counters, status, timestamps. |
| `notes` | Position notes (`san = ''`) and per-move notes (`san = <move>`), unique per `(repertoire, epd, san)`. |

`users` gains `training_rating`, `training_rating_deviation`,
`training_rating_volatility`, `current_streak`, `highest_streak`,
`last_streak_date`. `model_progress` gains `completed`, `reviewed`, `score`,
`completed_at`, `reviewed_at`, `updated_at`.

The migration **backfills `line_moves` from every existing line** and maps old
`attempts` rows into `reviews` (with `submission_id = legacy-attempt-N`). It is
tested against a real copy of `server/data/chessbook.db`:
100 lines → 458 `line_moves`, 6 legacy reviews, `PRAGMA user_version = 1`,
integrity clean.

`CHESSBOOK_DB=/path/to/file.db` overrides the database (used by all tests).
`CHESSBOOK_SKIP_OPENINGS=1` skips the 3,865-row ECO import in tests.

### Scheduler

`server/srs.js` is a dependency-free FSRS-4.5 implementation:

- 17 published default weights, initial stability/difficulty by grade.
- Retrievability `R(t,S) = (1 + 19/81 · t/S)^-0.5`.
- Difficulty mean-reverts; stability grows on Hard/Good/Easy, drops on Again.
- Interval targets 90% retention; mastery = stability ≥ 21 days.
- Deterministic: card + grade + timestamp → same state.
- Training rating: Glicko-lite; a move's difficulty (1–10) is the problem
  rating, correct raises / wrong lowers the rating, deviation narrows.
- A **wrong attempt** is deliberately not FSRS grade 1: it increments
  `lapses`/`wrong_count` and difficulty but does not change `due_at`,
  stability, reps, or `learned`, so the queue cannot advance on a miss.

### Practice engine

- A session queue contains **positions** (EPDs) where it is the repertoire
  colour's turn, derived from every saved line.
- Every task returns the exact board (`fen`), the expected SAN, **all saved
  alternative SANs at that position**, the full prefix of the line (for
  display/animation), and the immediate opponent reply (`autoReply`) that was
  auto-played to reach the position.
- Attempts are validated with `chess.js` from the task FEN; the client SAN is
  only an identifier. Illegal moves → **422**; a stale EPD → **409**.
- Correct answers apply FSRS to the move that was actually played (including
  an accepted alternate) and advance the session one position.
- Wrong answers are logged (idempotently) and leave the position, counters and
  due count unchanged.
- `due` builds only actually-due positions and is `complete: true` with
  `line:null / task:null` when empty.
- `all` walks every user-turn position in line order, so it terminates.
- `weak` requires at least one incorrect review **and** that the latest review
  for the move is still incorrect; it never includes unattempted moves.
- `specific`/`line` take `lineIds`; `early` returns scheduled moves early.
- `skip`, `keep`, `pause`, `resume`, `reset`, `abandon` are persisted.
- Notes are embedded in every task (`note`, `moveNote`) so the practice UI can
  show “No notes added” or the saved note without another request.

### Seed

`server/db.js` now seeds a curated, real repertoire: 16 White lines and 14
Black lines (Najdorf, Open/Kan/Closed Sicilian, Italian, Ruy Lopez, French,
Caro-Kann, Scandinavian, QGD, KID, QID, Nimzo, English, Catalan, Bishop’s
Opening, London, Slav, Dutch). Every seeded line:

- is `saved = 1`;
- has `due_at = NULL` (newly added moves are never immediately due);
- has no invented `learned`/`mastered` state;
- has no fake attempts, no fake hash stats and no fake percentages.

A fresh install therefore has `due = 0`, `completion = 0`, `mastery = 0`, and
`mode=all` is the first-practice path. The old pseudo-random 50-opening
repertoire and the seeded `"e4"` wrong attempts are gone. `total_lines` is
recomputed instead of hard-coded 50.

### Dates / streaks

- All timestamps are normalised to ISO-8601 UTC; SQL comparisons use
  `julianday()`, not string comparison.
- `PATCH /lines/:id` rejects an unparseable `dueAt` with 400.
- Streak is computed from **local days** using a caller-supplied `tzOffset`
  (JS `getTimezoneOffset()` convention: IST = `-330`). A streak ending
  yesterday is still current; `highest` and `lastStreakDate` are returned.
- Daily reviews/correct/wrong, goal and `goalMet` are derived from `reviews`.

### Integrity

`server/integrity.js` + `GET /api/integrity` validate:

- SQLite integrity and foreign keys;
- every line is legal, its PGN history equals `moves`, `fen` is the position
  before the last move, `expected_san` is the last move, `side` matches;
- every line move exists in `line_moves` with the right EPD/owner;
- every stored move’s SAN is legal from its own FEN and its turn side agrees;
- every review points at a real move with matching EPD/SAN;
- session JSON/queue/seen/cursor consistency;
- notes have valid EPDs;
- reported `due` equals the actual due move rows.

The server tests assert `ok === true`; a deliberately corrupted line is
rejected in the migration/integrity test.

---

## API reference

All routes are under `/api`. No auth. Error responses:
`400 {error}`, `404 {error}`, `409 {error, code}`, `422 {error, code, ...}`.

### Preserved endpoints

Every previous endpoint still exists and keeps its old response fields:
`GET /me`, `PATCH /user`, `GET /dashboard`, `GET|POST /repertoires`,
`GET|PATCH /repertoires/:key`, `GET /repertoires/:key/learn`,
`GET /repertoires/:key/gap`, `POST /repertoires/:key/autofill`,
`POST /repertoires/:key/lines`, `PATCH|DELETE /lines/:id`, `GET /openings`,
`GET /practice/next`, `POST /practice/attempt`, `GET /model-games`,
`POST /model-games/:id/progress`, `GET|PATCH /settings`,
`POST /repertoires/:key/reset`, `GET /health`.

New fields were added to old responses; old fields were not repurposed.

### Repertoire stats (returned by `/repertoires`, `/repertoires/:key`, sessions, attempts)

```json
{
  "id": 1,
  "color": "white",
  "name": "White openings",
  "description": "…",
  "totalLines": 16,
  "lineCount": 16,
  "moveCount": 69,
  "positionCount": 62,
  "learned": 1,
  "mastered": 0,
  "learnedPositions": 1,
  "masteredPositions": 0,
  "saved": 16,
  "due": 0,
  "duePositions": 0,
  "fresh": 68,
  "completion": 2,
  "mastery": 0,
  "moveCompletion": 1,
  "moveMastery": 0,
  "characteristics": {
    "available": false,
    "effectiveness": null,
    "soundness": null,
    "learnability": null,
    "avgCpLoss": null,
    "expectedResults": null,
    "sharpness": null
  },
  "coverage": null
}
```

- `completion`/`mastery` are **position-level** (`learnedPositions /
  positionCount`, `masteredPositions / positionCount`).
- `moveCompletion`/`moveMastery` are the move-level equivalents.
- `due` is a **move** count (what Chessbook’s “N due” shows); `duePositions`
  and a session’s `remaining` count positions. They differ only when one
  position has several saved moves due.
- `characteristics`/`coverage` are explicit “unavailable” values; no hashes.

### `Line` objects (`/repertoires/:key`, `/learn`, legacy `/practice/next`)

The legacy shape is intact plus move-level fields:

```json
{
  "id": 1, "openingId": null, "name": "Sicilian Defense: Najdorf Variation",
  "moves": ["e4", "c5", "Nf3", "d6", "…"],
  "pgn": "1. e4 c5 2. Nf3 d6 …",
  "fen": "…",
  "side": "white",
  "expectedSan": "h3",
  "learned": false,
  "mastered": 0,
  "saved": true,
  "dueAt": null,
  "due": false,
  "wrong": 0,
  "ply": null, "moveNumber": null, "epd": null, "lineMoveId": null,
  "fullMoves": ["e4", "c5", "…"],
  "moveCount": 6, "movesLearned": 1, "movesDue": 0
}
```

In `/learn` the queue contains **one view per position**, with `ply`, `epd`,
`alternatives: string[]`, `due` and `wrong` set from move state.

### Sessions

#### `POST /practice/sessions`

Request:

```json
{
  "repertoire": "white",
  "mode": "due|all|weak|early|specific|line",
  "lineId": 12,
  "lineIds": [12, 13],
  "resume": false
}
```

`repertoire` accepts `white`/`black` or a numeric id. `lineId`/`lineIds` are
required for `specific`/`line`. `resume:true` returns the most recent active
session for that repertoire/mode instead of creating one.

Response `201` (or `200` when resumed):

```json
{
  "session": {
    "id": "uuid",
    "repertoireId": 1,
    "mode": "all",
    "status": "active|paused|complete",
    "total": 62,
    "remaining": 62,
    "answered": 0,
    "correct": 0,
    "wrong": 0,
    "skipped": 0,
    "cursor": 0,
    "complete": false,
    "createdAt": "2026-10-24T…Z",
    "updatedAt": "2026-10-24T…Z",
    "completedAt": null
  },
  "task": { "…Task…" },
  "autoReply": null,
  "resumed": false,
  "repertoire": { "…stats…" }
}
```

When nothing is due/weak: `status:"complete"`, `remaining:0`, `complete:true`,
`task:null`, HTTP 201.

#### Task object

```json
{
  "epd": "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -",
  "fen": "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 0 3",
  "ply": 3,
  "moveNumber": 2,
  "side": "black",
  "expectedSan": "d6",
  "acceptableSans": ["d6", "Nc6", "e6"],
  "alternatives": [
    {
      "san": "d6", "sanKey": "d6", "lineMoveId": 12, "lineId": 5,
      "lineName": "Sicilian Defense: Najdorf Variation",
      "epd": "…", "ply": 3,
      "dueAt": null, "due": false,
      "stability": 0, "difficulty": 0, "lapses": 0, "reps": 0,
      "state": "new", "learned": false, "kept": false, "note": null
    }
  ],
  "lineId": 5,
  "lineName": "Sicilian Defense: Najdorf Variation",
  "lineMoveId": 12,
  "fullMoves": ["e4", "c5", "Nf3", "d6", "…"],
  "prefix": [
    { "ply": 1, "moveNumber": 1, "san": "e4", "uci": "e2e4",
      "from": "e2", "to": "e4", "fen": "…before e4…", "after": "…after e4…",
      "epd": "…", "side": "white" }
  ],
  "autoReply": { "…same shape as prefix[] entry, last auto-played move…" },
  "note": { "id": 1, "epd": "…", "san": null, "note": "…",
            "createdAt": "…", "updatedAt": "…" },
  "noteText": "…" ,
  "moveNote": null,
  "dueAt": null,
  "due": false,
  "kept": false,
  "review": {
    "stability": 0, "difficulty": 0, "lapses": 0, "reps": 0,
    "state": "new", "lastReview": null, "wrongCount": 0
  }
}
```

`prefix` is every move before the task (replay it or jump straight to `fen`).
`autoReply` is the last prefix move, i.e. the opponent reply that was
auto-played. All of `prefix`/`autoReply` are freshly replayed from the line.

#### `GET /practice/sessions/:id` and `GET /practice/sessions/:id/current`

Return `{session, task, autoReply, repertoire}`. `/current` is the cheap poll
for “resume where I left off”; if no session exists it returns 404.

#### `GET /practice/sessions?repertoire=white&status=active|paused|complete|all`

`{sessions:[Session]}`.

#### `GET /practice/sessions/latest?repertoire=white`

`{session|null, task|null, autoReply|null, repertoire}` — latest **active**
session only.

#### `POST /practice/sessions/:id/attempt`

Request:

```json
{
  "san": "Nc6",
  "epd": "…optional, must match the current position…",
  "submissionId": "client-uuid",
  "grade": 3,
  "hint": false,
  "tzOffset": -330
}
```

`submissionId` is optional but strongly recommended; reusing it returns the
original response with `idempotent:true` and applies nothing twice. `grade`
(1–4) is optional; `hint:true` maps a correct answer to Hard (2), otherwise a
correct answer is Good (3).

Success response:

```json
{
  "correct": true,
  "idempotent": false,
  "expectedSan": "Nc6",
  "playedSan": "Nc6",
  "acceptableSans": ["d6", "Nc6", "e6"],
  "alternatives": [ "…Task.alternatives…" ],
  "position": { "epd": "…", "fen": "…", "ply": 3, "moveNumber": 2,
                "side": "black", "lineId": 6,
                "lineName": "Sicilian Defense: Accelerated Dragon" },
  "grade": 3,
  "scheduled": {
    "stability": 3.7145, "difficulty": 5.1618, "lapses": 0, "reps": 1,
    "state": "review", "intervalDays": 3.714,
    "dueAt": "2026-10-27T…Z", "lastReview": "2026-10-24T…Z"
  },
  "lapse": null,
  "training": { "rating": 1207.4, "deviation": 348.1, "volatility": 0.0621 },
  "daily": { "…dailySummary…" },
  "retry": false,
  "autoReply": { "…opponent move auto-played after this answer…" },
  "remaining": 41,
  "complete": false,
  "next": {
    "task": { "…next Task or null…" },
    "autoReply": { "…same as top-level autoReply…" },
    "remaining": 41,
    "complete": false
  },
  "session": { "…Session…" },
  "stats": { "…stats…" },
  "reviewId": 42,
  "submissionId": "client-uuid"
}
```

Wrong answer (HTTP 200, still correct = false):

```json
{
  "correct": false,
  "expectedSan": "d6",
  "playedSan": "h5",
  "retry": true,
  "scheduled": null,
  "lapse": { "difficulty": 6.73, "lapses": 1,
             "lastReview": "…", "lastCorrect": 0 },
  "next": { "task": { "…same position/task…" }, "autoReply": null },
  "session": { "…remaining unchanged…" },
  "stats": { "…due unchanged…" }
}
```

Illegal move `422`:

```json
{
  "error": "Illegal move Qh5 in this position",
  "code": "illegal_move",
  "position": { "epd": "…", "fen": "…" },
  "expectedSan": "Nf3",
  "acceptableSans": ["Nf3"],
  "legalMoves": ["a3", "a4", "b3", "…"]
}
```

Stale position `409`:

```json
{
  "error": "That move does not belong to the current position",
  "code": "position_mismatch",
  "expectedEpd": "…",
  "expectedFen": "…"
}
```

Completed session `409`: `{error, code:"session_complete", session, task:null}`.

#### Session actions

| Route | Body | Response |
|---|---|---|
| `POST /practice/sessions/:id/pause` | — | `{session}` |
| `POST /practice/sessions/:id/resume` | — | `{session, task, autoReply, repertoire}` |
| `POST /practice/sessions/:id/reset` | — | `{session, task, autoReply, repertoire}` (clears `seen`, cursor and counters; “I changed my mind, start over”) |
| `POST /practice/sessions/:id/skip` | — | `{session, task, autoReply, skipped: epd, repertoire}`; marks the position seen but does **not** mark it learned |
| `POST /practice/sessions/:id/keep` | — | `{session, task, autoReply, kept: epd, keptSan, repertoire}`; sets `kept=1`, `due_at=now` on the current move, then advances |
| `DELETE /practice/sessions/:id` | — | `{ok:true, deleted}` |

### Notes (D018/D051/D070)

#### `GET /repertoires/:key/notes?epd=<epd>&san=<san>`

`{notes:[{id, epd, san|null, note, createdAt, updatedAt}]}`. Without `epd`
returns every note in the repertoire; without `san` returns position + move
notes at that position.

#### `PUT /repertoires/:key/notes`

```json
{ "epd": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
  "san": "e4", "note": "Take the centre." }
```

`san` is optional (omit/empty = position note). An illegal `san` is a 400; an
empty/whitespace note deletes the note. Response:
`{note:{id,epd,san|null,note,createdAt,updatedAt}}` or
`{note:null,deleted:true}`.

#### `DELETE /notes/:id` → `{ok:true, deleted}`

### Position / alternates (D025)

#### `GET /repertoires/:key/position?epd=<epd>` (or `?fen=<fen>`)

```json
{
  "repertoire": { "…stats…" },
  "position": {
    "epd": "…",
    "fen": "…",
    "side": "black",
    "moves": [
      { "san": "d6", "lineMoveId": 12, "lineId": 5,
        "lineName": "Najdorf", "ply": 3, "dueAt": null, "due": false,
        "stability": 0, "difficulty": 0, "lapses": 0, "reps": 0,
        "state": "new", "learned": false, "kept": false, "note": null }
    ],
    "notes": [ "…notes…" ]
  }
}
```

Also available from every Task as `acceptableSans` + `alternatives`.

### Mistakes (D029)

`GET /repertoires/:key/mistakes`

```json
{
  "source": "local-reviews",
  "online": null,
  "onlineAvailable": false,
  "count": 2,
  "mistakes": [
    { "epd": "…", "fen": "…", "ply": 3, "side": "black",
      "expectedSan": "d6", "acceptableSans": ["d6","Nc6","e6"],
      "lineId": 5, "lineName": "Najdorf",
      "alternatives": [ "…Task.alternatives…" ] }
  ]
}
```

A mistake is a move with a real incorrect review whose latest review is still
incorrect. No unattempted moves, no `mastered < 80` fallback. `online` is
explicitly unavailable (no Lichess import in this build).

### Review history and upload (D022)

#### `GET /practice/reviews?repertoire=white&epd=…&limit=100`

```json
{
  "reviews": [
    { "id": 42, "epd": "…", "ply": 3, "san": "d6", "playedSan": "h5",
      "side": "black", "correct": false, "grade": null, "mode": "due",
      "daily": "2026-10-24", "sessionId": "uuid", "submissionId": "…",
      "lineId": 5, "lineName": "Najdorf", "createdAt": "…" }
  ],
  "stats": { "…stats…" } | null
}
```

#### `POST /practice/reviews`

Batch/offline upload; each entry is idempotent by `submissionId`.

```json
{
  "tzOffset": -330,
  "reviews": [
    { "epd": "…", "san": "Nf3", "correct": true, "grade": 3,
      "submissionId": "upload-1", "mode": "upload", "repertoire": "white" }
  ]
}
```

Response: `{results:[{ok,idempotent,epd,san,correct,scheduled,reviewId,submissionId}|{ok:false,epd,error}]}`.

### Daily / streak (D028, supports D027)

`GET /practice/daily?tzOffset=-330`

```json
{
  "daily": {
    "date": "2026-10-24",
    "reviews": 12,
    "correct": 11,
    "wrong": 1,
    "goal": 50,
    "goalMet": false,
    "remaining": 38,
    "streak": { "current": 3, "highest": 7,
                "lastStreakDate": "2026-10-24", "today": "2026-10-24" }
  }
}
```

`GET /stats/streak?tzOffset=-330` → `{streak, daily}`.

`GET /me` now also returns:
`{user:{…, trainingRating, training:{rating,deviation,volatility},
currentStreak, highestStreak, lastStreakDate, streak, daily}}`.

`GET /dashboard?tzOffset=-330` keeps `tasks.streak` (current) and adds
`streak` + `daily`.

### Adding moves / branches (supports D054/D055)

#### `POST /repertoires/:key/moves`

```json
{ "epd": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
  "san": "b3", "name": "Queen's fianchetto" }
```

Creates/extends a real branch, stores `saved=1`, `due_at=NULL`, derives
`line_moves`, updates `total_lines`. Duplicate → `created:false` with the
existing line. Response: `{line, repertoire, created}`.

`POST /repertoires/:key/lines` also now:

- stores `saved=1` and `due_at=NULL` (D055/D056);
- derives all line moves after insert (D054);
- recomputes `total_lines`;
- returns `{line, repertoire, created, lineMoves}`;
- accepts `openingId`, `pgn`, or `moves: string[]`;
- rejects a line that ends on the wrong colour and exact duplicates.

`DELETE /lines/:id` rebuilds `line_moves` and totals. `DELETE
/repertoires/:key` was added (`{ok, deleted}`), and
`GET /repertoires/:key` accepts numeric ids or `white`/`black`.

### Reset (D153)

`POST /repertoires/:key/reset` → `{ok:true, repertoire}`

Deletes `reviews`, `attempts` and `practice_sessions` for the repertoire and
resets every `line_moves` scheduling field. Saved moves/lines are preserved
(unlike the old reset, which set `saved=0`).

### Model progress (D207)

`GET /model-games` keeps `progress` as the ply number and adds:

```json
"progressState": {
  "ply": 20, "total": 20, "percent": 100,
  "completed": true, "reviewed": true, "score": 80,
  "completedAt": "…", "reviewedAt": "…", "updatedAt": "…"
}
```

`POST /model-games/:id/progress`

```json
{ "ply": 20, "reviewed": true, "score": 80 }
```

→ `{ok:true, ply, progress:{…progressState…}}`. `ply` is clamped to the PGN
length; a request beyond the last ply is `400 {code:"ply_out_of_range",
total}`. `GET /model-games/:id` returns the game with `moves` and
`progressState`.

### Integrity (D221)

`GET /integrity` →

```json
{
  "ok": true,
  "checkedAt": "2026-10-24T…Z",
  "counts": { "repertoires": 2, "lines": 30, "lineMoves": 252,
              "reviews": 0, "sessions": 0, "notes": 0 },
  "errors": [ { "code": "illegal_move", "message": "…", "lineId": 7 } ]
}
```

### Legacy practice endpoints

`GET /practice/next?repertoire=white&mode=due|weak|all&line=<id>` and
`POST /practice/attempt` still work and now operate on per-move state.

`GET /practice/next` returns `{line, task?, stats, remaining, complete}` where
`line` is a **line view truncated to the target ply** (`moves` = prefix +
target, `fen` = position before the target, `expectedSan` = target). Legacy
clients can therefore keep practising one move at a time without changing
their code.

`POST /practice/attempt` accepts the old `{lineId, san, mode}` and adds
`{epd?, submissionId?, grade?, hint?, tzOffset?}`. If `epd` is absent, the
server maps the posted SAN to a saved move in that line first, then falls back
to the first unreviewed move (or first due move in `due` mode). Response keeps
`{correct, expectedSan, playedSan, line, next:{line, stats, remaining,
complete}, stats}` and adds `scheduled`, `lapse`, `acceptableSans`,
`alternatives`, `position`, `autoReply`, `next.task`, `next.remainingDue`,
`training`, `daily`, `reviewId`, `submissionId`.

`PATCH /lines/:id` still updates the legacy `lines` columns; scheduling is
owned by `line_moves` (a reveal/learned patch no longer fabricates SRS state).
`PATCH /lines/:id` with an invalid `dueAt` is a 400.

---

## Caveats / deliberate decisions

1. **Alternates share a position task.** At a position with several saved
   moves, the queue contains one task; `acceptableSans` lists all saved moves
   and any of them is correct. Only the played move is scheduled, so other
   alternatives remain `new` until separately reviewed. `stats.due` counts
   moves, while session `remaining` counts positions.
2. **Wrong answers never advance.** They are recorded as lapses (difficulty,
   `lapses`, `wrong_count`) but do not touch `due_at`, stability, reps,
   `learned`, `remaining` or the cursor. Retrying is the same task.
3. **Mastery** = stability ≥ 21 days. With Good answers it takes several
   reviews to reach; a single pass through “all moves” yields 100% completion
   but low mastery.
4. **Keep** only schedules the current task’s primary move, then advances;
   it does not claim a successful recall.
5. **Skip** marks the position seen for this session only; it never marks the
   move learned.
6. **Seed has no review history.** A fresh install honestly shows 0 due/0
   learned. Use `mode:"all"` for the first practice. Existing databases keep
   their `saved` flags and have their real attempts backfilled; fabricated
   `learned/mastered` columns are no longer used for stats.
7. **No engine/peer/incidence data.** `characteristics` and `coverage` are
   explicit `null`/`available:false` rather than hashes. The gap endpoint also
   returns `eval/masters/peers/incidence: null`.
8. **Time zones:** pass `tzOffset` (JS `getTimezoneOffset()` minutes). The
   persisted `users.current_streak` etc. are updated on each review using the
   supplied offset; `GET /dashboard` recomputes and re-persists.
9. **Openings import** (versioning, D199) and big data workstreams are out of
   this scope. `CHESSBOOK_SKIP_OPENINGS=1` exists for fast tests.
10. **Sessions are snapshots.** A session queue is built at creation; adding
    lines mid-session does not inject new tasks (resume/reset rebuilds only
    the seen/cursor state). This keeps termination deterministic.

---

## Verification

All verification was run locally; no server was left running and nothing was
committed.

### 1. Full loop against a temp DB (Node driver over HTTP, `PORT=8797`)

Fresh DB from the curated seed, 62 assertions passed, including:

- `due` with nothing due → `complete:true`, `line:null`, `task:null`;
- `all` session starts at `1.e4`, accepts `e4`, auto-plays `c5`, asks `2.Nf3`;
  accepts `Nf3`, auto-plays `d6`, asks `3.d4`;
- a legal-but-unsaved `h3` is wrong; `remaining`, `stats.due` and the task EPD
  do not change, `retry:true`;
- illegal SAN → 422 `illegal_move`; wrong EPD → 409 `position_mismatch`;
- repeated `submissionId` → `idempotent:true` and exactly one review row;
- the same session completes (`remaining:0`, `complete:true`) and `due` is 0;
- `weak` starts at the position answered wrong and excludes unattempted
  positions; solving it empties the weak queue;
- `repeat /practice/reviews` history is real; reset clears reviews, attempts,
  sessions and the weak queue while keeping saved lines;
- pause/resume/latest/skip/keep/reset all work;
- a kept position becomes due, the due session completes and `due` returns 0;
- at `1.e4 c5 2.Nf3` (Black) `acceptableSans` is `["d6","Nc6","e6"]` and
  playing `Nc6` when the primary is `d6` is accepted;
- notes round-trip and appear on the task (`note`/`moveNote`/alternative
  notes), illegal move notes are 400;
- adding `b3` creates a saved, not-due branch; Saved and totalLines increment;
  duplicate is idempotent; deleting restores the totals;
- streak/daily/training rating respond with derived values;
- model progress records completed/reviewed/score and rejects an out-of-range
  ply with 400;
- legacy `/practice/next` + `/practice/attempt` still work;
- `GET /integrity` → `ok:true`.

### 2. `node --test tests/server`

**33 tests, 33 pass, 0 fail** (`srs.test.js`, `practice.test.js`,
`integrity.test.js`). Coverage includes FSRS determinism/intervals/lapses,
streak time zones, the whole session loop, wrong-answer invariants,
idempotency, legality, alternates, notes, reset, seed honesty, legacy upgrade
and corruption detection.

### 3. Existing database upgrade

`VACUUM INTO` copy of `server/data/chessbook.db` → `CHESSBOOK_DB=/tmp/...`:

- `PRAGMA user_version` 0 → 1;
- 100 lines → 458 `line_moves` (448 user moves);
- 6 legacy attempts → 6 reviews;
- `checkDatabase(db)` → `ok:true`, 0 errors.

### 4. Client build

`npm run build` → `✓ built in 155ms` (45 modules). The untouched client
compiles.

---

## Owned D-ID checklist

Legend: `[x]` implemented + verified.

- [x] **D001** — practice walks each user move: sessions return position tasks (`ply`, `fen`, `prefix`); test e4→Nf3→d4 via `practice.test.js`.
- [x] **D002** — opponent auto-reply: attempt response carries `next.autoReply`; test asserts `c5` then `d6`.
- [x] **D003** — per-position state: `line_moves` keyed by `(repertoire, epd, san_key)` with stability/difficulty/lapses/reps/due; `repertoire.js`.
- [x] **D004** — `due` terminates: `buildQueue("due")` empty → `complete:true`, `task:null`; tested.
- [x] **D005** — `all` terminates: queue is every user-turn EPD, `remaining = queue − seen`; 62-position session completes in test.
- [x] **D006** — `weak` needs a real wrong review whose latest review is still incorrect; unattempted excluded; tested (weak 1 < all 62).
- [x] **D007** — wrong answer does not decrement remaining/due: test asserts unchanged values.
- [x] **D008** — wrong answer does not change the next task: `next.task.epd === position.epd`, `retry:true`.
- [x] **D009** — FSRS per move: `srs.js` + 12 unit tests (stability, difficulty, retrievability, lapses, intervals).
- [x] **D010** — training rating: Glicko-lite `updateTrainingRating`, persisted on every review, exposed in `/me` and attempt responses; tested.
- [x] **D021** — server legality: `findLegalMove` from task FEN; illegal → 422, EPD mismatch → 409; tested.
- [x] **D022** — move-level review log/upload: `reviews` table, `GET /practice/reviews`, `POST /practice/reviews`, every attempt records epd/ply/san/side/correct/daily.
- [x] **D024** — skip/keep/pause/resume/reset/abandon endpoints; behaviour asserted in tests.
- [x] **D025** — alternates: `acceptableSans`/`alternatives`, any saved SAN accepted, `GET /repertoires/:key/position`; tested with `["d6","Nc6","e6"]`.
- [x] **D026** — session starts at the first due move: due queue is ordered by `due_at` and every task carries its full prefix/position.
- [x] **D028** — streak: local-day computation, yesterday keeps the streak, `current/highest/lastStreakDate`, tz offset; 2 unit tests.
- [x] **D029** — mistake queue from real wrong reviews, `GET /repertoires/:key/mistakes`, explicit `online:null/unavailable`; tested.
- [x] **D056** — new moves are not immediately due: `POST /lines` and `/moves` insert `due_at=NULL`; test asserts `due:false`.
- [x] **D057** — dynamic denominator: `total_lines` recomputed on add/delete; stats expose `lineCount`/`moveCount`/`positionCount`; test asserts increments.
- [x] **D058** — real completion/mastery: derived from move SRS (position-level completion, stability ≥ 21 mastery); no hard-coded 50; test asserts 100% after all.
- [x] **D153** — reset clears attempts/reviews/sessions and move scheduling; tested.
- [x] **D198** — migrations: `PRAGMA user_version` migration v1, in-place upgrade + backfill; tested on a real DB copy.
- [x] **D204** — FSRS/review tables: `line_moves` + `reviews` created by migration; counts verified.
- [x] **D205** — idempotent attempts: `submission_id UNIQUE` + stored response; replay returns `idempotent:true`, one row; tested.
- [x] **D206** — dates: ISO normalisation, `julianday()` comparisons, invalid `dueAt` 400, local-day streaks; unit + integration tests.
- [x] **D207** — model progress: `completed/reviewed/score/completedAt/reviewedAt` with clamping; tested.
- [x] **D221** — integrity: `server/integrity.js` + `GET /api/integrity`; clean seeded DB and corrupted-line detection tested.

### Requested adjacent endpoints (not separate D-IDs)

- [x] **D018/D051/D070** — notes: `GET/PUT /repertoires/:key/notes`, `DELETE /notes/:id`, notes embedded in tasks.
- [x] **D014** — session resume: persisted `practice_sessions`, `resume:true`, `/practice/sessions/latest`, pause/resume.
- [x] **D024** — session keep/skip/start-over (above).
- [x] **D025** — alternate responses (above).
- [x] **D027 (server half)** — daily goal/reviews/streak via `/practice/daily` and `/dashboard.daily`; the goal UI remains client-owned.
- [x] **D054/D055 (incidental)** — adding a line/move now creates a derived branch and `saved=1`; `POST /repertoires/:key/moves` supports position-level branches.
- [x] **D208 (incidental)** — `DELETE /repertoires/:key`.

## Files

- `server/schema.js` — migrations, backfill, indexes.
- `server/positions.js` — EPD/SAN derivation, legality, line validation.
- `server/srs.js` — FSRS-4.5 scheduler, lapse handling, training rating.
- `server/dates.js` — ISO normalisation, local-day streaks.
- `server/repertoire.js` — move graph rebuild, stats, tasks, queues, daily.
- `server/integrity.js` — data-integrity audit.
- `server/db.js` — `CHESSBOOK_DB`, bootstrap + migrate, curated seed.
- `server/api.js` — all routes.
- `server/index.js` — `createApp()` / `startServer()` (no listen on import).
- `tests/server/{helpers.js,srs.test.js,practice.test.js,integrity.test.js}`.
