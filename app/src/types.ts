export type Color = "white" | "black";

export interface UserProfile {
  ratingSystem: string;
  timeControl: string;
  singleElo: number;
  eloRange: string;
  coverageGoal: number;
  pieceSet?: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  plan: string;
  ratingSystem?: string;
  singleElo?: number;
  eloRange?: string;
  coverageGoal?: number;
  profile?: UserProfile;
  preferences?: Settings;
}

export interface Repertoire {
  id: number;
  color: Color;
  name: string;
  description: string;
  totalLines: number;
  lineCount: number;
  learned: number;
  mastered: number;
  saved: number;
  due: number;
  completion: number;
  mastery: number;
  createdAt: string;
  slug?: string | null;
  /* Move-level counts from the per-position training engine. */
  moveCount?: number;
  positionCount?: number;
  duePositions?: number;
  fresh?: number;
  learnedPositions?: number;
  masteredPositions?: number;
  moveCompletion?: number;
  moveMastery?: number;
  chapterCount?: number;
  characteristics?: {
    available: boolean;
    effectiveness?: number | null;
    soundness?: number | null;
    learnability?: number | null;
    avgCpLoss?: number | null;
    expectedResults?: number | null;
    sharpness?: number | null;
    [key: string]: unknown;
  };
  coverage?: number | null;
}

export interface Line {
  id: number;
  openingId: number | null;
  name: string;
  moves: string[];
  pgn: string;
  fen: string;
  side: Color;
  expectedSan: string;
  learned: boolean;
  mastered: number;
  saved: boolean;
  dueAt: string | null;
  due: boolean;
  wrong?: number;
  /* Per-position view fields returned by /learn and /practice tasks. */
  ply?: number | null;
  epd?: string | null;
  alternatives?: string[];
}

export interface TaskStats {
  due: number;
  saved: number;
  mastered: number;
  streak: number;
}

export interface DashboardData {
  user: User;
  repertoires: Repertoire[];
  tasks: TaskStats;
  modelGame: {
    id: number;
    white: string;
    black: string;
    event: string;
    year: string;
    result: string;
  } | null;
  connected: boolean;
}

export type BoardTheme =
  | "green"
  | "blue"
  | "brown"
  | "lichess-green"
  | "chesscom-green";
export type ReviewStyle = "cards" | "complete-once" | "complete-every" | "entire-line";
export type PracticeModePreference = "individual" | "whole-lines";
export type AnimationSpeed = "off" | "fast" | "normal";
export type RecommendedMovesSize = "compact" | "comfortable" | "large";

export interface Settings {
  boardTheme: BoardTheme;
  coordinates: boolean;
  legalMoves: boolean;
  sound: boolean;
  showHints: boolean;
  dailyGoal: number;
  modelSource?: "historical" | "masters" | "online";
  /* D135/D197: rating, coverage and review preferences live on the server. */
  ratingSystem?: string;
  timeControl?: string;
  singleElo?: number;
  eloRange?: string;
  coverageGoal?: number;
  practiceMode?: PracticeModePreference;
  reviewStyle?: ReviewStyle;
  pauseAfterMove?: 0 | 1 | 2;
  pauseOnFail?: boolean;
  pauseOnLowScore?: boolean;
  pauseWhenNote?: boolean;
  animation?: AnimationSpeed;
  haptics?: boolean;
  pieceSet?: string;
  soundVolume?: number;
  soundEffects?: Record<string, boolean>;
  recommendedMovesSize?: RecommendedMovesSize;
  notifications?: Record<string, boolean>;
}

export interface Opening {
  id: number;
  eco: string;
  name: string;
  pgn: string;
  moves: string[];
  fen: string;
  expectedSan: string;
  side: Color;
  family: string;
}

export interface ModelGame {
  id: number;
  white: string;
  black: string;
  event: string;
  year: string;
  result: string;
  pgn: string;
  description: string;
  progress: number;
}

export interface PracticeNext {
  line: Line | null;
  stats: Repertoire;
  remaining: number;
  complete: boolean;
}

export interface AttemptResult {
  correct: boolean;
  expectedSan: string;
  playedSan: string;
  line: Line;
  next: PracticeNext;
  stats: Repertoire;
}

/* ------------------------------------------------ per-position training --- */

