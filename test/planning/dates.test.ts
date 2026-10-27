import { describe, expect, it } from "vitest";
import { fiscalYearDates, isoWeekday } from "../../src/planning/dates.ts";

describe("dates", () => {
  it("names fiscal year N by the calendar year it ends in", () => {
    expect(fiscalYearDates(2027, 1)).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(fiscalYearDates(2027, 7)).toEqual({ from: "2026-07-01", to: "2027-06-30" });
  });

  it("numbers weekdays from Monday", () => {
    expect(isoWeekday("2027-06-07")).toBe(1);
    expect(isoWeekday("2027-06-13")).toBe(7);
  });
});
