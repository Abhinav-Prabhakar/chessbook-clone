# Audit remediation progress

Tracking every divergence in `AUDIT.md`. A task is checked only after the owning
subagent has implemented it, run its own verification, and reported back.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified · `[!]` blocked

## Batch 1 — server core training engine

Owner: `server-core` (server/db.js, server/api.js, server/srs.js, server tests)
Report: `audit/progress/01-server-core.md`

- [x] D001 practice walks the line move-by-move (server contract)
- [x] D002 opponent auto-reply from the line
- [x] D003 per-position review state (EPD + SAN)
- [x] D004 `due` mode terminates when nothing is due
- [x] D005 `all` mode terminates
- [x] D006 `weak` requires a real wrong attempt
- [x] D007 wrong answer does not decrement due
- [x] D008 wrong answer does not change next line
- [x] D009 FSRS-style scheduling per move
- [x] D010 training rating model
- [x] D021 server-side legality validation
- [x] D022 per-move review history / upload
- [x] D024 skip / keep / reset session actions
- [x] D025 alternate responses at a position
- [x] D026 session starts at first due move
- [x] D028 correct streak calculation + highest/last
- [x] D029 mistake queue source
- [x] D035 builder returns real candidate list
- [x] D036 masters percentage data
- [x] D037 engine eval data
- [x] D038 peer results data
- [x] D039 incidence / play-rate data
- [x] D044 autofill inserts moves
- [x] D054 adding a move creates a real branch
- [x] D055 new moves are saved
- [x] D056 new moves are not immediately due
- [x] D057 dynamic completion denominator
- [x] D058 real completion/mastery formulas
- [x] D059 repertoire characteristics data
- [x] D061 repertoire rename/delete/clone
- [x] D063 PGN import
- [x] D064 export
- [x] D065 transposition handling
- [x] D071 biggest-gap algorithm
- [x] D072 gap candidates ordered by incidence
- [x] D079 gap heading move/side
- [x] D094 model-game history data
- [x] D095 correct seeded model game
- [x] D096 daily model-game selection
- [x] D097 random game
- [x] D102 model game review
- [x] D103 progress validation
- [x] D120 supplementary EPD data
- [x] D123 position annotations/plans
- [x] D124 pre-made repertoires data
- [x] D129 openings report API
- [x] D130 FEN search
- [x] D134 rating profile fields
- [x] D135 rating/coverage reach the backend
- [x] D153 reset clears attempts
- [x] D196 profile fields the trainer needs
- [x] D197 single settings source of truth
- [x] D198 migrations
- [x] D199 openings import versioning
- [x] D200 APIs for missing features
- [x] D204 FSRS/review-log tables
- [x] D205 idempotent attempts
- [x] D206 date handling
- [x] D207 model progress completed state
- [x] D208 delete repertoire API
- [x] D209 PGN import/export APIs
- [x] D221 data-integrity checks

## Batch 2 — client core (parallel)

### `practice-ui` — PracticePage, LearnPage, Board, types
Report: `audit/progress/02-practice-ui.md`

- [ ] D001/D002 practice UI walks line and shows opponent replies
- [ ] D007/D008 wrong-answer UI never advances/decrements
- [ ] D011/D012 whole-line vs individual-move modes
- [ ] D013 review modes in Learn
- [ ] D014 resume session
- [ ] D015 early review
- [ ] D016 next common moves
- [ ] D018 per-move notes display
- [ ] D019 hint wording/behaviour
- [ ] D020 refutation display
- [ ] D023 view-in-build keeps position
- [ ] D024 skip/keep/start-over actions
- [ ] D025 alternate response flow
- [ ] D027 daily goal progress
- [ ] D030 remove clone toast
- [ ] D031 remove extra practice footer
- [ ] D032 drag-and-drop + promotion
- [ ] D033 arrows/highlights
- [ ] D034 play training game from here
- [ ] D083/D084 Learn counts
- [ ] D085–D091 Learn modes and cards
- [ ] D092 mastery formatting
- [ ] D093 empty-due state
- [ ] D145 piece animation setting
- [ ] D172–D179 practice visual fidelity
- [ ] D194/D195 board accessibility/drag cursors

