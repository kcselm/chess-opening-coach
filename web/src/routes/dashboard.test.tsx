import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, sync: { source: "chesscom", timeClasses: ["blitz"], sinceDays: 30 } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = vi.fn(async () => ({ json: async () => ({ runId: "r1" }) })) as any;
vi.mock("../api/client.js", () => ({
  api: {
    sync: { $post: (...a: unknown[]) => post(...a) },
    settings: { $get: vi.fn(async () => ({ json: async () => SETTINGS })) },
  },
}));
vi.mock("../components/SyncProgress.js", () => ({
  SyncProgress: ({ runId }: { runId: string }) => <div>progress {runId}</div>,
}));

async function renderPage() {
  const { DashboardPage } = await import("./dashboard.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><DashboardPage /></QueryClientProvider>);
}

describe("DashboardPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("prefills the look-back + time classes from settings and posts them", async () => {
    await renderPage();
    // wait for the settings query to land (proves the value came from settings, not the old hardcoded 90)
    await waitFor(() => expect(screen.getByText(/last 30 days/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "lichess" } });
    fireEvent.change(screen.getByPlaceholderText(/username/), { target: { value: "magnus" } });
    fireEvent.click(screen.getByText(/Sync/));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const arg = post.mock.calls[0][0] as { json: { source: string; username: string; timeClasses: string[] } };
    expect(arg.json).toMatchObject({ source: "lichess", username: "magnus" });
    expect(arg.json.timeClasses).toEqual(["blitz"]);
    await waitFor(() => expect(screen.getByText(/progress r1/)).toBeInTheDocument());
  });
});
