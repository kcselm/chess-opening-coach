import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";
import { RunStore } from "../runStore.js";

function appWithSettings() {
  let current: Settings = DEFAULT_SETTINGS;
  return createApp({
    runStore: new RunStore(),
    startSync: async () => {},
    getSettings: async () => current,
    saveSettings: async (next) => { current = next; return current; },
  });
}

const putBody = (s: Settings) => ({
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s),
});

describe("/settings", () => {
  it("GET returns the defaults initially", async () => {
    const res = await appWithSettings().request("/settings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_SETTINGS);
  });

  it("PUT persists and a later GET reflects it", async () => {
    const app = appWithSettings();
    const next: Settings = { ...DEFAULT_SETTINGS, engine: { ...DEFAULT_SETTINGS.engine, depth: 22 } };
    const put = await app.request("/settings", putBody(next));
    expect(put.status).toBe(200);
    expect((await put.json()).engine.depth).toBe(22);
    const get = await app.request("/settings");
    expect((await get.json()).engine.depth).toBe(22);
  });

  it("PUT rejects an invalid body (non-increasing thresholds) with 400", async () => {
    const bad = { ...DEFAULT_SETTINGS, thresholds: { inaccuracy: 100, mistake: 50, blunder: 200 } };
    const res = await appWithSettings().request("/settings", putBody(bad as Settings));
    expect(res.status).toBe(400);
  });
});
