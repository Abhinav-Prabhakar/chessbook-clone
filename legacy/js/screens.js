import { APP, BUILD_ROOT, RESPONSES_E5, RESPONSES_BB5, RESPONSES_D6, OPPONENT_MOVES, FIRST_MOVES, MODEL_GAME } from "./data.js";
import { state, save, setState, updateSettings } from "./state.js";
import { logoMark, icon, breadcrumb, progress, segmentMeter, moveRow, tableHead, toast, formatMoves } from "./ui.js";
import { renderBoard, fenFromMoves, pgnPosition } from "./board.js";

const WRAP = (content, extra = "") => `<div class="sidebar-content ${extra}">${content}</div>`;

function backButton() {
  return `<div class="screen-back"><button data-action="back">${icon("arrow-left")}Back</button></div>`;
}

function title(t) { return `<div class="screen-title-wrap"><h1 class="screen-title">${t}</h1></div>`; }

function boardFooter(opening, moves, opts = {}) {
  return `<div class="board-footer ${opts.hidden ? "hidden" : ""}">
    <span class="opening-name">${opening}</span>
    <span class="spacer"></span>
    <div class="movelist">${formatMoves(moves)}</div>
    ${opts.plans ? `<span class="divider"></span><button class="footer-link" data-action="plans">${icon("chess-board")}Plans</button>` : ""}
    <span class="divider"></span>
    <a class="analyze" href="https://lichess.org/analysis" target="_blank" rel="noreferrer">Analyze ${icon("up-right-from-square")}</a>
  </div>`;
}

function statusRing(kind) {
  return `<span class="status-ring ${kind}"></span>`;
}
function iconBadge(name, cls) {
  return `<span class="icon-badge ${cls}">${icon(name)}</span>`;
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */
export function dashboard() {
  const t = APP.today;
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]) },
    footer: "",
    sidebar: WRAP(`
      <div class="section-label"><span>Repertoires</span><button class="right" data-action="add-repertoire">Add new ${icon("plus")}</button></div>
      <div class="stack-8">
        <button class="row-btn tall" data-nav="#/repertoire/white">
          <div class="rb-left"><span class="status-dot filled"></span><span class="rb-title">White openings</span></div>
          <div class="rb-right"><span>4% complete</span>${statusRing("green")}</div>
        </button>
        <button class="row-btn tall" data-nav="#/repertoire/black">
          <div class="rb-left"><span class="status-dot"></span><span class="rb-title">Black openings</span></div>
          <div class="rb-right"><span class="muted">Not started</span>${statusRing("")}</div>
        </button>
      </div>
      <div class="spacer-40"></div>
      <div class="section-label"><span>Daily tasks</span><span class="right">${t.streak ? t.streak + " day streak" : "No streak"} ${icon("fire")}</span></div>
      <div class="stack-8">
        <button class="row-btn" data-nav="#/learn/white">
          <div class="rb-left"><span class="rb-title">Practice moves</span></div>
          <div class="rb-right"><span class="due">${t.due} due</span>${iconBadge("clock", "orange")}</div>
        </button>
        <button class="row-btn" data-nav="#/model">
          <div class="rb-left"><span class="rb-title">Play through a model game</span></div>
          <div class="rb-right"><span>${t.modelGame}</span>${iconBadge("circle-info", "blue")}</div>
        </button>
      </div>
      <div class="spacer-40"></div>
      <div class="section-label"><span>Review your online games</span><span class="right">Connect account ${icon("link-simple")}</span></div>
      <button class="row-btn" data-action="connect">
        <div class="rb-left"><span class="rb-title">Correct your opening mistakes</span></div>
        <div class="rb-right"><span class="muted">Not connected</span></div>
      </button>
      <button class="row-btn" data-action="connect">
        <div class="rb-left"><span class="rb-title">View performance by opening</span></div>
        <div class="rb-right"><span class="muted">Not connected</span></div>
      </button>
      <div class="spacer-48"></div>
      <div class="section-label"><span>Contact us</span></div>
      <button class="row-btn link-row" data-action="discord"><div class="rb-left"><span class="rb-title">Join the Chessbook Discord</span></div></button>
      <button class="row-btn link-row" data-action="feedback"><div class="rb-left"><span class="rb-title">Share your feedback</span></div></button>
      <button class="row-btn link-row" data-action="share"><div class="rb-left"><span class="rb-title">Help us spread the word</span></div></button>
      <div class="spacer-24"></div>
    `),
  };
}

