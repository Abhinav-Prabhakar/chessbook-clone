export type Color = "white" | "black";

export interface User {
  id: number;
  email: string;
  name: string;
  plan: string;
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

export interface Settings {
  boardTheme: "green" | "blue" | "brown";
  coordinates: boolean;
  legalMoves: boolean;
  sound: boolean;
  showHints: boolean;
  dailyGoal: number;
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
