export type Color = "white" | "black";

export interface Settings {
  rating: number;
  ratingSystem: "lichess" | "chesscom" | "fide";
  timeControl: "bullet" | "blitz" | "rapid" | "classical";
  coverageGoal: number;
  boardTheme: "green" | "blue" | "brown" | "gray" | "purple";
  pieceSet: string;
  coordinates: boolean;
  legalMoves: boolean;
  sound: boolean;
  animation: "off" | "fast" | "normal" | "slow";
  dailyGoal: number;
  reviewStyle: "selective" | "every" | "once";
  reviewPauseBehavior: "never" | "always" | "when-wrong" | "when-annotation";
  skipFirstPractice: boolean;
  onboarded: boolean;
  modelSide: string;
}

export interface Opening {
  eco: string;
  name: string;
}

export interface Gap {
  path: string[];
  expectedIn: number | null;
  lastMove: string | null;
  ply: number;
  label: string;
  opening: Opening | null;
}

export interface RepertoireSummary {
  id: number;
  name: string;
  color: Color;
  completion: number;
  stats: {
    saved: number;
    mine: number;
    fresh: number;
    due: number;
    learned: number;
    mastered: number;
    masteredPercent: number;
  };
  due: number;
  fresh: number;
  difficult: number;
  scheduled: number;
  nextDue: string | null;
  biggestGap: Gap | null;
  gapCount: number;
  started: boolean;
}

export interface Daily {
  today: string;
  reviewed: number;
  correct: number;
  goal: number;
  streak: number;
  bestStreak: number;
  practicedToday: boolean;
}

export interface Candidate {
  san: string;
  uci: string;
  from: string;
  to: string;
  name: string | null;
  masters: { share: number; games: number } | null;
  peers: { share: number; games: number; white: number; draw: number; black: number } | null;
  note: string | null;
  ownNote: boolean;
  saved: boolean;
  expectedIn: number | null;
  coverage?: number | null;
  rare?: boolean;
}

export interface PositionMove {
  san: string;
  from: string;
  to: string;
  fen: string;
}

export interface EngineEval {
  depth: number;
  eval: number | null;
  mate: number | null;
  best: string | null;
  moves: { san: string; eval: number | null; mate: number | null; pv: string[] }[];
}

export interface PositionView {
  repertoire: { id: number; name: string; color: Color };
  path: string[];
  fen: string;
  epd: string;
  turn: Color;
  mine: boolean;
  ply: number;
  moves: PositionMove[];
  lastMove: { from: string; to: string } | null;
  opening: Opening | null;
  onRepertoire: boolean;
  reach: number;
  expectedIn: number | null;
  belowGoal: boolean;
  coverageGoal: number;
  saved: { san: string; mine: boolean; note: string | null; reps: number; source: string }[];
  mySaved: string[];
  candidates: Candidate[];
  positionNote: string | null;
  eval: EngineEval | null;
  data: { masters: number; peers: number; band: string };
  gameOver: boolean;
}

export interface QuizMove {
  moveId: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  note: string | null;
  /** First practice: shown with an arrow. */
  learning: boolean;
  due: boolean;
  /** No saved continuation after this move. */
  leaf: boolean;
}

export interface QuizGroup {
  epd: string;
  fen: string;
  line: string[];
  side: Color;
  synthetic: boolean;
  opening: Opening | null;
  moves: QuizMove[];
  preceding: QuizGroup[];
  /** A repeat of a group already scored this session (never reported). */
  retry?: boolean;
}

export interface PracticeSession {
  repertoireId: number;
  color: Color;
  filter: string;
  style: Settings["reviewStyle"];
  pause: Settings["reviewPauseBehavior"];
  groups: QuizGroup[];
}

export interface ModelGame {
  id: number;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  year: number | null;
  result: string;
  eco: string | null;
  sans: string[];
  moves: { san: string; from: string; to: string; uci: string; fen: string }[];
  opening: Opening | null;
  repertoire: { id: number; name: string; color: Color } | null;
  side: Color;
  follows: number;
  progress: { ply: number; correct: number; wrong: number; completed: boolean; daily: string | null } | null;
}
