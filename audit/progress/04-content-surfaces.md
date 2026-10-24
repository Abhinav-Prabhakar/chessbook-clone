# Batch 4 — content surfaces (openings, coaches, blog, repertoires, welcome, help)

Owner: `content-surfaces`
Scope: new page files only. No commit. No edits to `app/src/App.tsx`,
`app/src/styles/app.css`, `app/src/components/ui.tsx`, or any pre-existing page.

Status: **implemented and verified**. All 11 pages typecheck, bundle, and render
server-side; the captured content endpoints were exercised against the local
server and returned real data.

---

## What changed

| File | What it does |
|---|---|
| `app/src/pages/OpeningsPage.tsx` | `/openings` — 103 captured guides in White/Black sections, search by name/ECO/PGN, colour filter, optional mini-board preview, captured coverage on rows when present, “Pre-made repertoires” tab with 21 captured courses and working clone, plus the real openings report panel. Also exports the shared `ContentLayout`, `MiniBoard`, `CONTENT_CSS`, `initials`, `slugify` helpers used by the other content pages. |
| `app/src/pages/OpeningGuidePage.tsx` | `/openings/:slug` — real line, ECO/side/family, final-position diagram, two-move groups with a diagram and per-move note where captured, explicit “notes/plans not captured” states, course link, builder link, “Add line to repertoire”, then practice/open links. |
| `app/src/pages/CoachesPage.tsx` | `/coaches` — 3 captured coaches, rating, first-lesson badge, languages, price, platforms, clamped bio + profile link, apply callout, “How this directory works”, approved local applications. Exports the `CoachApplication` type and localStorage helpers. |
| `app/src/pages/CoachPage.tsx` | `/coaches/:slug` — captured profile (bio, rating, languages, price, platform) or an approved local application profile; explicit note that contact details were not part of the capture. |
| `app/src/pages/CoachApplyPage.tsx` | `/coaches/apply` — application form (name, rating, platform, time control, languages, levels, price, bio, contact, free-first-lesson). Persists to `localStorage` under `cb_coach_applications_v1`; states that no server/account is involved. |
| `app/src/pages/CoachReviewPage.tsx` | `/coaches/review` — local review queue with All/Pending/Approved/Rejected filters, approve/reject/reopen/delete, 1900-rating flag, public local profile link, clear-reviewed action. |
| `app/src/pages/BlogPage.tsx` | `/blog` — 9 captured posts, dates, excerpts, working local links. Exports the inline-excerpt renderer and date formatter. |
| `app/src/pages/BlogPostPage.tsx` | `/blog/:slug` — title, publication/date, captured excerpt, explicit “full body was not captured” state. No invented article text. |
| `app/src/pages/RepertoiresPage.tsx` | `/repertoires` — the two local repertoires with real saved/move/position/due counts, completion bars, Open/Build/Practice/Add moves links, new-repertoire and pre-made links. `/repertoires/:slug` aliases by id, colour, stored slug or slugified name and redirects to `/repertoire/:key`; unknown slugs get an explicit not-found state. |
| `app/src/pages/WelcomePage.tsx` | `/welcome` — four-step onboarding: rating (platform/time control/value), playing style, first move from the captured candidate list (White at start, Black after `1.e4`/`1.d4`), then “fill in the gaps”. Writes real client prefs, a real saved line via `/repertoires/:key/moves`, and calls the real autofill endpoint. Setup record in `cb_welcome_v1`; completed state is resumable. |
| `app/src/pages/HelpPage.tsx` | `/help` — local quick links, real wiki links (`wiki.chessbook.com`, `/repertoire-statistics`), Google Play listing, issue tracker, FAQ, legal links. No dead routes. |

### Shared shell and CSS

`ContentLayout` renders the production-like public nav/footer and injects a
scoped `<style>` block from `CONTENT_CSS`. Nothing was added to
`styles/app.css`.

New classes are all prefixed `cb-cs-` and scoped to these pages:

- layout: `cb-cs-page`, `cb-cs-nav`, `cb-cs-nav-links`, `cb-cs-nav-actions`,
  `cb-cs-main` (1180px max, 860px “narrow”), `cb-cs-crumbs`, `cb-cs-footer`
