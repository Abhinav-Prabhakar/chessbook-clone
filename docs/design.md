# Design notes

The look follows the production Chessbook web app (measured from captured pages): a dark page, a 520 px board on the
left and a 650 px sidebar on the right, Inter for UI text and Jost for titles.

## Layout

- **One board.** `AppShell` renders the board column (breadcrumbs, board, move strip) and the sidebar. The board
  never unmounts. Pages call `useBoard({ fen, orientation, lastMove, arrows, marks, interactive, peek, onMove })`;
  passing `null` keeps the current position while a page loads.
- **Slots.** `<Crumbs>` and `<BoardCaption>` render into fixed places in the board column through portals.
- **Transitions.** Only the sidebar content animates when the route changes (fade + 14 px slide, 260 ms). Pieces
  slide between any two positions because each piece keeps its identity (`matchPieces` in `Board.tsx`).
- **Board column** is sticky on desktop, so the board stays in view while the sidebar scrolls.
- **Phones (≤ 900 px):** top bar, board full width, sheet below. Pages that don't use the board set `peek: true`
  and the board shrinks to a dimmed two-rank strip.

## Tokens

Colours are `oklch` tokens in `app/src/styles/app.css` (`--bg`, `--surface`, `--row`, `--text-*`, `--green`,
`--blue`, `--orange`, `--red`). Board themes are five light/dark pairs in `Board.tsx`.

## Board feedback

| State | Look |
| --- | --- |
| Last move | teal on both squares |
| Selected piece | yellow square, olive dots on legal targets |
| New move to learn | green arrow |
| Hint | pulsing orange square on the piece to move; second hint is an orange arrow |
| Wrong move | the move is shown with a red target square for 650 ms, then taken back |
| Hovering a candidate in the builder | arrow for that move |

## Copy

Short, plain sentences addressed to the player. No mention of data sources, captures, accounts or implementation
details on screen; those live in `/about` and `STATUS.md`.
