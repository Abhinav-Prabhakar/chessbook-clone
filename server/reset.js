import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "data");
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(join(dir, `chessbook.db${suffix}`), { force: true });
}
const { db } = await import("./db.js");
console.log(
  `[db] reset with ${db.prepare("SELECT COUNT(*) AS n FROM openings").get().n} openings and ${
    db.prepare("SELECT COUNT(*) AS n FROM lines").get().n
  } repertoire lines`
);
process.exit(0);