### `builder-gap` — BuildPage, GapPage
Report: `audit/progress/02-builder-gap.md`

- [ ] D040 candidate annotations
- [ ] D041/D042/D043 inline ranked candidate list
- [ ] D045/D046/D047 style autofill + autofill this gap
- [x] D048 exclude moves flow
- [x] D049 next gap in line
- [ ] D050 plans button
- [ ] D051 notes editor
- [ ] D052/D053 disable/remove branch UX
- [ ] D060 `?line=` opens position
- [ ] D067 move navigation
- [ ] D068/D182 breadcrumbs
- [ ] D069 build/practice from here
- [ ] D070 add-note prompt
- [ ] D073–D078 gap rows/actions
- [ ] D080/D081 notes + coverage context
- [ ] D082 remove extra sections
- [ ] D180/D181 candidate columns + add modal
- [ ] D183 gap sidebar noise

### `dashboard-settings` — Dashboard, Settings, Repertoire, Add
Report: `audit/progress/02-dashboard-settings.md`

- [x] D059 real characteristics display
- [ ] D061 repertoire list/rename/delete/clone UI
- [x] D062 chapters/sections
- [ ] D063/D064 import/export UI
- [x] D066 trim tools
- [ ] D107 document `/` entry behaviour
- [ ] D108 daily reviews list
- [ ] D109/D110/D111 openings report / connect-account cleanup
- [ ] D112/D113 home tasks
- [ ] D114 feedback/share parity
- [ ] D115 model-game row
- [ ] D117 streak panel
- [ ] D118/D119 repertoire list + back affordance
- [ ] D134 rating sheet
- [ ] D136 coverage goal effect
- [ ] D137 external accounts cleanup
- [ ] D138–D142 settings no-ops
- [ ] D143/D144 board appearance + piece sets
- [ ] D148 sound options
- [ ] D149 haptics
- [ ] D150 recommended moves size
- [ ] D151 remove subscription row
- [ ] D154/D155 settings row set + sheets
- [ ] D156/D157 review style + notifications

### `visual-fidelity` — app.css + mobile composition
Report: `audit/progress/02-visual-fidelity.md`

- [ ] D171/D186/D187 mobile clipped board + sheet
- [ ] D188–D190 mobile stats/top bar/coords
- [ ] D191 board arrows styling
- [ ] D192 loading skeletons
- [ ] D193 landing nav parity
- [ ] D180–D185 visual alignment shared CSS

## Batch 3 — model games

Owner: `model-games` (ModelPage.tsx + model server data)
Report: `audit/progress/03-model-games.md`

- [x] D094 model-game history UI
- [x] D095 correct game
- [ ] D096/D097 daily + random
- [x] D098 history screen
- [ ] D099 interactive guess-the-move
- [ ] D100 real hints
- [x] D101 eval graph
- [x] D102 game review UI
- [x] D103 progress stats
- [x] D104 model source setting
- [x] D105 opening link
- [x] D106 player ratings/annotations

## Batch 4 — missing screens (parallel, new files)

### `play-features` — training games + puzzles
- [ ] D158 training games vs bot
- [ ] D159 blunder puzzles
- [ ] D160 intuition builder
- [ ] D161 visualization
- [ ] D162 vision
- [ ] D200/D202/D203 supporting APIs/engine

### `content-surfaces` — openings guides, coaches, blog, repertoires
- [ ] D061 `/repertoires` list
- [ ] D120–D133 opening data/guides/reports
- [x] D163 opening guide routes
- [x] D164 coaches routes
- [x] D165 blog routes
- [ ] D166 production slug URLs
- [ ] D167 onboarding/welcome
- [ ] D169 help links

## Batch 5 — hardening

Owner: `hardening` (tests, docs, errors, offline)
Report: `audit/progress/05-hardening.md`

- [ ] D168/D217 residual entitlement chrome removed
- [ ] D170 404 parity
- [ ] D210 error boundary
- [ ] D211 offline writes
- [ ] D212 README honesty
- [ ] D218 unit/API tests
- [ ] D219 API contract tests
- [ ] D220 main-flow E2E
- [ ] D222 duplicate fetch cleanup
- [ ] D223/D224 seed data real
- [ ] D225 feedback links
