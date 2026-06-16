import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvalBar } from "./EvalBar.js";

describe("EvalBar", () => {
  it("shows the eval in pawns and gives white more height when ahead", () => {
    render(<EvalBar cp={150} />);
    expect(screen.getByText("+1.5")).toBeInTheDocument();
    const white = screen.getByTestId("eval-white");
    expect(Number(white.style.height.replace("%", ""))).toBeGreaterThan(50);
  });
});
