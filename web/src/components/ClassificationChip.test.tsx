import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClassificationChip } from "./ClassificationChip.js";

describe("ClassificationChip", () => {
  it("labels a blunder", () => {
    render(<ClassificationChip classification="blunder" bookStatus="novelty" />);
    expect(screen.getByText(/blunder/i)).toBeInTheDocument();
  });
  it("renders nothing without a classification", () => {
    const { container } = render(<ClassificationChip classification={null} bookStatus={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
