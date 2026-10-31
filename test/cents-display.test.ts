import { describe, it, expect } from "vitest";
import display, { formatCents } from "../stacks/backend/cents-display.mjs";

describe("the cents-as-dollars display", () => {
  it.each([
    [12500, "$125.00"],
    ["12500", "$125.00"],
    [5, "$0.05"],
    [-1999, "-$19.99"],
    [123456789, "$1,234,567.89"],
  ])("shows %j as %s", (value, shown) => {
    expect(formatCents(value)).toBe(shown);
  });

  it("leaves a value that isn't a number as it was", () => {
    expect(formatCents("n/a")).toBe("n/a");
  });

  it("is the display the schemas name", () => {
    expect(display.id).toBe("cents-as-dollars");
    expect(display.handler).toBe(formatCents);
  });
});
