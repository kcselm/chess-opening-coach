import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeChesscomGames } from "./chesscom.js";

const archive = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../test/fixtures/chesscom-archive.json", import.meta.url)), "utf8")
);

describe("normalizeChesscomGames", () => {
  const out = normalizeChesscomGames(archive.games, "me", ["rapid", "blitz", "classical"]);

  it("maps my color and result case-insensitively", () => {
    expect(out[0]).toMatchObject({ myColor: "white", result: "win", timeClass: "rapid" });
    expect(out[1]).toMatchObject({ myColor: "black", result: "draw", timeClass: "blitz" });
  });
  it("filters out variants (chess960) and disallowed time classes (bullet)", () => {
    expect(out).toHaveLength(2);
    expect(out.some((g) => g.sourceGameId === "3")).toBe(false);
  });
  it("captures ratings and source ids", () => {
    expect(out[0]).toMatchObject({ source: "chesscom", sourceGameId: "1", myRating: 1500, oppRating: 1490 });
  });
});
