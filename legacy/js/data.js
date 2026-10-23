/* Static repertoire + content data for the clone. */
export const APP = {
  user: { email: "local@chessbook.local", name: "Player", plan: "pro", rating: "1800-2000" },
  repertoires: {
    white: {
      id: "white", name: "White openings", complete: 4, saved: 7, mastered: 34,
      due: 6, total: "153 / 300",
      stats: { effectiveness: 1, soundness: 94, learnability: 59 },
    },
    black: { id: "black", name: "Black openings", complete: 0, saved: 0, mastered: 0, due: 0, total: "0 / 300", stats: { effectiveness: 0, soundness: 0, learnability: 0 } },
  },
  today: { due: 6, wrong: 4, moves: 7, streak: 0, modelGame: "Kamsky vs. Anand" },
};

export const PLANS = [
  { color: "white", name: "White openings", pct: 4, state: "active" },
  { color: "black", name: "Black openings", pct: 0, state: "idle" },
];

export const BUILD_ROOT = {
  id: "e4", san: "e4", name: "King's Pawn Game", pct: 48, eval: "+0.3", peers: ["49", "46"],
  desc: '"Best by test" according to Bobby Fischer.',
};

export const RESPONSES_E5 = [
  { san: "Nf3", name: "King's Knight Opening", pct: 87, eval: "+0.3", peers: ["49", "45"], best: true, desc: "The most natural move, developing the Knight with tempo." },
  { san: "Nc3", name: "Vienna Game", pct: 4, eval: "+0.1", peers: ["51", "44"], desc: "Developing the knight while allowing for multiple possible continuations. Nf3, Bc4, g3, and f4 are all possible lines." },
  { san: "Bc4", name: "Bishop's Opening", pct: 4, eval: "+0.1", peers: ["49", "46"], desc: "Developing the bishop while avoiding major lines and hitting the f7 pawn." },
  { san: "f4", name: "King's Gambit", pct: 3, eval: "-0.7", peers: ["48", "47"], mark: "?!", desc: "Sacrificing a pawn for a development edge and a big attack." },
  { san: "d4", name: "Center Game", pct: 2, eval: "-0.2", peers: ["52", "43"], desc: "Immediately breaking in the center and aiming for a very open position." },
  { san: "Nc3", name: "Three Knights Opening", pct: 0, eval: "+0.2", peers: ["50", "46"], hidden: true, desc: "Developing another piece and controlling the d5 square." },
  { san: "c3", name: "Ponziani Opening", pct: 1, eval: "-0.2", peers: ["50", "46"], mark: "?!", hidden: true, desc: "Advancing the c-pawn in order to play d4 and gain space in the center." },
  { san: "d3", name: "King's Pawn Game", pct: 0, eval: "+0.1", peers: ["49", "47"], hidden: true, desc: "A quiet setup, preparing to develop the bishop and knight." },
];

export const RESPONSES_BB5 = [
  { san: "Bb5", name: "Ruy Lopez", pct: 52, eval: "+0.5", peers: ["51", "45"], best: true, desc: "Threatening the knight on c6, which is a key defender of the e5 pawn. This move also prepares to castle kingside." },
  { san: "Bc4", name: "Italian Game", pct: 25, eval: "+0.3", peers: ["50", "46"], desc: "Targeting the weak f7 square, which is only defended by the king. This move also prepares to castle kingside." },
  { san: "d4", name: "Scotch Game", pct: 14, eval: "+0.1", peers: ["52", "43"], desc: "Challenging the center immediately. If black captures, white can recapture with the knight, gaining central control and tempo." },
  { san: "Nc3", name: "Three Knights Opening", pct: 7, eval: "+0.2", peers: ["50", "46"], desc: "Developing another piece and controlling the d5 square. This move also prepares to castle kingside." },
  { san: "c3", name: "Ponziani Opening", pct: 1, eval: "-0.2", peers: ["50", "46"], mark: "?!", desc: "Advancing the c-pawn in order to play d4 and gain space in the center." },
];

