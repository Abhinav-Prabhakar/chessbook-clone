# Chessbook — full-stack clone

A working, full-stack recreation of [chessbook.com](https://chessbook.com/): a React front end, an Express + SQLite API, real chess opening data, accounts, and a complete opening-training loop.

The original captured marketing page is preserved pixel-for-pixel and is still served at `/signup/`. The React app uses the same production CSS, typography, board colours, piece SVGs, and shell geometry (board 520 × 520, 48 px gutter, 650 px sidebar).

## What works

- **Exact landing page** — the captured production landing page markup and CSS render at `/`, with working Log in, Sign up, and Try it for free actions.
- **No-signup trial** — “Try it for free” starts a disposable guest account and drops you straight into the app. No registration or payment details.
- **Accounts** — register, log in, log out, HttpOnly `cb_session` cookies, bcrypt password hashes, 30-day sessions.
- **Multiple repertoires** — white/black repertoires, create new ones, and switch between them by ID.
- **Opening database** — 3,865 real ECO openings imported from the open-source [Lichess chess-openings](https://github.com/lichess-org/chess-openings) TSV set.
- **Builder tree** — walk from the first move through your repertoire branch by branch, see candidate moves with mastery/eval/peer columns, disable or remove branches, autofill gaps, add alternatives, and import PGN.
- **Gap finder** — identifies the least-mastered line, shows candidate continuations from the position, and lets you add one directly.
- **Learn** — practice everything due, just past mistakes, all moves, or a specific opening.
- **Practice** — click-to-move board with legal move dots, API-validated answers, wrong-move feedback, show-answer, per-session accuracy, and spaced scheduling (3 days correct / 30 days mastered).
- **Model games** — play through annotated master games with an evaluation graph, move list, keyboard controls, hints, and saved progress.
- **Settings** — rating, coverage, connected accounts, daily goal, board theme, coordinates, legal-move dots, sound, haptics, and progress reset. Board preferences apply throughout the app.
- **Legal pages** — privacy, fulfillment, and terms.
- **Responsive layout** — desktop and mobile shells, including a mobile board/sidebar stack.
- **SQLite persistence** — users, sessions, repertoires, lines, attempts, settings, openings, and model games.

## Stack

- **Frontend:** React 19, React Router 7, Vite 8, TypeScript, `chess.js`
- **Backend:** Express 5, Node 26 built-in `node:sqlite`, `bcryptjs`, `cookie-parser`
- **Data:** Lichess ECO openings TSV files in `server/data/`
- **Styles/assets:** original production CSS (`_build/assets`), Jost/Inter fonts, and Chessbook monochrome piece SVGs

## Run it

```bash
npm install
npm run dev
```

- React/Vite: <http://localhost:5173>
- API/Express: <http://localhost:8787>

The Vite dev server proxies `/api`, `/signup`, `/_build`, `/homepage_imgs`, `/pieces`, and `/site_manifest.json` to Express.

### Production

```bash
npm run build
npm start
# open http://localhost:8787
```

Express serves the built React app from `app/dist`, the original marketing page at `/signup/`, and the shared production assets.

### Reset the demo database

```bash
npm run db:reset
```

This deletes `server/data/chessbook.db*` and recreates the demo account, both 50-line repertoires, the opening DB, model game, and settings.

## Demo account

- **Email:** `local@chessbook.local`
- **Password:** `local-only`

The demo starts with the captured state: 4 % white completion, 34 % mastery, 7 saved lines, 6 lines due, and a black repertoire ready to start.

Or click **Try it for free** on the landing page for a guest account with the same starter repertoire, no signup needed.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Landing page when logged out; dashboard when logged in |
| `/login`, `/register` | Account screens |
| `/repertoire/:id` | Repertoire overview (also accepts `white`/`black`) |
| `/build/:id` | Builder tree (`?path=e4,c5`, `?line=…`, `?add=1`) |
| `/gap/:id` | Biggest-gap candidate finder |
| `/learn/:id` | Training mode selector |
| `/practice/:id` | Practice session (`?mode=due|weak|all`, `?line=…`) |
| `/model`, `/model/:id` | Model games |
| `/settings` | Settings |
| `/add` | Create a repertoire |
| `/legal/:kind` | Privacy, fulfillment, terms |
| `/signup/` | Original captured marketing page |

## Project layout

```text
app/
  src/
    pages/          React screens, including the exact landing body
    components/     Board, sidebar/rows, toasts
    styles/app.css  production shell + component styles
    api.ts/auth.tsx/prefs.ts/chess.ts
  public/           fonts, pieces, images, favicons
  dist/             production build (generated)
server/
  api.js            auth, repertoires, practice, settings, model games
  db.js             schema, opening import, seed data
  index.js          Express app + marketing bridge + SPA serving
  data/*.tsv        3,865 Lichess ECO openings
  reset.js          demo database reset
```

The old static clone pages are still in the repository root for reference and GitHub Pages, but the React app is the primary experience.

## Data and attribution

Opening data comes from the open-source [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) dataset. Chessbook branding and the captured page design belong to Chessbook; this is a study/portfolio recreation and is not affiliated with Chessbook.