/* ── Repertoire overview ───────────────────────────────────────────────── */
export function repertoire(route) {
  const color = route.color || "white";
  const rep = APP.repertoires[color];
  const black = color === "black";
  return {
    breadcrumb: breadcrumb([rep.name], { links: ["#/dashboard"] }),
    board: { fen: fenFromMoves([]), orientation: color },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title(rep.name)}
      <div class="spacer-36"></div>
      <div class="progress-block">
        <div class="progress-head"><span class="label">${rep.complete}% complete</span>
          <button class="aside" data-action="autofill">Autofill remaining gaps ${icon("wand-magic-sparkles")}</button></div>
        ${progress(rep.complete, "green")}
      </div>
      <button class="row-btn" data-nav="#/build/${color}">
        <div class="rb-left"><span class="rb-title">Continue building</span></div>
        <div class="rb-right"><span>${rep.saved} Saved</span></div>
      </button>
      <div class="spacer-36"></div>
      <div class="progress-block">
        <div class="progress-head"><span class="label">${rep.mastered}% mastered</span></div>
        ${progress(rep.mastered, "orange")}
      </div>
      <button class="row-btn" data-nav="#/learn/${color}">
        <div class="rb-left"><span class="rb-title">Continue learning</span></div>
        <div class="rb-right"><span class="due">${rep.due} due</span>${iconBadge("clock", "orange")}</div>
      </button>
      <div class="spacer-36"></div>
      <div class="section-label stats-label"><span>Stats ${icon("circle-info", "info")}</span></div>
      <div class="stat-grid">
        <div class="stat-cell"><div class="stat-name">Effectiveness</div><div class="stat-row">${segmentMeter(1, "gray")}<span class="stat-val">${rep.stats.effectiveness}</span></div></div>
        <div class="stat-cell"><div class="stat-name">Soundness</div><div class="stat-row">${segmentMeter(Math.round(rep.stats.soundness / 10), "green")}<span class="stat-val">${rep.stats.soundness}</span></div></div>
        <div class="stat-cell"><div class="stat-name">Learnability</div><div class="stat-row">${segmentMeter(Math.round(rep.stats.learnability / 10), "orange")}<span class="stat-val">${rep.stats.learnability}</span></div></div>
        <div class="stat-cell"><div class="stat-name">Total</div><div class="stat-row"><span class="stat-val">${rep.total}</span></div></div>
      </div>
      <div class="spacer-34"></div>
      <button class="plain-row" data-nav="#/settings"><span>Settings</span></button>
    `, "nested"),
  };
}

/* ── Build screen ──────────────────────────────────────────────────────── */
export function build(route) {
  const color = route.color || "white";
  return {
    breadcrumb: breadcrumb(["White openings", "Build"], { links: ["#/repertoire/white", "#/build/white"] }),
    board: { fen: fenFromMoves([]) },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("Continue building")}
      <div class="spacer-36"></div>
      <div class="progress-block">
        <div class="progress-head"><span class="label">4% complete</span><button class="aside" data-action="autofill">Autofill remaining gaps ${icon("wand-magic-sparkles")}</button></div>
        ${progress(4, "green")}
      </div>
      <div class="spacer-18"></div>
      <div class="table-head build-head"><span>Your first move</span><span class="grow"></span><span class="col-masters">Masters</span><span class="col-eval">Eval</span><span class="col-peer">Peer results</span></div>
      <div class="build-row" data-nav="#/gap/white" role="button" tabindex="0">
        <div class="mv"><span class="num">1.</span>${BUILD_ROOT.san}</div>
        <div class="opening">${BUILD_ROOT.name}</div>
        <div class="masters">${BUILD_ROOT.pct}%</div>
        <div class="eval">${BUILD_ROOT.eval}</div>
        <div class="peers"><span class="peer-chip light">${BUILD_ROOT.peers[0]}</span><span class="peer-chip dark">${BUILD_ROOT.peers[1]}</span></div>
        <div class="build-actions"><button data-action="remove-move">Remove ${icon("trash")}</button><button data-action="disable-move">Disable ${icon("pause")}</button></div>
      </div>
      <div class="add-alternative"><button data-action="add-alternative">Add an alternative move</button></div>
      <div class="spacer-36"></div>
      <button class="table-action build-cta" data-nav="#/gap/white"><span>Go to your biggest gap</span></button>
    `, "nested"),
  };
}

