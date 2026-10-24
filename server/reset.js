/**
 * Start over: delete the local database. The next start-up re-imports the
 * bundled data and creates the starter repertoires.
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "data");
for (const suffix of ["", "-wal", "-shm"]) rmSync(join(dir, `chessbook.db${suffix}`), { force: true });
console.log("[db] deleted server/data/chessbook.db — it will be recreated on the next start");
