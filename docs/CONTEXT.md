# Handoff / working context

## What this repo is

A static, pixel-accurate clone of the chessbook.com web app and marketing page. The UI is the **real rendered DOM** from the production site, paired with the **original production CSS**. `js/boot.js` is the only hand-written runtime and supplies navigation, auth-form behaviour, toasts and the practice board.

No backend, no framework, no build step required to run.

## Demo account

- Email: `local@chessbook.local`
- Password: `local-only`

The login form is prefilled. Submit goes straight to `index.html`; nothing leaves the browser.

## Quick commands

```bash
# run locally at the repo root
python3 -m http.server 4173
# http://localhost:4173/

# regenerate pages from local captured snapshots
python3 tools/build_pages.py

# local Playwright checks (recon/ is gitignored)
node recon/test-interactions.mjs
node recon/test-mobile.mjs
node recon/test-subpath.mjs
```

The dev server used during development also ran a simulated Pages subpath at `http://localhost:4174/chessbook/`.

## Key files

| Path | Purpose |
| --- | --- |
| `index.html` … `add.html` | desktop app pages (captured DOM) |
| `welcome.html`, `login.html` | desktop auth screens |
| `signup/index.html` | responsive marketing page |
| `m/*.html` | mobile app/auth captures |
| `js/boot.js` | all clone behaviour |
| `js/vendor/chess.js` | legal-move engine for practice |
| `_build/assets/` | original CSS + self-hosted fonts |
| `pieces/chessbook_monochrome/` | piece SVGs |
| `homepage_imgs/` | marketing images |
| `tools/build_pages.py` | generator/annotation pipeline |
| `docs/` | design system, site map, plan, this file |
| `legacy/` | superseded hand-built first pass (not loaded) |
| `recon/` | local capture workspace (gitignored) |

## Architecture decisions

1. **Snapshot over reconstruction.** Hand-built CSS could not match inline layout and spacing. The real rendered DOM + production CSS gives exact geometry.
2. **No hydration.** Framework `<script>` tags are stripped; the app is static markup. A small module restores the interactions we need.
3. **Separate mobile captures.** The desktop DOM contains fixed inline styles captured at 1440 px and does not reflow correctly. Mobile pages are captured at 390 × 844 and served from `m/`.
4. **Redirect, don’t duplicate at runtime.** Under 768 px, desktop pages `location.replace` to `m/<same-page>`. Mobile pages use `data-root="./"` so navigation stays inside `m/`.
5. **`<base href="../">` for marketing only.** The marketing page lives at `signup/index.html`; the base tag lets its relative assets resolve from the repository root, including on a Pages subpath. All other pages use plain relative URLs.
6. **Generator owns nav annotations.** `tools/build_pages.py` injects `data-nav` / `data-action` into the captured markup by `data-testid`, plus per-page back targets. Re-running it overwrites manual HTML edits.
7. **`chess.js` only on practice.** Dynamically imported inside `initPractice`, so other pages do not pay the parse cost.

## Critical geometry (desktop, 1440 × 900)

- Board: `[111, 121, 520, 520]`, squares 65 × 65
- Sidebar: `[679, 121, 650, ≈731.75]`
- White repertoire row: `[679, 159.1875, 650, 60]`
- Gap board ↔ sidebar: 48 px
- Sidebar padding: 18 px
- Sidebar button height: 45 px (summary rows 60 px)

If a change moves these, it is not pixel-accurate.

## Design tokens (quick reference)

- Background: `oklch(19% .0051 243)`
- Sidebar surface: `oklch(26% .0069 243)`
- Sidebar button: `oklch(34% .0091 243)`; hover `oklch(44% .0117 243)`
- Text: primary `oklch(96% .0016 243)`, secondary `oklch(84% .0064 243)`, tertiary `oklch(60% .016 243)`
- Board light: `rgb(99,158,97)`; dark: `rgb(63,131,92)`
- Display: Jost Variable; UI: Inter Variable
- Spacing unit: 4 px (`--spacing: .25rem`)

Full details in `docs/design.md`.

## Practice board notes

- The expected move lives on `[data-testid="expected-move"]` as `data-expected-san` (`Nf3` for the captured position).
- The production board has a transparent pointer surface above the square grid, so the clone resolves the clicked square from pointer coordinates, not `event.target`.
- FEN is reconstructed from the piece DOM (`#piece-<square>` + `img src`).
- Both side-to-move options are tried; the one where the expected SAN is legal wins.
- Wrong legal moves are played, flagged, then undone in both chess.js and the DOM.
- Castling, en passant and promotion are handled in `moveDom`; only the captured position is realistically exercised.

## Known issues / limitations

- The site is a UI clone: no server, auth, sync, billing, import or persistence.
- Some captured controls are inert (theme, sound, account deletion, edit/remove line, import, password reset).
- The desktop pages are not responsive on their own; mobile relies on `m/`.
- Legal pages are restyled summaries of the captured content, not the production page chrome.
- External links (Lichess, social, app stores) leave the clone.
- Marketing captures are static; analytics pixels and third-party scripts were removed.
- `recon/` is required to regenerate pages but is intentionally not committed.

## Deployment checklist

- [x] Local desktop tests pass.
- [x] Local mobile tests pass.
- [x] Local subpath test passes with zero 404s.
- [x] Design/site-map/plan/context docs written.
- [ ] `git add` + commit.
- [ ] `gh repo create` + push.
- [ ] Enable Pages (`main`, root).
- [ ] Open the deployed Pages URL and smoke-test:
  - dashboard loads with CSS/fonts/pieces
  - white repertoire → build → gap
  - practice move `Nf3`
  - mobile redirect and mobile nav
  - marketing → login → dashboard
  - legal links resolve
- [ ] Record the live URL in the README.

## Git state at handoff

Only the initial `chore: init repo` commit existed before the snapshot work. All clone files are uncommitted at the time of writing. `recon/`, `node_modules/`, `.DS_Store`, logs and Playwright reports are ignored.