/* ── Gap / choose response ─────────────────────────────────────────────── */
export function gap(route) {
  const showAll = state.showAllGap;
  const all = RESPONSES_E5;
  const rows = (showAll ? all : all.slice(0, 5)).map((m, i) => moveRow(m, i, { number: "2." })).join("");
  return {
    breadcrumb: breadcrumb(["White openings", "Build", `<span class="bc-progress">${icon("circle")} 4% complete</span>`], { links: ["#/repertoire/white", "#/build/white", ""] }),
    board: { fen: fenFromMoves(["e4", "e5"]), lastMove: ["e7", "e5"] },
    footer: boardFooter("King's Pawn Game", ["e4", "e5"], { plans: true }),
    sidebar: WRAP(`
      ${backButton()}
      ${title("Choose a response to 1...e5")}
      <div class="spacer-36"></div>
      ${tableHead("gap-head")}
      <div class="move-table">${rows}</div>
      <div class="table-foot"><button data-action="show-more">${showAll ? "Show less" : "Show more"}</button><button data-action="notes">Add / edit notes</button></div>
      <div class="spacer-36"></div>
      <button class="table-action gap-cta" data-action="autofill-gap"><span>Autofill this gap ${icon("wand-magic-sparkles")}</span><span class="hint">Pick a style, undo anytime</span></button>
    `, "nested"),
  };
}

/* ── Learn chooser ─────────────────────────────────────────────────────── */
export function learn(route) {
  return {
    breadcrumb: breadcrumb(["White openings", "Learn"], { links: ["#/repertoire/white", "#/learn/white"] }),
    board: { fen: fenFromMoves([]) },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("What do you want to practice?")}
      <div class="spacer-36"></div>
      <div class="progress-block"><div class="progress-head"><span class="label">34.0% mastered</span></div>${progress(34, "orange")}</div>
      <div class="spacer-18"></div>
      <button class="row-btn learn-row primary" data-nav="#/practice/white?mode=due"><div class="rb-left"><span class="rb-title">Everything that's due for review</span></div><div class="rb-right"><span class="due">6 due</span>${iconBadge("clock", "orange")}</div></button>
      <button class="row-btn learn-row ghost" data-nav="#/practice/white?mode=wrong"><div class="rb-left"><span class="rb-title">Just the moves I often get wrong</span></div><div class="rb-right"><span class="due">4 due</span>${iconBadge("clock", "orange")}</div></button>
      <button class="row-btn learn-row secondary" data-nav="#/practice/white?mode=all"><div class="rb-left"><span class="rb-title">All moves, even if they're not due</span></div><div class="rb-right"><span class="muted moves-count">7 moves</span></div></button>
      <button class="row-btn learn-row ghost" data-action="specific-opening"><div class="rb-left"><span class="rb-title">A specific opening...</span></div></button>
    `, "nested"),
  };
}

/* ── Practice ──────────────────────────────────────────────────────────── */
export function practice(route) {
  const expected = "Nf3";
  return {
    breadcrumb: breadcrumb(["White openings", "Learn", "Practice"], { links: ["#/repertoire/white", "#/learn/white", "#/practice/white"] }),
    board: { fen: fenFromMoves(["e4", "c5"]), lastMove: ["c7", "c5"], interactive: true, practice: true },
    footer: boardFooter("Sicilian Defense", ["e4", "c5"]),
    sidebar: WRAP(`
      ${backButton()}
      <div class="practice-head">
        <h1 class="screen-title">Practicing moves</h1>
        <div class="practice-stats"><span>6 Due ${iconBadge("clock", "orange")}</span><span>0 ${iconBadge("circle-check", "green")}</span><span>0 ${iconBadge("circle-xmark", "red")}</span></div>
      </div>
      <div class="screen-sub"><p class="body-text">Play the correct move on the board.</p></div>
      <div class="spacer-24"></div>
      <div class="practice-move-row"><span class="pm-num">2.</span><span class="pm-blank">＿</span></div>
      <div class="notes-empty">No notes added</div>
      <div class="spacer-24"></div>
      <button class="row-btn" data-action="show-answer"><div class="rb-left"><span class="rb-title">I don't know, show me the answer</span></div></button>
      <button class="row-btn" data-nav="#/build/white"><div class="rb-left"><span class="rb-title">View in build mode</span></div></button>
      <button class="row-btn link-row" data-nav="#/learn/white"><div class="rb-left"><span class="rb-title">Exit practice</span></div></button>
    `, "nested"),
    practice: { expected, fen: fenFromMoves(["e4", "c5"]) },
  };
}

/* ── Settings ──────────────────────────────────────────────────────────── */
export function settings() {
  const s = state.settings;
  const kv = (k, v, action = "") => `<div class="kv-row" ${action ? `data-action="${action}"` : ""}><span class="k">${k}</span><span class="v">${v}</span></div>`;
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]) },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("Settings")}
      <div class="spacer-36"></div>
      ${kv("Your rating", `${s.rating}-2000 ${s.platform}`, "set-rating")}
      ${kv("Cover positions seen in", s.coverage, "set-coverage")}
      ${kv("Connected to", `<span>Lichess <span class="x">${icon("xmark")}</span></span><span>Chess.com <span class="x">${icon("xmark")}</span></span>`, "connections")}
      ${kv("Model games source", s.modelSource, "model-source")}
      ${kv("Early access features", s.earlyAccess, "early-access")}
      <div class="setting-group-label">Review settings</div>
      ${kv("Practice", s.practice, "practice-mode")}
      ${kv("Daily practice goal", s.dailyGoal, "daily-goal")}
      ${kv("Pause after playing a move", s.pause, "pause-setting")}
      <div class="setting-group-label">Board settings</div>
      ${kv("Appearance", s.appearance, "appearance")}
      ${kv("Piece animation", s.animation, "animation")}
      ${kv("Sound effects", s.sound ? "Enabled" : "Disabled", "sound")}
      ${kv("Haptics", s.haptics ? "Enabled" : "Disabled", "haptics")}
      <div class="setting-group-label">Subscription</div>
      ${kv("Chessbook Pro", `<span class="pro-badge">Active</span>`, "subscription")}
      <div class="setting-group-label">Account</div>
      <button class="kv-row" data-action="reset-learning"><span class="k">Reset all learning</span></button>
      <button class="kv-row" data-action="delete-account"><span class="k danger">Delete your account</span></button>
      <button class="kv-row" data-action="logout"><span class="k">Log out</span><span class="v">${state.user.email}</span></button>
      <div class="spacer-48"></div>
    `, "nested"),
  };
}

