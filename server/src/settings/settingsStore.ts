import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "@coc/shared";
import { schema, type Db } from "../db/client.js";

/** Read the single settings row (id 1), merged over DEFAULT_SETTINGS. Missing row → defaults. */
export async function getSettings(db: Db): Promise<Settings> {
  const row = (await db.select().from(schema.settings).where(eq(schema.settings.id, 1)))[0];
  if (!row) return DEFAULT_SETTINGS;
  return parseSettings(JSON.parse(row.json));
}

/** Validate `next` (rejects e.g. non-increasing thresholds or out-of-range values) and upsert row 1. */
export async function saveSettings(db: Db, next: Settings): Promise<Settings> {
  const parsed = parseSettings(next);
  const json = JSON.stringify(parsed);
  await db
    .insert(schema.settings)
    .values({ id: 1, json })
    .onConflictDoUpdate({ target: schema.settings.id, set: { json } });
  return parsed;
}
