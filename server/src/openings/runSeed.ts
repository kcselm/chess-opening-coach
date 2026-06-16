import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { createDb } from "../db/client.js";
import { seedOpenings, type OpeningRow } from "./seed.js";

const dir = "./data/openings";
const rows: OpeningRow[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsv"))) {
  const text = readFileSync(`${dir}/${f}`, "utf8");
  for (const line of text.split("\n").slice(1)) {
    const [eco, name, pgn] = line.split("\t");
    if (eco && name && pgn) rows.push({ eco, name, pgn });
  }
}
const db = createDb();
seedOpenings(db, rows).then((n) => { console.log(`seeded ${n} openings`); });
