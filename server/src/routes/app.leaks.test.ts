import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";
import type { Leak } from "@coc/shared";

const sampleLeak: Leak = {
  openingName: "Sicilian Defense", eco: "B20", fenBefore: "P w - - 0 1", lineSan: "",
  yourMoveSan: "d4", betterMoveSan: "Nf3", occurrences: 3, avgCpLoss: 120, scorePct: 33, bookStatus: "novelty",
};

describe("GET /leaks", () => {
  it("returns leaks from the injected query", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getLeaks: async () => [sampleLeak], getGames: async () => [], getGame: async () => null });
    const res = await app.request("/leaks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([sampleLeak]);
  });
});
