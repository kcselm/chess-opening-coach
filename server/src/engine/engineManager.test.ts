import { describe, it, expect } from "vitest";
import { EngineManager } from "./engineManager.js";

describe("EngineManager setoption setters", () => {
  it("setThreads/setMultiPV are safe no-ops before start()", () => {
    const e = new EngineManager();
    expect(() => { e.setThreads(8); e.setMultiPV(5); }).not.toThrow();
  });
});
