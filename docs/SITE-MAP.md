# Site map & navigation

## 1. URL map

### Desktop (root)

| File | Screen | Primary capture |
| --- | --- | --- |
| `index.html` | Dashboard / home | `dashboard.html` |
| `repertoire-white.html` | White repertoire overview | `repertoire-white.html` |
| `repertoire-black.html` | Black repertoire overview | `repertoire-black.html` |
| `build-white.html` | Build / line editor | `build-white.html` |
| `gap-white.html` | Biggest gap | `gap-white.html` |
| `learn-white.html` | Learn | `learn-white.html` |
| `practice-white.html` | Practice session | `practice-white.html` |
| `settings.html` | Settings | `settings.html` |
| `model.html` | Model game | `model.html` |
| `add.html` | Add new repertoire | `add.html` |
| `welcome.html` | Onboarding tutorial | `welcome-real.html` |
| `login.html` | Log in | `login-real.html` |
| `signup/index.html` | Marketing / signup landing | `signup-real.html` |
| `privacy-policy.html` | Privacy policy | fetched fragment |
| `fulfillment_policy.html` | Fulfillment policy | fetched page |

### Mobile (`m/`)

Every app/auth screen has a 390 × 844 capture:

`m/index.html`, `m/repertoire-white.html`, `m/repertoire-black.html`, `m/build-white.html`, `m/gap-white.html`, `m/learn-white.html`, `m/practice-white.html`, `m/settings.html`, `m/model.html`, `m/add.html`, `m/welcome.html`, `m/login.html`.

The marketing page at `signup/index.html` is genuinely responsive and is not duplicated under `m/`. Its CTAs point at `m/welcome.html` / `m/login.html` on mobile.

A desktop page loaded below 768 px calls `location.replace(root + "m/" + page)`; mobile pages carry `data-root="./"` so in-app links stay inside `m/`. Legal pages are excluded from the redirect.

## 2. Navigation graph

```text
signup/index.html
├── Log in ───────────────► login.html
├── Sign up ──────────────► signup/index.html (self)
└── Try it for free ──────► welcome.html

welcome.html
├── Get started ──────────► index.html
├── Log in ───────────────► login.html
├── Sign up ──────────────► signup/index.html
└── Back ─────────────────► index.html

login.html
├── Log in / submit ──────► index.html
├── Sign up ──────────────► signup/index.html
├── Back ─────────────────► index.html
└── Forgot password ──────► inert (no backend)

index.html (dashboard)
├── White openings ───────► repertoire-white.html
├── Black openings ───────► repertoire-black.html
├── Practice moves ───────► practice-white.html
├── Add new ──────────────► add.html
├── View/Play model game ─► model.html
├── Connect account ──────► settings.html
└── Settings (top bar) ───► settings.html

repertoire-white.html
├── Continue building ────► build-white.html
├── Continue learning ────► learn-white.html
├── White openings ───────► self
├── Back ─────────────────► index.html
└── Settings ─────────────► settings.html

repertoire-black.html
├── Start adding moves ───► add.html
├── White/Black crumb ────► self
├── Back ─────────────────► index.html
└── Settings ─────────────► settings.html

build-white.html
├── Go to your biggest gap ► gap-white.html
├── White openings ───────► repertoire-white.html
├── Build (crumb) ────────► self
├── Back ─────────────────► repertoire-white.html
└── Settings ─────────────► settings.html

gap-white.html
├── Autofill this gap ────► toast → build-white.html
├── Move rows ────────────► build-white.html
├── Build (crumb) ────────► build-white.html
├── Back ─────────────────► build-white.html
└── Settings ─────────────► settings.html

learn-white.html
├── Start training / rows ► practice-white.html
├── White openings ───────► repertoire-white.html
├── Learn (crumb) ────────► self
├── Back ─────────────────► repertoire-white.html
└── Settings ─────────────► settings.html

practice-white.html
├── Board move Nf3 ───────► correct/wrong feedback
├── I don’t know, show me ► plays expected move + toast
├── View in build mode ───► build-white.html
├── Exit practice ────────► learn-white.html
├── Practice (crumb) ─────► self
├── Back ─────────────────► learn-white.html
└── Settings ─────────────► settings.html

add.html
├── Create repertoire ────► build-white.html
├── Back ─────────────────► index.html
└── Settings ─────────────► settings.html

model.html
├── Back ─────────────────► index.html
└── Settings ─────────────► settings.html

settings.html
├── Back ─────────────────► index.html
└── Settings (top bar) ───► self

privacy-policy.html / fulfillment_policy.html
└── Back to Chessbook ────► index.html
```

