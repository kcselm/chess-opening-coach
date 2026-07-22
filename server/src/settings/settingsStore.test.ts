import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getSettings, saveSettings } from "./settingsStore.js";
import { DEFAULT_SETTINGS } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE settings (id integer primary key, json text);`);
  return drizzle(c, { schema });
}

describe("settingsStore", () => {
  it("returns the defaults when no row exists", async () => {
    const db = await memDb();
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a saved change", async () => {
    const db = await memDb();
    const next = { ...DEFAULT_SETTINGS, engine: { ...DEFAULT_SETTINGS.engine, depth: 22 } };
    const saved = await saveSettings(db, next);
    expect(saved.engine.depth).toBe(22);
    expect((await getSettings(db)).engine.depth).toBe(22);
  });

  it("merges a stored blob that predates a field", async () => {
    const db = await memDb();
    await db.insert(schema.settings).values({ id: 1, json: JSON.stringify({ engine: { depth: 20 } }) });
    const s = await getSettings(db);
    expect(s.engine.depth).toBe(20);     // stored
    expect(s.engine.threads).toBe(4);    // default filled
    expect(s.thresholds.mistake).toBe(100);
  });

  it("rejects an invalid settings value", async () => {
    const db = await memDb();
    const bad = { ...DEFAULT_SETTINGS, thresholds: { inaccuracy: 100, mistake: 50, blunder: 200 } };
    await expect(saveSettings(db, bad as typeof DEFAULT_SETTINGS)).rejects.toThrow();
  });
});