/* ── Model game ────────────────────────────────────────────────────────── */
export function model() {
  const { fen } = pgnPosition(MODEL_GAME.pgn, 0);
  return {
    breadcrumb: breadcrumb(["Model games"], { links: ["#/dashboard"] }),
    board: { fen },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("Kamsky vs. Anand")}
      <div class="spacer-36"></div>
      <div class="eval-graph">${evalGraph()}<span class="eval-label">+0.3</span></div>
      <div class="spacer-36"></div>
      <div class="two-buttons"><button class="row-btn" data-action="next-move"><span class="rb-title">Play next move</span></button><button class="row-btn" data-action="hint"><span class="rb-title">Give me a hint</span></button></div>
      <div class="spacer-36"></div>
      <div class="model-copy">
        <p class="body-text"><strong>This game matches your saved moves</strong> in the Sicilian Defense: Accelerated Dragon, Modern Bc4 Variation. Move the pieces on the board to guess the move at any point.</p>
        <p class="body-text">In this game between Kamsky (2695) and Anand (2720) at the "Candidates FIDE sf1", Kamsky defeated Anand in 45 moves.</p>
      </div>
      <div class="spacer-24"></div>
      <button class="row-btn link-row" data-action="random-game"><div class="rb-left"><span class="rb-title">Choose another random game</span></div></button>
      <button class="row-btn link-row" data-action="previous-games"><div class="rb-left"><span class="rb-title">View previous model games</span></div></button>
      <button class="row-btn link-row" data-action="model-source"><div class="rb-left"><span class="rb-title">Model games source</span></div><div class="rb-right"><span class="muted">Online and master games</span></div></button>
    `, "nested"),
  };
}

function evalGraph() {
  const pts = [];
  const n = 90;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 600;
    let y = 42 - Math.sin(i * .22) * 3 - i * 0.08;
    if (i > 40 && i < 55) y -= 2;
    if (i > 64) y -= (i - 64) * 1.1;
    y = Math.max(4, Math.min(50, y));
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `<svg viewBox="0 0 600 56" preserveAspectRatio="none" class="eval-svg">
    <polygon points="0,56 ${pts.join(" ")} 600,56" fill="rgb(232,232,236)"></polygon>
    <line x1="2" y1="0" x2="2" y2="56" stroke="oklch(75% 0.1417 230)" stroke-width="2"></line>
  </svg>`;
}

/* ── Add repertoire ────────────────────────────────────────────────────── */
export function addRepertoire() {
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]) },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("Add new repertoire")}
      <div class="screen-sub title-gap">
        <p class="body-text">A repertoire is a collection of openings for a particular color.</p>
        <p class="body-text">You should only create a new repertoire if you want something entirely different (e.g. moves for bullet vs blitz). Otherwise we recommend adding alternate moves to an existing one.</p>
      </div>
      <div class="spacer-24"></div>
      <div class="field-label list-label">Color</div>
      <button class="choice-row selected" data-action="choose-color" data-color="white"><span>White</span>${icon("check")}</button>
      <button class="choice-row" data-action="choose-color" data-color="black"><span>Black</span></button>
      <div class="spacer-24"></div>
      <div class="form-pad"><label class="field-label" for="rep-name">Name</label><input class="text-input" id="rep-name" value="Blitz"></div>
      <div class="spacer-24"></div>
      <button class="table-action" data-action="create-repertoire"><span>Create repertoire</span></button>
    `, "nested"),
  };
}

