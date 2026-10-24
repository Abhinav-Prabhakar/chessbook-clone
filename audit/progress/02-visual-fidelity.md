# 02 — Visual fidelity / mobile composition (D171, D180–D184, D188–D193)

Owner: `visual-fidelity`
Files changed (exclusive ownership):

- `app/src/styles/app.css`
- `app/src/components/ui.tsx`
- `app/src/pages/landing-body.html`
- `app/src/pages/LandingPage.tsx` — unchanged; its existing click bridge still maps the
  new `data-cb-cta="enter"` CTAs and `Open app` to the local app entry.

Other page/component/server files were read but not edited.

---

## What changed

### 1. Mobile is now the production clipped-board + sheet composition (D171/D186/D187/D189/D190)

At `max-width: 767px` (production's `md` breakpoint) the desktop board+sidebar reflow is
replaced by the captured production composition:

- Fixed 36px top bar: `BoardHeader` is re-used as the bar (logo + current page), and the
  sidebar's existing `Settings` link is fixed to its right edge. Intermediate breadcrumbs
  collapse on phones; a `% complete` crumb keeps its parent (`Build › 1% complete`).
- The board column becomes a 136px clipped strip with the board dimmed to `opacity: .2`.
  Board top is 36px, board width is `min(100vw - 24px, 480px)` (366px at 390), so the sheet
  at 136px leaves the production two-rank peek plus an 8px sliver of the third rank.
- `.cb-sidebar` becomes the full-width page sheet directly below (square corners,
  `--cb-surface`, `min-height: calc(100dvh - 136px)`), with production 12px side padding,
  5/24px Back row, 22px page title and 45px rows. `Settings` is hidden in the top bar on the
  Settings page itself to avoid duplicating it.
- Practice and the interactive model game use `:has(.cb-practice-head / .cb-evalgraph /
  .cb-model-actions)` to opt out of clipping: full board, `opacity:1`, interactive, sheet
  below. Preview surfaces (dashboard/repertoire/build/gap/settings) stay clipped.
- Rank coordinates remain on the clipped right edge (they are part of the production peek);
  file coordinates are naturally clipped away. Coordinates are 10px in the peek.

### 2. Loading states are inline skeletons (D192)

`Splash` keeps its exported API (`<Splash label="…" />`) but now renders a page-shaped
shimmer shell instead of a full-screen spinner: clipped dim board + sheet on mobile, the
520/650 shell at desktop. `SkeletonRows` is exported for page-level inline lists. The old
`.cb-spinner`/`.cb-splash` CSS is kept for the landing overlay and hard error states.

### 3. Builder candidate alignment (D180)

Shared CSS now aligns the header and the row statistics on the same track grid used by the
builder:

- 1440px: `.cb-table-head` and `.cb-candidate-stats` both measure `x=1101, w=210`
  (54/44/96 with 8px gaps, inline tracks set by the builder owner).
- Masters is a two-line cell (percentage + games), eval is a 22px chip, peers are a
  stacked result bar with win/draw/loss labels.
- Desktop header labels are right-aligned over their columns (Masters / Eval / Peer results).
- At ≤820px the stats block sits under the candidate copy; at ≤520px the verbose header is
  hidden and the stats are right-aligned so they do not collide with long descriptions.

### 4. Sheets, modals, settings affordances (D181/D184)

- `Modal` gains optional `subtitle` (position/context line for the add-line surface) and
  `className`, without changing existing call sites.
- Mobile modals are bottom sheets (`max-height: 88dvh`, 16px top radius, safe-area padding);
  desktop panels keep an 8px radius. This is the chrome used by the Settings choice sheets.
- Settings values use the shared `.cb-setting-value` (13px, right aligned); `.cb-row-chevron`
  and the new exported `SettingRow` / `OptionSheet` primitives are available for any
  settings surface that wants the explicit "value + open a list" affordance.

### 5. Landing nav + local-first message (D193)

- Logged-out nav is now `Pre-made repertoires · Openings · Coaches · Blog · Help · Open app`
  (`recon/live6/02-openings.json` shows exactly the first five in production). `Help` links
  to the production wiki; `Open app` enters the local trainer.
- The Starter/Pro pricing block (`href="#"` CTAs, $7/month, "Save up to 200 moves") is
  replaced with a local-first panel: *Everything included. Nothing to buy.* + a working
  `Get started` CTA. There are now **zero** `href="#"` links in the captured landing body.
- Below 760px the five informational links collapse to `Open app` (no hamburger yet — noted
  as a residual).

### 6. Board arrow layer (D191, infrastructure)

`BoardArrows` is exported from `ui.tsx`: an absolute `.cb-board-arrows` SVG layer that
projects `{from,to,color}` square pairs for either orientation onto the board. No page
currently consumes it (Board/Build/Gap are other owners), so D191 is only partially closed.

---

## Production measurements used

| Source | Measurement used |
|---|---|
| `recon/html-mobile-white.html` | board wrapper `max-w-[480px] padding-sidebar`; `margin-top:-306px` sheet; `padding-sidebar` 12px; `min-h-sidebar-button` 45px |
| `recon/app-CxFWCbj_.css` | `.padding-sidebar` 12px (<64rem) / 18px (≥64rem); sidebar button `oklch(34% .0091 243)`; sheet `oklch(26% .0069 243)` |
| `recon/screens/mobile-white.png` (1170×2532, DPR 3) | top bar 0–108px (36 CSS), board top 108 (36), board 366 CSS wide, sheet top 408 (136), two ranks + 8px third-rank sliver |
| `recon/screens/mobile-dashboard.png` | dashboard top bar has Settings only; sheet rows 45px, 8px row gaps, section padding 12px |
| `recon/screens/app-continue-building.png` (2880×1800, DPR 2) | candidate columns: Masters 44, Eval 40, Peer results 80; eval/peer chips 39–40×22; 18px row padding; 45px rows |
| `recon/live6/02-openings.json` | production nav labels: Pre-made repertoires, Openings, Coaches, Blog, Help |
| `recon/live4/network.json` | confirmed live API traffic (practice/review/moves) while checking the captured pages; no visual constants |

Final local measurements (Playwright, Chrome):

- 390×844 dashboard/repertoire/gap/build/settings: board `[12,36,366,366]`, board opacity
  `0.2`, sheet top `136`, top bar 36px, Settings 100.9×36 at the right edge.
- 390×844 practice/model: board `[12,36,366,366]`, opacity `1`, sheet top `410`.
- 1440×900 shell: board `[111,121,520,520]`, sheet `[679,0,650,900]`; candidate header and
  stats both `x1101, w210`; table head `w210`.

---

## Verification run

- `npm run build` — **passes** (vite 8.3.5, 45 modules).
- `npx tsc --noEmit -p app` — no errors from `ui.tsx` / `app.css` / landing files. (The repo
  currently has concurrent errors in `BuildPage.tsx`, `Dashboard.tsx`, `PracticePage.tsx`
  and `SettingsPage.tsx`, owned by the other agents.)
- Playwright screenshots at **390×844** and **1440×900** against `npm run dev` (Vite + Express,
  local SQLite). The dev server used for the final captures was started for this verification
  and stopped afterwards; servers started by other agents were not killed.

Screenshots (all in `audit/progress/02-visual-fidelity-assets/`):

| File | Shows |
|---|---|
| `landing-1440.png`, `landing-390.png` | new logged-out nav (desktop + mobile) |
| `landing-local-first-1440.png`, `landing-local-first-390.png` | replacement of the pricing block |
| `dashboard-390.png`, `dashboard-1440.png` | clipped board + sheet / desktop shell |
| `repertoire-390.png`, `repertoire-1440.png` | mobile peek, 4-column segmented stats, desktop |
| `build-390.png`, `build-1440.png` | mobile sheet + candidate alignment on desktop |
| `gap-390.png`, `gap-1440.png` | completion breadcrumb, candidate columns |
| `practice-390.png` | full interactive board on the practice route |
| `model-390.png` | full interactive board on the model route |
| `settings-390.png`, `settings-sheet-390.png` | top bar without duplicate Settings; bottom-sheet choices |
| `skeleton-390.png`, `skeleton-1440.png` | inline loading shells |

---

## D-ID checklist

- [x] **D171** — Mobile uses the clipped-board + full-width sheet composition, not a desktop reflow; `.cb-board-col` is a 136px strip and `.cb-sidebar` starts at 136px.
- [x] **D186** — Board no longer full-size at 390×844: visible board strip is 100px of a 366px board at `opacity:.2` (production `margin-top:-306px`/2.2-rank peek).
- [x] **D187** — Sheet is full width with square corners and ends at the viewport edge; page content scrolls beneath a fixed 36px bar (`repertoire-390.png`).
- [x] **D188** — Mobile stats use the production 4-column layout with dividers and 61×8px 10-segment bars (`repertoire-390.png`; measured `segbar` 61×8).
- [x] **D189** — 36px mobile top bar: current page left, Settings right; Settings page suppresses the duplicate right-hand link (`practice-390.png`, `settings-390.png`).
- [x] **D190** — Rank labels stay on the right edge of the clipped board and are dimmed with it; file labels are outside the peek (`repertoire-390.png`).
- [x] **D192** — `Splash` is an inline board+sheet skeleton (same exported API); `SkeletonRows` added; desktop skeleton fits 900px without scroll (`skeleton-390.png`, `skeleton-1440.png`).
- [x] **D193** — Landing nav is Pre-made repertoires / Openings / Coaches / Blog / Help + Open app; pricing block removed; `grep 'href="#"'` returns 0 (`landing-1440.png`).
- [x] **D180** — Candidate header and stats share the same tracks (`x1101 w210` at 1440); Masters is two-line, Eval 22px chip, Peer results a labelled stacked bar (`build-1440.png`).
- [x] **D182** — Gap breadcrumb shows completion (`White openings › Build › 1% complete`) and keeps it on mobile (`gap-1440.png`, `gap-390.png`).
- [x] **D183** — Gap's duplicate "Open in build mode / Back to the builder / Open the practice queue / Repertoire health" rows are gone in the gap rework; the shared sheet spacing is unchanged (`gap-390.png`).
- [x] **D184** — Settings values are styled and open real choice sheets with checkmarks; shared `SettingRow`/`OptionSheet` primitives and `.cb-setting-value` available (`settings-sheet-390.png`). The page wiring is owned by `dashboard-settings`.
- [~] **D181** — Modal chrome now supports a position/context subtitle and mobile bottom-sheet geometry, but the current add-line flow is inline (builder rework) and its ranking/content is the builder owner's code; no modal currently passes context.
- [~] **D191** — `.cb-board-arrows` + `BoardArrows` SVG overlay implemented (orientation-aware, seek-safe); not yet wired into any page because Board/Build/Gap are owned by other agents.

Not in my ID list: **D185** (model eval graph) belongs to the model-games workstream; I did not
restyle it.

---

## Residual gaps

1. **D191 adoption.** The arrow layer exists but no page renders `<BoardArrows />`. It needs
   one call inside the `.cb-board` wrapper on Build/Gap/Practice/Model with plan/refutation
   data; that is a page-owner change.
2. **D181 context.** `Modal` can render a subtitle, but the add-line surface is now inline;
   whoever owns that surface should pass the position/SAN context to it. The modal still has
   no ranking data of its own.
3. **Landing destinations.** The nav is no longer dead (`href="#"` removed), but `/openings`
   currently redirects to `/add` and `/coaches`, `/blog` depend on routes being added by the
   content workstream in `App.tsx`. The labels now match production's captured `/openings` nav.
4. **Mobile nav collapse.** Under 760px the five informational links are hidden, leaving
   `Open app`; production uses a mobile menu affordance that is not in the captured markup.
5. **Tablet band.** The clipped composition applies at ≤767px (production `md`). The 768–820px
   band keeps the previous reflow, which is not a production breakpoint composition.
6. **Practice/model mobile shape.** These routes deliberately keep a full board (functional
   requirement) instead of the 2-rank peek; no production mobile practice capture exists in
   `recon/` to compare against.
7. **Dashboard Back row.** The dashboard sheet currently renders a Back row added by the
   dashboard owner; production's mobile dashboard has no Back in the sheet (top bar only).
   That is outside my file ownership.
8. **Settings wiring.** The shared `SettingRow`/`OptionSheet` exports are unused; the Settings
   page has its own local wrappers. Both produce the same affordance, so this is duplication,
   not a visual gap.
9. **Mobile builder stats placement.** With no captured production mobile builder page, the
   stats-under-description layout is a readability choice; desktop matches production's
   columns exactly.
