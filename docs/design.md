# Chessbook design system

Extracted from the production app at chessbook.com (1440 × 900 desktop capture and 390 × 844 mobile capture). The clone keeps the original CSS bundles, so the values below are the source of truth for any new UI added around the captured screens.

## 1. Design principles

1. **Chess first.** The board is the largest, most contrasty object on every training screen. Chrome is dark and quiet.
2. **One focused action.** Each screen has a single primary next step (continue, start training, autofill, play the move) and a low-contrast way back.
3. **Warm-paper green, not neon.** The board uses two desaturated greens; accent colors are reserved for progress, warnings and arrows.
4. **Dense but breathable.** Rows are only 45–60 px tall, yet 18 px side padding and 8 px gaps keep the sidebar scannable.
5. **Display type for moments.** Jost carries headings and the brand; Inter carries controls and body copy.

## 2. Source of truth

| Concern | File |
| --- | --- |
| App CSS | `_build/assets/app-CxFWCbj_.css` |
| Marketing / base CSS | `_build/assets/entry-web-DlhHRFsU.css` |
| Desktop DOM | root `*.html` |
| Mobile DOM | `m/*.html` |
| Interaction layer | `js/boot.js` |
| Asset localization / page generation | `tools/build_pages.py` |

## 3. Color

The app uses OKLCH with a constant hue around `243` for the neutral ramp.

| Token | Value | Use |
| --- | --- | --- |
| `--color-gray-16` | `oklch(16% .0043 243)` | deepest surface |
| `--color-gray-19` | `oklch(19% .0051 243)` | page background |
| `--color-gray-21` | `oklch(21% .0056 243)` | raised surface |
| `--color-gray-26` | `oklch(26% .0069 243)` | app sidebar surface |
| `--color-gray-40` | `oklch(40% .0107 243)` | borders / disabled |
| `--color-gray-46` | `oklch(46% .0123 243)` | muted icons |
| `--color-gray-60` | `oklch(60% .016 243)` | tertiary text |
| `--color-gray-70` | `oklch(70% .012 243)` | secondary body |
| `--color-gray-84` | `oklch(84% .0064 243)` | secondary text |
| `--color-gray-85` | `oklch(85% .006 243)` | legal body |
| `--color-gray-96` | `oklch(96% .0016 243)` | primary text |
| sidebar button | `oklch(34% .0091 243)` | `bg-sidebar_button_primary` |
| sidebar button hover | `oklch(44% .0117 243)` | `bg-sidebar_button_primary_hover` |
| success / progress | `oklch(70% .1708 141)` | green-70 |
| info / links | `oklch(70% .1501 230)` | blue-70 |
| danger | `oklch(70% .1648 22)` | errors, wrong moves |
| warning | `oklch(70% .157 50)` | warnings |
| arrows | `oklch(75% .1494 76)` | orange analysis arrows |
| board light square | `rgb(99, 158, 97)` | `#639e61` |
| board dark square | `rgb(63, 131, 92)` | `#3f835c` |
| white | `#fff` | pieces, high emphasis |

Marketing pages use a wider palette (`bg-orangeBright-75`, `bg-gray-27`, `bg-gray-51`, etc.) from `entry-web-DlhHRFsU.css`. The captured marketing markup already carries those classes.

## 4. Typography

| Role | Family | Weights | Notes |
| --- | --- | --- | --- |
| Display / brand | **Jost Variable** | 100–900 variable | Headings, `font-display`, the wordmark |
| UI / body | **Inter Variable** | 100–900 variable | Controls, labels, body, tabular data |
| Icons | Font Awesome 6 (solid/duotone/light) | — | Loaded by the production CSS |

Both families are self-hosted as `woff2` variable fonts in `_build/assets/` and declared with `font-display: swap`.

Observed type scale:

| Element | Size / weight |
| --- | --- |
| Marketing hero `h1` | 64 px at `md`, 72 px at `xl`, Jost 500 |
| Page title in sidebar | 14 px, 500–600 |
| Sidebar row title | 14 px, 500 |
| Sidebar metadata | 12 px, 500 |
| Breadcrumb | 14 px, 600 |
| Small labels / badges | 11–12 px, 500 |
| Legal body | 15 px / 1.65, Inter 400 |

## 5. Spacing, radii, elevation

- Base spacing unit: **`--spacing: .25rem`** (4 px).
- Sidebar horizontal padding: **18 px** at large breakpoints.
- Sidebar row padding: **12 px 18 px**.
- Row gap: **8 px**.
- Standard sidebar button height: **45 px** (`--h-sidebar-button`); repertoire summary rows are **60 px**.
- Radii: `sm .125rem`, `md .375rem`, `lg .5rem`, `xl .75rem`, `2xl 1rem`.
- Shadows are rare. The board and raised cards use `shadow` / `shadow-xl`; the clone’s toasts add a soft `0 10px 30px rgba(0,0,0,.45)`.
- Borders are 1 px at `gray-40`/`gray-46` opacity; the marketing header uses a 2 px bottom border.

## 6. Layout

### Desktop app shell (1440 × 900)