/* ── Auth ──────────────────────────────────────────────────────────────── */
export function login() {
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]) },
    footer: "",
    topRight: `<button class="top-link" data-nav="#/settings">Settings ${icon("gear")}</button><button class="top-link" data-nav="#/login">Log in ${icon("right-to-bracket")}</button><button class="top-link" data-nav="#/welcome">Sign up ${icon("user-plus")}</button>`,
    sidebar: WRAP(`
      ${backButton()}
      ${title("Log in")}
      <div class="spacer-36"></div>
      <form class="login-form" data-form="login">
        <div class="login-fields">
          <div><label class="field-label" for="email">Email</label><input class="text-input" id="email" name="email" type="email" placeholder="example@gmail.com" value="${state.user.email}"></div>
          <div><label class="field-label" for="password">Password</label><input class="text-input" id="password" name="password" type="password"></div>
        </div>
        <button type="button" class="forgot">Forgot your password?</button>
        <button class="table-action" type="submit"><span>Log in</span></button>
      </form>
    `, "nested"),
  };
}

export function welcome() {
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]) },
    footer: "",
    topRight: `<button class="top-link" data-nav="#/login">Log in ${icon("right-to-bracket")}</button><button class="top-link" data-nav="#/welcome">Sign up ${icon("user-plus")}</button>`,
    sidebar: WRAP(`
      ${backButton()}
      ${title("Set up your Chessbook")}
      <div class="spacer-36"></div>
      <div class="screen-sub"><p class="body-text">This tutorial will cover the basics of choosing opening moves and practicing them.</p><p class="body-text">It should take around 2 minutes to complete.</p></div>
      <div class="spacer-36"></div>
      <button class="table-action" data-nav="#/onboarding/rating"><span>Get started</span></button>
    `, "nested"),
  };
}

export function onboardingRating() {
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]) },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("What's your rating?")}
      <div class="screen-sub title-gap"><p class="body-text">This is used to determine which moves your opponents are likely to play.</p></div>
      <div class="rating-ui">
        <div class="rating-number">1500</div>
        <div class="rating-axis"><div class="tick" style="left:0"></div><div class="tick" style="left:50%"></div><div class="tick" style="left:100%"></div><div class="rating-marker"></div></div>
        <div class="rating-nav"><button>${icon("chevron-left")}</button><button class="grip">${icon("grip-lines-vertical")}</button><button>${icon("chevron-right")}</button></div>
      </div>
      <div class="rating-rows">
        <button class="kv-row" data-action="platform"><span class="k">Platform</span><span class="v">Chess.com</span></button>
        <button class="kv-row" data-action="time-control"><span class="k">Time control</span><span class="v">Blitz</span></button>
      </div>
      <div class="spacer-36"></div>
      <button class="table-action" data-nav="#/onboarding/first"><span>Set rating and continue</span></button>
      <button class="table-action secondary" data-nav="#/onboarding/first"><span>I don't know, skip this step</span></button>
    `, "nested"),
  };
}

export function onboardingFirst() {
  return {
    breadcrumb: "",
    board: { fen: fenFromMoves([]), interactive: true },
    footer: "",
    sidebar: WRAP(`
      ${backButton()}
      ${title("Let's add your first move")}
      <div class="screen-sub title-gap"><p class="body-text">Select from the list or play it on the board.</p></div>
      <div class="spacer-24"></div>
      <div class="table-head"><span>Your first move</span><span class="grow"></span><span>Show stats</span></div>
      ${FIRST_MOVES.map((m, i) => moveRow(m, i, { number: "1." })).join("")}
      <div class="table-foot"><button data-action="something-else">Something else...</button></div>
    `, "nested"),
  };
}