- typography: `cb-cs-title`, `cb-cs-lede`, `cb-cs-section-title`, `cb-cs-prose`
- guides: `cb-cs-toolbar`, `cb-cs-tabs`, `cb-cs-tab`, `cb-cs-grid` (2 columns),
  `cb-cs-guide`, `cb-cs-guide-name/moves/board`, `cb-cs-eco`
- boards: `cb-cs-mini`, `cb-cs-mini-grid`, `cb-cs-sq` (78px index preview,
  92px two-move diagrams, 320px detail board, inline piece images from
  `/pieces/chessbook_monochrome/`)
- cards/forms: `cb-cs-cards` (2 columns), `cb-cs-card*`, `cb-cs-avatar`,
  `cb-cs-badge`, `cb-cs-meta`, `cb-cs-callout`, `cb-cs-columns`,
  `cb-cs-form*`, `cb-cs-actions`, `cb-cs-choice`, `cb-cs-movechoice*`,
  `cb-cs-note`, `cb-cs-error`
- coaches/report: `cb-cs-apps`, `cb-cs-app*`, `cb-cs-status.pending/approved/rejected`
- onboarding/help: `cb-cs-steps`, `cb-cs-step.active/done`, `cb-cs-faq`

Responsive breakpoints are 900px (single-column cards/detail) and 640px
(compact nav, 64–70px guide/diagram boards).

---

## Endpoints used

All under `/api`, same local server / SQLite database:

| Endpoint | Used by |
|---|---|
| `GET /openings/guides` | openings index (103 rows, White/Black splits) |
| `GET /openings/guides/:slug` | guide detail (`steps`, `notes`, `plans`, coverage, course) |
| `GET /openings/report` | openings report panel (`weak`/`worst`, explicit empty reason) |
| `GET /courses?limit=100` | pre-made catalogue |
| `POST /courses/:slug/clone` | clone a pre-made repertoire, then navigate to `/repertoire/:id` |
| `GET /coaches` | directory |
| `GET /coaches/:slug` | coach profile |
| `GET /blog` | blog index |
| `GET /blog/:slug` | post detail (`bodyAvailable:false` surfaced) |
| `GET /repertoires` | repertoire list, guide/welcome repertoire selection |
| `GET /repertoires/:key/candidates` | welcome first-move picker (incidence, masters, eval) |
| `POST /repertoires/:key/moves` | welcome first move (real saved branch) |
| `POST /repertoires/:key/autofill` | welcome “fill in the gaps” (style + maxMoves) |
| `POST /repertoires` | welcome fallback when no matching colour repertoire exists |
| `POST /repertoires/:key/lines` | guide detail “Add line to repertoire” |

Coach applications intentionally do **not** call the server: there is no
application API, so they are stored in `localStorage` and the UI says so on
both apply and review screens.

---

## Required routes (for the orchestrator)

Register these exact files:

```tsx
import { OpeningsPage } from "./pages/OpeningsPage";
import { OpeningGuidePage } from "./pages/OpeningGuidePage";
import { CoachesPage } from "./pages/CoachesPage";
import { CoachPage } from "./pages/CoachPage";
import { CoachApplyPage } from "./pages/CoachApplyPage";
import { CoachReviewPage } from "./pages/CoachReviewPage";
import { BlogPage } from "./pages/BlogPage";
import { BlogPostPage } from "./pages/BlogPostPage";
import { RepertoiresPage } from "./pages/RepertoiresPage";
import { WelcomePage } from "./pages/WelcomePage";
import { HelpPage } from "./pages/HelpPage";
```

| Path | Element |
|---|---|
| `/openings` | `<OpeningsPage />` |
| `/openings/:slug` | `<OpeningGuidePage />` |
| `/coaches` | `<CoachesPage />` |
| `/coaches/apply` | `<CoachApplyPage />` |
| `/coaches/review` | `<CoachReviewPage />` |
| `/coaches/:slug` | `<CoachPage />` |
| `/blog` | `<BlogPage />` |
| `/blog/:slug` | `<BlogPostPage />` |
| `/repertoires` | `<RepertoiresPage />` |
| `/repertoires/:slug` | `<RepertoiresPage />` (production slug alias; redirects to `/repertoire/:key`) |
| `/welcome` | `<WelcomePage />` |
| `/help` | `<HelpPage />` |

