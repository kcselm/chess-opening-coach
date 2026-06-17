import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EvalGraph } from "./EvalGraph.js";

describe("EvalGraph", () => {
  it("renders a dot per point and reports clicks by index", () => {
    const onSelect = vi.fn();
    render(<EvalGraph points={[0, 30, null, -120]} selected={1} onSelect={onSelect} />);
    expect(screen.getByTestId("eval-pt-0")).toBeInTheDocument();
    expect(screen.getByTestId("eval-pt-3")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eval-pt-3"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
