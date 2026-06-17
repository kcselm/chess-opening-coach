import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "../db/schema.js";
import { getBook } from "./explorerClient.js";

const masters = readFileSync(fileURLToPath(new URL("../../test/fixtures/explorer-masters.json", import.meta.url)), "utf8");

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  return drizzle(c, { schema });
}

describe("getBook", () => {
  it("fetches, normalizes, and caches book stats", async () => {
    const db = await memDb();
    let fetchCalls = 0;
    const fakeFetch = async () => { fetchCalls++; return new Response(masters, { status: 200 }); };
    const book = await getBook(db, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "masters",
      { fetchFn: fakeFetch as typeof fetch, now: () => 1000 });
    expect(book.total).toBe(2800);
    expect(book.moves[0]).toMatchObject({ san: "e4", count: 1400 });

    await getBook(db, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "masters",
      { fetchFn: fakeFetch as typeof fetch, now: () => 1000 });
    expect(fetchCalls).toBe(1);
  });

  it("aborts a hung request via the timeout instead of blocking forever", async () => {
    const db = await memDb();
    // Simulates the lichess explorer holding a connection open (rate-limit stall): only ever
    // settles when the caller aborts it. If getBook supplies no abort signal, this never resolves
    // and the test times out — exactly the hang that froze the sync's book-lookup loop.
    const hangingFetch = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
      });
    await expect(
      getBook(db, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "masters",
        { fetchFn: hangingFetch as unknown as typeof fetch, timeoutMs: 50 }),
    ).rejects.toThrow();
  });
});