Notes:

- Declare the static `/coaches/apply` and `/coaches/review` routes alongside
  `/coaches/:slug`; React Router v7 ranks static segments first, but listing
  both is required.
- Remove the existing `/openings → /add` redirect in `App.tsx`, otherwise the
  new index is unreachable.
- These pages do not depend on `ProfileProvider`; they are safe outside the
  `LocalProfile` route (public production-like surfaces). `/repertoires` and
  `/welcome` still call the API, which resolves the single local profile
  server-side.
- Optional for D133: add `/qr` as a redirect to
  `https://play.google.com/store/apps/details?id=com.chessbook.android`
  (the captured production `/qr` target). `/help` already links that listing.

---

## Verification

Environment: no server was running on 8787. I started my own API on **8799**
against the existing `server/data/chessbook.db`, then stopped it. No data was
mutated (autofill was exercised with `dryRun:true`).

1. `npx tsc --noEmit -p app/tsconfig.json` → **0 errors**.
2. `npm run build` → **✓ built in 169ms** (App.tsx does not import these pages
   yet, so this only proves the rest of the app still builds).
3. Independent bundle of all 11 new pages (temporary Vite lib entry, removed
   afterwards) → **✓ built, 255.45 kB**. This proves every new module resolves
   and bundles.
4. Server-side render of `HelpPage`, `OpeningsPage`, `CoachesPage`,
   `BlogPage`, `RepertoiresPage`, `WelcomePage` with `MemoryRouter` +
   `ToastProvider` → all rendered with the `cb-cs-page` shell, no render
   errors.
5. API checks (real responses):

```
guides 103 true white 52 black 51 first italian-game 1. e4 e5 2. Nf3 Nc6 3. Bc4
guide detail italian-game steps 5 notesAvailable true plansAvailable false notes 1
coaches 3 true blunder-man,daniel-pivonka,vasyl
coach Blunder Man | 2180 Chess.com Rapid | $50/hour
blog 9 true 2026-10-19 spending-10-months-building-the-most-human-like-chess-bot
post Spending 10 months building th bodyAvailable false
courses 21 hp-1-e5-black 113 69
reps 1:white:White openings:7:126:103:0 | 2:black:Black openings:2:129:102:0
alias /repertoires/white 200
autofill dryRun true filled 1 considered 30 style expected repertoire White openings
```

6. Openings report is real, not invented:

```
{"capturedAvailable":false, "source":"local-reviews",
 "weak":[{"name":"King's Knight Opening","reviews":2,"correct":0,"wrong":2,"accuracy":0},
         {"name":"Sicilian Defense","reviews":2,"correct":1,"wrong":1,"accuracy":50}, ...]}
```

A connected desktop browser / Playwright Chromium was not available in this
session, so visual screenshot verification was replaced by SSR + API + bundle
verification. No server started by anyone else was stopped.

---

## Residual gaps

1. **Guide notes and plans are partial by capture.** Only positions present in
   the annotation capture have note text (e.g. Italian `1.e4`); `plans` is
   empty for every guide. The detail page says this explicitly.
2. **Course chapters/move trees were not captured.** The catalogue and clone
   flow are real; a clone seeds the matching opening-guide line and the API
   response states that no chapters exist.
3. **Blog bodies and authors were not captured.** Posts show real titles,
   dates and excerpts, plus an explicit “body not captured” state. Attribution
   is shown as the publication (Chessbook), not an invented person.
4. **Coach avatars and contact details were not captured.** Cards use initials
   avatars; profile pages state that contact details are absent from the
   capture. Applications/review are local-only by design.
5. **D127 transpositions:** the server exposes
   `/repertoires/:key/transpositions` and EPD-based merging, but this surface
   set does not add a transposition UI. Guide/course matching is EPD-based in
   the API.
6. **D130 FEN search:** `/openings?fen=` exists server-side and is not surfaced
   here; the index search covers name, ECO and PGN text.
7. **D120 supplementary names:** guide detail uses the captured per-position
   `name` returned in `steps[]`; there is no standalone supplementary-EPD
   lookup screen.