| Region | Geometry |
| --- | --- |
| Board | `x=111, y=121, w=520, h=520` |
| Board square | `65 × 65` |
| Gap board ↔ sidebar | `48 px` |
| Sidebar | `x=679, y=121, w=650, h≈732` |
| Sidebar inner padding | `18 px` |
| First repertoire row | `x=679, y=159.2, w=650, h=60` |
| Top-right Settings | `x≈1244, y=18` |
| Content margins | `111 px` left/right at 1440 |

The shell is centered and constrained by the content width; the board and sidebar share the same top edge. Settings lives in the global top bar, not in the sidebar.

### Mobile (390 × 844)

The mobile capture is a different composition, not a reflow:

- The board sits behind/above a swipe surface and is cropped to a two-rank peek at the top.
- The sidebar becomes the full-width page content beneath the board.
- The top bar keeps Settings at the right and Back at the left.
- The board is still 8 × 8, but its visible viewport is intentionally clipped.

This is why mobile pages under `m/` are separate captures. Desktop pages redirect to them under 768 px.

## 7. Components

### Sidebar row (`sidebar-button`)

- Flex row, space-between, align center.
- Background `sidebar_button_primary`, hover `sidebar_button_primary_hover`.
- `min-height: 45px` (summary rows `60px`).
- `padding: 12px 18px`.
- `cursor: pointer`, `user-select: none`, `touch-manipulation`.
- Left: title + optional progress/metadata; right: chevron, value, or action.
- Progress bars use a thin track with a green fill.

### Breadcrumb

- Left-to-right: back chevron? No — the global `Back` button is separate.
- Sequence: `White openings › Build` / `Learn` / `Practice`.
- Current crumb is `text-tertiary` and not clickable; ancestors are `text-secondary` and clickable.
- 14 px, 600 weight.

### Board

- 8 × 8 absolute-positioned piece layer above a square grid.
- Piece SVG naming: `wK`, `wQ`, `wR`, `wB`, `wN`, `wP`, and lowercase `b*`.
- Squares are `position: relative`, 12.5% × 12.5%.
- Board container is square via `padding-bottom: 100%`.
- The production board places a transparent pointer surface above the square grid; the clone resolves squares from click coordinates for this reason.
- Coordinates are rendered as small labels around the edge.

### Practice feedback (clone additions)

- Selected square: inset 4 px green ring.
- Legal target: dark translucent dot; captures use a ring instead.
- Correct move: green pulse + toast.
- Wrong move: red pulse, toast, then the move is undone.
- Show answer: plays the expected SAN and dims the answer.

### Primary action / focus action

- Large full-width row with `sidebar-button` styling and a prominent label.
- Examples: “Get started”, “Log in”, “Create repertoire”, “Start training”.
- In the clone these are often `div[data-testid="sidebar-focus-action"]`, not `<button>`; `boot.js` handles both.

### Toast (clone addition)

- Fixed bottom center.
- Dark raised card, 8 px radius, 13 px Inter 500.
- Green dot for success, red dot for errors.
- Auto-dismiss after 2.6 s; `role="status"`, `aria-live="polite"`.

## 8. Motion

- UI transitions are short: **130–250 ms**, ease-out.
- Sidebar rows use background-color and opacity transitions only.
- Board pieces move with a **130 ms** left/top transition in the clone.
- Correct/wrong feedback is a 420–620 ms pulse; no confetti or large camera moves on training screens.
- Marketing pages are static captures; their motion is intentionally not recreated.

## 9. Responsive strategy

- Tailwind-style breakpoints from the production CSS: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`.
- Desktop: board + sidebar side by side.
- Mobile: dedicated 390 × 844 captures; `boot.js` redirects at `max-width: 767px`.
- Marketing page: genuinely responsive, because it was captured as normal flow markup rather than fixed-position app chrome.
- Legal pages: responsive, max-width 820 px.

## 10. Asset conventions

- Local piece SVGs: `pieces/chessbook_monochrome/{w,b}{K,Q,R,B,N,P}.svg`.
- Board colors and piece sizing are inline in the captured DOM; do not restyle the board pieces globally.
- Marketing images keep their production names in `homepage_imgs/`.
- Query-string versions from production (`?v=…`) are stripped; the unversioned file is served.
- All root-absolute URLs are rewritten to relative paths by `tools/build_pages.py` for GitHub Pages subpath compatibility.

## 11. Accessibility notes

- The captured app uses semantic buttons for most controls, but several clickable rows are `div`s with `cursor: pointer`; the clone adds navigation handlers but does not rewrite the DOM.
- Toast messages are announced via `aria-live="polite"`.
- Board moves can be played with mouse/touch; keyboard-only board play is not implemented.
- Color is not the only feedback for practice: correct/wrong also produce a text toast.
- Focus outlines from the production CSS are preserved on real buttons.

## 12. Do / don’t

**Do**

- Add new UI with the neutral OKLCH ramp and the two self-hosted variable fonts.
- Keep the board at 520 px on desktop and 65 px squares.
- Use `sidebar-button` geometry (45/60 px height, 12/18 px padding, 8 px gaps).
- Prefer a single primary action per screen.
- Use relative URLs so the site works under a Pages subpath.

**Don’t**

- Recolor or re-draw the board pieces.
- Introduce a new accent hue for ordinary actions.
- Add large shadows, gradients or rounded-pill buttons; the app is restrained.
- Try to make the captured desktop DOM reflow into mobile; use the `m/` captures.
- Avoid cloud or account assumptions; the app is local-first.
