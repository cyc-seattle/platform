import { describe, expect, it } from "vitest";
import { seasonOf } from "../../src/planning/index.ts";

describe("seasonOf", () => {
  it("reads one of the four seasons", () => {
    expect(seasonOf({ season_term: "fall" })).toBe("fall");
  });

  it("reads no season, or a saved plan's free text, as none", () => {
    expect(seasonOf({ season_term: null })).toBeNull();
    expect(seasonOf({ season_term: "Summer 2026" })).toBeNull();
  });
});
