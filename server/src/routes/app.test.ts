import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";

describe("POST /sync", () => {
  it("validates the body and returns a runId", async () => {
    const runStore = new RunStore();
    const app = createApp({ runStore, startSync: async () => {} });
    const res = await app.request("/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "chesscom", username: "me", since: 0, until: 1, timeClasses: ["rapid"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: expect.stringMatching(/^run_/) });
  });

  it("rejects an invalid body", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {} });
    const res = await app.request("/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "chesscom" }),
    });
    expect(res.status).toBe(400);
  });
});
