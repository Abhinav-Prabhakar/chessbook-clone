# Build plan & status

## Goal

A 1:1, pixel-accurate front-end clone of chessbook.com using vanilla HTML/CSS/JS, with all primary screens navigable, a working practice interaction, mobile layouts, design documentation, a GitHub repository and a GitHub Pages deployment.

Visual fidelity is the priority. Backend behaviour, real auth and persistence are out of scope.

## Approach

The first pass reconstructed the UI by hand in custom CSS. It was visually close but not exact, and it drifted from the real product. The project pivoted to **snapshot-based cloning**:

1. Drive the real app with Playwright.
2. Save the rendered `#app` DOM for each route.
3. Localize the original production CSS, fonts, pieces and marketing images.
4. Strip framework hydration and keep the rendered markup.
5. Add a thin vanilla-JS interaction layer for navigation and the training loop.
6. Generate desktop and mobile variants from separate viewport captures.

This guarantees the layout, inline styles, typography and assets match the real rendered app rather than an approximation.

## Phases

### Phase 0 — Reconnaissance

- [x] Inspect marketing site and app routes.
- [x] Create an account/session and capture authenticated screens.
- [x] Identify production CSS bundles, fonts, piece SVGs, marketing images.
- [x] Capture desktop at 1440 × 900.
- [x] Capture mobile at 390 × 844.
- [x] Save reference screenshots and geometry measurements.

### Phase 1 — Static port

- [x] Download/localize CSS, fonts, favicon, manifest, images, pieces.
- [x] Extract rendered `#app` DOM for every route.
- [x] Strip hydration scripts.
- [x] Rewrite root-absolute URLs to relative paths.
- [x] Generate desktop pages at the repo root.
- [x] Generate `signup/index.html` with `<base href="../">`.
- [x] Add privacy and fulfillment pages.
- [x] Add `tools/build_pages.py` for repeatable generation.

### Phase 2 — Behaviour

- [x] Global click routing via `data-nav`.
- [x] Per-page back-button hierarchy.
- [x] Dashboard → repertoire → build/gap/learn/practice loop.
- [x] Add-new and model-game routes.
- [x] Settings route and return.
- [x] Login form prefill + simulated submit.
- [x] Welcome “Get started”.
- [x] Marketing CTAs → welcome/login.
- [x] Practice board: selection, legal targets, move validation, correct/wrong feedback, undo on wrong.
- [x] Show-answer action.
- [x] Autofill-gap toast + navigation.
- [x] Toast and highlight styling.

### Phase 3 — Mobile

- [x] Capture every app/auth route at 390 × 844.
- [x] Generate `m/` pages with `../` asset paths.
- [x] Mobile redirect under 768 px.
- [x] Keep mobile navigation inside `m/`.
- [x] Mobile practice board interaction.
- [x] Marketing remains responsive at root.

### Phase 4 — Verification

- [x] Desktop layout matches captured geometry (board, sidebar, rows).
- [x] Desktop interaction suite passes.
- [x] Mobile interaction suite passes.
- [x] No 404s on desktop, mobile or marketing.
- [x] Simulated GitHub Pages subpath (`/chessbook/`) passes with zero 404s.
- [x] Screenshots compared against references.

### Phase 5 — Documentation & delivery

- [x] `README.md`.
- [x] `docs/design.md`.
- [x] `docs/SITE-MAP.md`.
- [x] `docs/PLAN.md`.
- [x] `docs/CONTEXT.md`.
- [ ] Commit and push to GitHub.
- [ ] Enable GitHub Pages and verify the live subpath.

## Current status

**Static clone complete; deployment pending.**

Working:

- all desktop routes and primary navigation
- all mobile routes and redirect
- practice move loop and show-answer
- auth/onboarding/marketing navigation
- legal pages
- local assets and fonts
- subpath-safe relative URLs

Known gaps (intentional):

- no backend, real auth, account data or persistence
- no real repertoire editing/import
- only the captured practice position is trainable
- many secondary production controls remain inert
- keyboard-only board play not implemented

## Next steps

1. Create the GitHub repository and push the current tree.
2. Enable Pages from the `main` branch root.
3. Open the deployed URL under the project subpath and re-run the subpath smoke test.
4. Optional: capture a few more real positions for practice.
5. Optional: wire a small localStorage layer for repertoire edits.
6. Optional: add visual-regression snapshots to CI.

## Regeneration workflow

The capture workspace `recon/` is gitignored. With it present:

```bash
python3 tools/build_pages.py
```

This rewrites all root desktop pages, the `m/` pages and `signup/index.html`. Any manual change to a generated HTML file will be overwritten on the next run; put behaviour in `js/boot.js` or generator annotations instead.

## Verification commands used

```bash
# serve at the repo root
python3 -m http.server 4173

# serve a simulated Pages subpath
# /…/pages/chessbook -> symlink to this repo
python3 -m http.server 4174

# Playwright checks (local recon scripts, not committed)
node recon/test-interactions.mjs
node recon/test-mobile.mjs
node recon/test-subpath.mjs
```
