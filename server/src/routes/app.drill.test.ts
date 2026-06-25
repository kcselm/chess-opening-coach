import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";
import type { DrillRecommendation, DrillResultsBatch } from "@coc/shared";

const rec: DrillRecommendation = {
  openingEpd: "R w - -", openingName: "Caro-Kann", eco: "B10", reason: "leak", score: 360, lastDrilled: null,
};

describe("drill routes", () => {
  it("GET /drill/recommended returns the injected list", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getDrillRecommendations: async () => [rec] });
    const res = await app.request("/drill/recommended");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([rec]);
  });

  it("POST /drill/results forwards the batch and returns the saved count", async () => {
    let received: DrillResultsBatch | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      saveDrillResults: async (b) => { received = b; return { saved: b.attempts.length }; } });
    const body: DrillResultsBatch = { attempts: [{ epd: "E w - -", openingEpd: "R w - -",
      openingName: "Caro-Kann", color: "black", source: "rating", playedUci: "e7e6", pass: true, cpLoss: 0 }] };
    const res = await app.request("/drill/results", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1 });
    expect(received).toEqual(body);
  });
});
