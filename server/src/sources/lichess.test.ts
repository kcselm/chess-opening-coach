import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeLichessGames } from "./lichess.js";

const games = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../test/fixtures/lichess-games.json", import.meta.url)), "utf8")
);

describe("normalizeLichessGames", () => {
  // request order intentionally excludes "classical" to prove time-class filtering
  const out = normalizeLichessGames(games, "me", ["blitz", "rapid", "bullet", "daily"]);

  it("keeps only standard games in allowed (mapped) time classes", () => {
    expect(out).toHaveLength(4);
    expect(out.some((g) => g.sourceGameId === "g3")).toBe(false); // chess960 variant
    expect(out.some((g) => g.timeClass === "classical")).toBe(false); // not requested
  });

  it("maps my color and result case-insensitively, incl. a draw", () => {
    expect(out[0]).toMatchObject({ source: "lichess", sourceGameId: "g1", url: "https://lichess.org/g1",
      myColor: "white", result: "win", timeClass: "blitz", myRating: 1500, oppRating: 1490 });
    expect(out[1]).toMatchObject({ myColor: "black", result: "draw", timeClass: "rapid",
      myRating: 1550, oppRating: 1600 });
  });

  it("maps a loss and the ultraBullet->bullet speed", () => {
    expect(out[2]).toMatchObject({ sourceGameId: "g4", myColor: "white", result: "loss", timeClass: "bullet" });
  });

  it("maps correspondence->daily and ms->s endTime", () => {
    expect(out[3]).toMatchObject({ sourceGameId: "g5", timeClass: "daily", result: "win" });
    expect(out[0]!.endTime).toBe(1700000300); // 1700000300000 ms / 1000
  });
});
