import { describe, expect, it } from "vitest";
import { isoWeekday } from "../../src/planning/dates.ts";

describe("dates", () => {
  it("numbers weekdays from Monday", () => {
    expect(isoWeekday("2027-06-07")).toBe(1);
    expect(isoWeekday("2027-06-13")).toBe(7);
  });
});