export const RESPONSES_D6 = [
  { san: "d4", name: "Center Attack", pct: 53, eval: "+0.7", peers: ["53", "42"], best: true, desc: "Breaking in the center, taking advantage of the pin on the c6 knight." },
  { san: "O-O", name: "Castle", pct: 22, eval: "+0.5", peers: ["52", "44"], desc: "Castling kingside in order to keep the development advantage." },
  { san: "c3", name: "Ruy Lopez", pct: 12, eval: "+0.5", peers: ["53", "43"], desc: "Preparing d4, to gain a space advantage in the center." },
  { san: "h3", name: "Ruy Lopez", pct: 5, eval: "+0.3", peers: ["53", "43"], desc: "A useful waiting move, preventing ...Bg4 and preparing d4." },
  { san: "Bxc6+", name: "Exchange Variation", pct: 3, eval: "+0.4", peers: ["50", "44"], desc: "Exchanging the bishop for the knight in order to double black's pawns." },
  { san: "Nc3", name: "Ruy Lopez", pct: 2, eval: "+0.7", peers: ["49", "46"], desc: "Developing the final minor piece and preparing d4." },
  { san: "d3", name: "Ruy Lopez", pct: 2, eval: "+0.3", peers: ["48", "47"], desc: "A modest setup, keeping the tension in the center." },
];

export const OPPONENT_MOVES = [
  { san: "d6", name: "Steinitz Defense", incidence: "1 in 14 games", desc: "Moving the pawn to d6 supports the e5 pawn and opens up lines for the bishop and queen. However, this move is somewhat passive and can lead to a cramped position." },
  { san: "a6", name: "Morphy Defense", incidence: "1 in 18 games", desc: "Pushing the pawn to a6 is preparing to kick the bishop away from b5, which is a common idea in the Ruy Lopez opening. This move also prepares for b5 and Bb7, developing the bishop to a strong diagonal." },
  { san: "Nf6", name: "Berlin Defense", incidence: "1 in 26 games", desc: "Developing the knight to f6 attacks the e4 pawn and prepares for d5, aiming to challenge white's control of the center. This move also allows for Be7 and castling kingside." },
];

export const FIRST_MOVES = [
  { san: "e4", name: "King's Pawn Game", desc: '"Best by test" according to Bobby Fischer.', pct: 48, eval: "+0.3", peers: ["49", "46"] },
  { san: "d4", name: "Queen's Pawn Game", desc: "The Queen's Pawn opening is more usually more positional in nature, White intends to develop the pieces while having a share of the center.", pct: 34, eval: "+0.3", peers: ["52", "43"] },
  { san: "Nf3", name: "Zukertort Opening", desc: "A flexible first move that can transpose to many different lines.", pct: 10, eval: "+0.2", peers: ["50", "44"] },
  { san: "c4", name: "English Opening", desc: "Advancing the c-pawn, aiming to develop the queenside knight with a very flexible position.", pct: 6, eval: "+0.2", peers: ["51", "43"] },
];

export const MODEL_GAME = {
  white: "Kamsky", black: "Anand", whiteElo: 2695, blackElo: 2720,
  event: "Candidates FIDE sf1", result: "Kamsky defeated Anand in 45 moves.",
  match: "Sicilian Defense: Accelerated Dragon, Modern Bc4 Variation",
  eval: "+0.3",
  pgn: "1. e4 c5 2. Nf3 Nc6 3. Bb5 g6 4. Bxc6 dxc6 5. d3 Bg7 6. h3 Nf6 7. Nc3 O-O 8. Be3 b6 9. Qd2 e5",
};

export const OPENINGS = [
  { eco: "B20", name: "Sicilian Defense", side: "black", pct: 100 },
  { eco: "C20", name: "King's Pawn Game", side: "black", pct: 45 },
  { eco: "C00", name: "French Defense", side: "black", pct: 75 },
  { eco: "B10", name: "Caro-Kann Defense", side: "black", pct: 60 },
  { eco: "B01", name: "Scandinavian Defense", side: "black", pct: 20 },
];
