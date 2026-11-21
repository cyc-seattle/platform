import { describe, expect, it } from "vitest";
import { isCurrentTerm, seattleDate } from "../../../src/model/crew/index.ts";

// 8:00 a.m. UTC on Nov 21 is midnight in Seattle, so a minute earlier is still Nov 20 there.
const morningUtc = new Date("2026-11-21T08:00:00Z");

describe("seattleDate", () => {
  it("is the day in Seattle, not in UTC", () => {
    expect(seattleDate(morningUtc)).toBe("2026-11-21");
    expect(seattleDate(new Date("2026-11-21T07:59:00Z"))).toBe("2026-11-20");
  });
});

describe("isCurrentTerm", () => {
  it.each([
    ["no dates at all", null, null, true],
    ["one that started today", "2026-11-21", null, true],
    ["one that ends today", null, "2026-11-21", true],
    ["one that starts tomorrow", "2026-11-22", null, false],
    ["one that ended yesterday", null, "2026-11-20", false],
    ["one within its dates", "2026-01-01", "2026-12-31", true],
  ])("counts %s", (_, starts_on, ends_on, current) => {
    expect(isCurrentTerm({ starts_on, ends_on }, new Date("2026-11-21T20:00:00Z"))).toBe(current);
  });

  it("keeps a term current through the evening of its last day in Seattle", () => {
    expect(isCurrentTerm({ starts_on: null, ends_on: "2026-11-20" }, new Date("2026-11-21T07:00:00Z"))).toBe(true);
  });
});