8. **Production repertoire slugs** are aliased client-side (`/repertoires/:slug`
   → `/repertoire/:key`); the database still stores `slug:null` for the two
   seeded repertoires.
9. **D133 `/qr`:** no route file was in my ownership list. `/help` links the
   real Play Store listing; the orchestrator can add the redirect.

---

## D-ID checklist

- [x] **D120** — Captured per-position names are rendered in guide detail
  (`steps[].name`, e.g. “Italian Game” after `3.Bc4`) and captured guide
  names/ECOs in the index; no generated aliases. *(No standalone EPD lookup UI.)*
- [x] **D121** — Welcome first-move choices show the captured incidence label:
  Black after `1.e4` → `c5 1 in 3 games`, `e5 1 in 4 games`, `e6 1 in 8 games`.
- [x] **D122** — The same choices show `Masters 42.7%` and eval `+0.45` for
  `c5`; `GET /repertoires/2/candidates?moves=e4` returns the real values.
- [x] **D123** — Guide detail renders captured annotations per move (Italian
  `1.e4` → “Best by test…”), with explicit “notes/plans not captured” states
  when absent.
- [x] **D124/D132** — `/openings?tab=pre-made` lists 21 captured courses with
  real move counts/coverage (e.g. `hp-1-e5-black` 113 moves, 69% coverage) and
  clones via `POST /courses/:slug/clone`.
- [x] **D125/D163** — `/openings` shows 103 real guides (52 White / 51 Black;
  Italian, QGD, English, Ruy Lopez, London, …), each linking to a detail page.
- [x] **D126** — `/openings/:slug` renders the real line, final position,
  two-move diagrams and move notes for `italian-game` (5 steps, 1 note).
- [~] **D127** — EPD-based matching is used by the API and guide/course links;
  no transposition-management UI in this file set.
- [x] **D128** — Guide rows/detail show captured coverage where it exists (22
  guides; e.g. London System 57.8%, Ruy Lopez 11.1%) and “coverage unavailable”
  otherwise.
- [x] **D129** — Openings report panel calls `/openings/report`, lists real
  weak/worst lines from local reviews, and explains the empty captured report
  instead of inventing one.
- [~] **D130** — FEN search remains server-only (`/openings?fen=`); index
  search is name/ECO/PGN.
- [x] **D131** — Coaches, coach profile, apply, review, blog index/detail and
  help routes all exist and are listed for registration.
- [~] **D133** — No `/qr` route file (App.tsx owned); `/help` links the real
  Google Play listing `com.chessbook.android`.
- [x] **D164** — `/coaches` (3 captured profiles), `/coaches/:slug`,
  `/coaches/apply` and `/coaches/review` implemented; applications persisted
  locally and reviewed.
- [x] **D165** — `/blog` lists all 9 captured posts with dates/excerpts;
  `/blog/:slug` opens the captured post and states the body is unavailable.
- [x] **D166** — `/repertoires` shows both local repertoires with real counts
  (`White openings` 7 saved/126 moves/103 positions, `Black openings` 2/129/102);
  `/repertoires/:slug` resolves white/black/name/id/slug and redirects to
  `/repertoire/:key`.
- [x] **D167** — `/welcome` writes a real rating to client prefs, a real first
  move through `/repertoires/:key/moves`, and fills gaps through the styled
  autofill endpoint; completed setup is stored in `cb_welcome_v1` and resumable.
- [x] **D169** — `/help` links working local routes plus the real public wiki
  (`wiki.chessbook.com`, `/repertoire-statistics`), Play Store listing, issue
  tracker and legal pages; no dead in-app targets.

---

## Files

New only:

- `app/src/pages/OpeningsPage.tsx`
- `app/src/pages/OpeningGuidePage.tsx`
- `app/src/pages/CoachesPage.tsx`
- `app/src/pages/CoachPage.tsx`
- `app/src/pages/CoachApplyPage.tsx`
- `app/src/pages/CoachReviewPage.tsx`
- `app/src/pages/BlogPage.tsx`
- `app/src/pages/BlogPostPage.tsx`
- `app/src/pages/RepertoiresPage.tsx`
- `app/src/pages/WelcomePage.tsx`
- `app/src/pages/HelpPage.tsx`
- `audit/progress/04-content-surfaces.md`

No commit was made.