export interface Note {
  id: number;
  epd: string;
  san: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskMove {
  ply: number;
  moveNumber: number;
  san: string;
  uci?: string;
  from: string;
  to: string;
  fen: string;
  after: string;
  epd?: string;
  side: Color;
}

export interface TaskAlternative {
  san: string;
  sanKey: string;
  lineMoveId: number;
  lineId: number;
  lineName: string;
  epd: string;
  ply: number;
  dueAt: string | null;
  due: boolean;
  stability: number;
  difficulty: number;
  lapses: number;
  reps: number;
  state: string;
  learned: boolean;
  kept: boolean;
  note?: Note | null;
}

export interface CardState {
  difficulty: number;
  expectedWrong: number;
  expectedWrongPercent: number;
  recall: number | null;
  grade: number | null;
  lastCorrect: boolean | null;
  lastReview: string | null;
  dueAt: string | null;
  intervalDays: number | null;
  reps: number;
  lapses: number;
  wrongCount: number;
  state: string;
  reviewed: boolean;
  mastered: boolean;
}

export interface CommonMoveInfo {
  epd: string;
  via: {
    epd: string;
    san: string;
    incidence: number;
    oneIn: number;
    source: string | null;
  };
}

export interface Refutation {
  available: boolean;
  playedSan?: string;
  san?: string;
  uci?: string;
  from?: string;
  to?: string;
  fen?: string;
  epd?: string;
  line?: string[];
  evalPawns?: number | null;
  mate?: boolean;
  depth?: number;
  engine?: string;
  source?: string;
  explanation?: string;
  check?: boolean;
  mateAvailable?: boolean;
  damagePawns?: number | null;
  expectedEvalPawns?: number | null;
  reason?: string;
}

export interface PracticeTask {
  epd: string;
  fen: string;
  ply: number;
  moveNumber: number;
  side: Color;
  expectedSan: string;
  acceptableSans: string[];
  alternatives: TaskAlternative[];
  lineId: number;
  lineName: string;
  lineMoveId: number;
  fullMoves: string[];
  prefix: TaskMove[];
  autoReply: TaskMove | null;
  card?: CardState;
  common?: CommonMoveInfo | null;
  plans?: { from?: string; to?: string; text?: string; san?: string }[];
  planArrows?: { from: string; to: string; label?: string | null }[];
  note: Note | null;
  noteText: string | null;
  moveNote: Note | null;
  dueAt: string | null;
  due: boolean;
  kept: boolean;
  review: {
    stability: number;
    difficulty: number;
    lapses: number;
    reps: number;
    state: string;
    lastReview: string | null;
    wrongCount: number;
  };
}

export type PracticeMode =
  | "due"
  | "all"
  | "weak"
  | "early"
  | "specific"
  | "line"
  | "common";

export interface PracticeSession {
  id: string;
  repertoireId: number;
  mode: PracticeMode;
  status: "active" | "paused" | "complete";
  total: number;
  remaining: number;
  answered: number;
  correct: number;
  wrong: number;
  skipped: number;
  cursor: number;
  complete: boolean;
  style?: ReviewStyle;
  practiceMode?: PracticeModePreference;
  replays?: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StreakSummary {
  current: number;
  highest: number;
  lastStreakDate: string | null;
  today: string;
}

export interface DailySummary {
  date: string;
  reviews: number;
  correct: number;
  wrong: number;
  goal: number;
  goalMet: boolean;
  remaining: number;
  streak: StreakSummary;
}

export interface SessionPayload {
  session: PracticeSession;
  task: PracticeTask | null;
  autoReply: TaskMove | null;
  repertoire: Repertoire;
  resumed?: boolean;
  skipped?: string | false;
  kept?: string | null;
  keptSan?: string;
  commonMoves?: CommonMoveInfo[];
  commonSource?: string;
}

export interface AttemptResponse {
  correct: boolean;
  idempotent?: boolean;
  expectedSan: string;
  playedSan: string;
  acceptableSans: string[];
  alternatives: TaskAlternative[];
  position: {
    epd: string;
    fen: string;
    ply: number;
    moveNumber: number;
    side: Color;
    lineId: number;
    lineName: string;
  };
  grade: number | null;
  scheduled: {
    stability: number;
    difficulty: number;
    lapses: number;
    reps: number;
    state: string;
    intervalDays: number;
    dueAt: string;
    lastReview: string;
  } | null;
  lapse: {
    difficulty: number;
    lapses: number;
    lastReview: string;
    lastCorrect: number;
  } | null;
  retry: boolean;
  autoReply: TaskMove | null;
  remaining: number;
  complete: boolean;
  refutation?: Refutation | null;
  card?: CardState | null;
  replay?: { replays: number } | null;
  next: {
    task: PracticeTask | null;
    autoReply: TaskMove | null;
    remaining: number;
    complete: boolean;
  };
  session: PracticeSession;
  stats: Repertoire;
  daily: DailySummary;
  reviewId: number;
  submissionId: string;
}
