import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";

const put = vi.fn(async ({ json }: { json: Settings }) => ({ json: async () => json }));
vi.mock("../api/client.js", () => ({
  api: {
    settings: {
      $get: vi.fn(async () => ({ json: async () => DEFAULT_SETTINGS })),
      $put: (arg: { json: Settings }) => put(arg),
    },
  },
}));

async function renderPage() {
  const { SettingsPage } = await import("./settings.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><SettingsPage /></QueryClientProvider>);
}

describe("SettingsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads settings, shows the depth re-sync warning, and disables Save until dirty", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Engine")).toBeInTheDocument());
    expect(screen.getByText(/only re-analyzed positions until you re-sync/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("edits a field and PUTs the changed settings", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Engine")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_SETTINGS.engine.depth)), { target: { value: "22" } });
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]!.json.engine.depth).toBe(22);
  });
});
