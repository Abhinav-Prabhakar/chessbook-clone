/**
 * Curated demo repertoire lines.
 *
 * Kept in a dependency-free module so both the runtime seed (`server/db.js`)
 * and the offline explorer-data builder (`server/tools/build-explorer-data.mjs`)
 * can use the same target positions without booting SQLite.
 *
 * Every line is a real, legal opening line that ends on the repertoire
 * colour's move.
 */
export const SEED_LINES = {
  white: [
    ["Sicilian Defense: Open", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4"],
    ["Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 h3"],
    ["Sicilian Defense: Kan Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 c4"],
    ["Sicilian Defense: Closed", "e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3"],
    ["Italian Game: Classical Variation", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4"],
    ["Ruy Lopez: Morphy Defense", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3"],
    ["French Defense: Classical Variation", "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4"],
    ["Caro-Kann Defense: Classical Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4"],
    ["Scandinavian Defense: Main Line", "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3"],
    ["Queen's Gambit Declined: Harrwitz Attack", "d4 d5 c4 e6 Nc3 Nf6 Bf4 Be7 e3"],
    ["King's Indian Defense: Normal Variation", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2"],
    ["Queen's Indian Defense: Petrosian Variation", "d4 Nf6 c4 e6 Nf3 b6 a3 Bb7 Nc3"],
    ["English Opening: Four Knights System", "c4 e5 Nc3 Nf6 Nf3 Nc6 e4 Bb4 d3"],
    ["Catalan Opening: Closed", "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 c4 O-O b3"],
    ["Bishop's Opening", "e4 e5 Bc4 Nf6 d3 c6 Nf3"],
    ["London System", "d4 d5 Nf3 Nf6 Bf4 e6 e3 c5 c3"],
  ],
  black: [
    ["Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"],
    ["Sicilian Defense: Accelerated Dragon", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7"],
    ["Sicilian Defense: Taimanov Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7"],
    ["Italian Game: Classical Variation", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4"],
    ["Ruy Lopez: Brix Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O g6"],
    ["French Defense: Classical Variation", "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5"],
    ["Caro-Kann Defense: Classical Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6"],
    ["Scandinavian Defense: Gubinsky-Melts Defense", "e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 c6"],
    ["Queen's Gambit Declined: Normal Defense", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"],
    ["King's Indian Defense: Normal Variation", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5"],
    ["Nimzo-Indian Defense: Normal Line", "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5"],
    ["English Opening: Four Knights Variation", "c4 e5 Nc3 Nf6 Nf3 Nc6 e4 Bb4 d3 d6"],
    ["Dutch Defense: Classical Variation", "d4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O"],
    ["Slav Defense: Modern Line", "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5"],
  ],
};

/** Flat SAN lists for the builder. */
export function seedLineSans() {
  return [...SEED_LINES.white, ...SEED_LINES.black].map(([, sans]) =>
    sans.split(/\s+/).filter(Boolean)
  );
}
