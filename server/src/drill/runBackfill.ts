import "dotenv/config";
import { drillTuningFromSettings } from "@coc/shared";
import { createDb } from "../db/client.js";
import { getSettings } from "../settings/settingsStore.js";
import { backfillSchedule } from "./backfillSchedule.js";

const db = createDb();
const settings = await getSettings(db);
backfillSchedule(db, drillTuningFromSettings(settings)).then((r) => {
  console.log(`backfilled ${r.cards} drill cards`);
});
