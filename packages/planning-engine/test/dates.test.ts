import { describe, expect, it } from "vitest";
import { effectiveOn, fiscalYearMonths, isoWeekday } from "../src/dates.ts";

describe("dates", () => {
  it("names fiscal year N by the calendar year it ends in", () => {
    expect(fiscalYearMonths(2027, 1)).toEqual([
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07",
      "2027-08",
      "2027-09",
      "2027-10",
      "2027-11",
      "2027-12",
    ]);
    const july = fiscalYearMonths(2027, 7);
    expect(july[0]).toBe("2026-07");
    expect(july.at(-1)).toBe("2027-06");
  });

  it("numbers weekdays from Monday", () => {
    expect(isoWeekday("2027-06-07")).toBe(1);
    expect(isoWeekday("2027-06-13")).toBe(7);
  });

  it("picks the latest row in effect", () => {
    const rows = [
      { effective_from: null, v: "base" },
      { effective_from: "2027-03-01", v: "march" },
      { effective_from: "2027-09-01", v: "september" },
    ];
    expect(effectiveOn(rows, "2027-01-15")?.v).toBe("base");
    expect(effectiveOn(rows, "2027-03-01")?.v).toBe("march");
    expect(effectiveOn(rows, "2027-12-31")?.v).toBe("september");
    expect(effectiveOn(rows.slice(1), "2027-01-01")).toBeUndefined();
  });
});
