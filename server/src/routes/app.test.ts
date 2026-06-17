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

  it("re-attaches to the in-flight run instead of starting a second concurrent sync", async () => {
    const runStore = new RunStore();
    let active: string | null = null;
    let starts = 0;
    const app = createApp({
      runStore,
      // mimic the server: set active synchronously, never resolve within the test
      startSync: (runId) => { starts++; active = runId; return new Promise<void>(() => {}); },
      getActiveRunId: () => active,
    });
    const body = JSON.stringify({ source: "chesscom", username: "me", since: 0, until: 1, timeClasses: ["rapid"] });
    const post = () => app.request("/sync", { method: "POST", headers: { "content-type": "application/json" }, body });

    const id1 = (await (await post()).json() as { runId: string }).runId;
    const id2 = (await (await post()).json() as { runId: string }).runId;

    expect(id2).toBe(id1);
    expect(starts).toBe(1);
  });
});
