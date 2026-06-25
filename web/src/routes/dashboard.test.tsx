import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = vi.fn(async () => ({ json: async () => ({ runId: "r1" }) })) as any;
vi.mock("../api/client.js", () => ({ api: { sync: { $post: (...a: unknown[]) => post(...a) } } }));
vi.mock("../components/SyncProgress.js", () => ({
  SyncProgress: ({ runId }: { runId: string }) => <div>progress {runId}</div>,
}));

async function renderPage() {
  const { DashboardPage } = await import("./dashboard.js");
  render(<DashboardPage />);
}

describe("DashboardPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("syncs the selected source with the entered username", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "lichess" } });
    fireEvent.change(screen.getByPlaceholderText(/username/), { target: { value: "magnus" } });
    fireEvent.click(screen.getByText(/Sync/));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const arg = post.mock.calls[0][0] as { json: { source: string; username: string } };
    expect(arg.json).toMatchObject({ source: "lichess", username: "magnus" });
    await waitFor(() => expect(screen.getByText(/progress r1/)).toBeInTheDocument());
  });
});
