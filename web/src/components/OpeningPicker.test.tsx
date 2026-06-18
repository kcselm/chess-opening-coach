import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OpeningListItem } from "@coc/shared";

const items: OpeningListItem[] = [{ epd: "E1", eco: "B20", name: "Sicilian Defense" }];
vi.mock("../api/client.js", () => ({
  api: { openings: { $get: vi.fn(async () => ({ json: async () => items })) } },
}));

async function renderPicker() {
  const { OpeningPicker } = await import("./OpeningPicker.js");
  const onPick = vi.fn();
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><OpeningPicker onPick={onPick} /></QueryClientProvider>);
  return onPick;
}

describe("OpeningPicker", () => {
  beforeEach(() => vi.clearAllMocks());
  it("searches and reports the picked opening", async () => {
    const onPick = await renderPicker();
    fireEvent.change(screen.getByPlaceholderText("search openings"), { target: { value: "sic" } });
    await waitFor(() => expect(screen.getByText("Sicilian Defense")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("opening-E1"));
    expect(onPick).toHaveBeenCalledWith(items[0]);
  });
});