## 3. Screen composition

### Shell

- **Global top bar**: wordmark/logo (empty button at top-left), Settings at top-right.
- **Board column**: header portal → breadcrumbs/toolbar → 520 px board → Analyze link.
- **Sidebar column**: back button, title, primary action, stats/progress, task rows, repertoire rows, footer settings.

The board column and sidebar column are separate. On dashboard, the sidebar starts with “Repertoires” and the board shows the start position. On sub-screens, breadcrumbs occupy the board header and the sidebar carries the current task.

### Dashboard

- Repertoire summaries: white 4% complete, black not started.
- Daily tasks: practice moves, saved lines, mastered lines, due count.
- Primary CTA to continue training.
- Model-game promo card → model screen.
- Footer “Analyze” external link to Lichess.

### Repertoire overview

- Progress header (4% / 0% complete).
- “Autofill remaining gaps” (white) / “Autofill all moves” (black).
- Continue building / continue learning split actions.
- Move tree preview, stats, settings link.

### Build

- Breadcrumb `White openings › Build`.
- Board position with last move highlighted.
- Sidebar: line metadata, Remove / Disable actions, “Add an alternative move”, move list.
- Primary CTA “Go to your biggest gap”.

### Gap

- Breadcrumb `White openings › Build › 4% complete`.
- “Autofill this gap” focus action.
- Gap explanation, move rows, board preview.

### Learn

- Breadcrumb `White openings › Learn`.
- Training summary and “Start training” / continue rows.
- Sidebar actions launch practice.

### Practice

- Breadcrumb `White openings › Learn › Practice`.
- Board is interactive; expected SAN is carried by `[data-testid="expected-move"]` as `data-expected-san="Nf3"`.
- Sidebar: prompt, “I don’t know, show me the answer”, “View in build mode”, “Exit practice”, move tray.

### Settings

- Account/profile, board and training preferences, theme, sound, etc.
- Back to dashboard.

### Add new

- Repertoire name, color choice, starting position/import options.
- “Create repertoire” → build screen.

### Model game

- Model-game explanation and move-by-move board.
- Back to dashboard.

### Auth

- **Welcome**: board + tutorial steps; “Get started” enters the app.
- **Login**: email/password form with demo credentials prefilled; the large Log in action is a styled `div[data-testid="sidebar-focus-action"]`.
- **Marketing**: hero, feature sections, pricing, FAQ, footer; responsive flow layout.

## 4. Interaction ownership

| Behaviour | Location |
| --- | --- |
| Route table / `data-nav` annotations | `tools/build_pages.py` |
| Global click routing | `js/boot.js` → `handleClick` |
| Back-button hierarchy | `BACK` map in `tools/build_pages.py` + `goBack` |
| Mobile redirect | `js/boot.js` → `main` |
| Login form + prefill | `js/boot.js` → `initAuthForms` |
| Marketing CTA wiring | `js/boot.js` → `initMarketing` |
| Practice board / chess.js | `js/boot.js` → `initPractice` |
| Toasts / highlights | `js/boot.js` (injected `<style>` + helpers) |
| Legal page styling | inline `<style>` in each legal page |

## 5. State model

There is no persistent state. The visible demo state is baked into the captures:

- logged-in Pro account
- white repertoire 4% complete
- black repertoire not started
- 7 saved lines, 34% mastered, 6 due
- practice position after `1.e4 c5`, white to move, expected `Nf3`

Transient clone state:

- practice selected square + legal targets
- practice solved/undone state
- toast visibility
- mobile vs desktop routing

No `localStorage`, cookies or network calls are used.

## 6. What is intentionally not linked

The captured screens contain many production controls that are not part of the core demo loop: account deletion, billing portal, theme toggles, individual move editing, import dialogs, social links, App Store links, and password reset. They remain visually present but inert, or point to the real external service where the original did.
