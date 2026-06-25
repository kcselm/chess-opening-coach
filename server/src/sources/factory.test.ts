import { describe, it, expect } from "vitest";
import { sourceFor } from "./factory.js";

describe("sourceFor", () => {
  it("returns a chess.com adapter for chesscom", () => {
    expect(sourceFor("chesscom").id).toBe("chesscom");
  });
  it("returns a Lichess adapter for lichess", () => {
    expect(sourceFor("lichess", "tok").id).toBe("lichess");
  });
});
