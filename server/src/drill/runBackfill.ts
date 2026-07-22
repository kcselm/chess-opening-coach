import "dotenv/config";
import { createDb } from "../db/client.js";
import { backfillSchedule } from "./backfillSchedule.js";

const db = createDb();
backfillSchedule(db).then((r) => {
  console.log(`backfilled ${r.cards} drill cards`);
});
