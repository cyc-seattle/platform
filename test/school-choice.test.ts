import { describe, it, expect } from "vitest";
import { schoolChoice } from "../stacks/backend/school-choice.cjs";

describe("the school-choice hook", () => {
  it("clears the school in their own words when a school is picked from the list", () => {
    expect(schoolChoice({ school_id: "school-1" })).toEqual({ school_id: "school-1", school: null });
  });

  it("clears the pick when a school is given in their own words", () => {
    expect(schoolChoice({ school: "Lakeside" })).toEqual({ school_id: null, school: "Lakeside" });
  });

  it("refuses both at once", () => {
    expect(() => schoolChoice({ school_id: "school-1", school: "Lakeside" })).toThrow(/not both/);
  });

  it("lets a write that sets one and clears the other, or neither, through as it is", () => {
    for (const payload of [
      { school_id: "school-1", school: null },
      { school_id: null, school: "Lakeside" },
      { school_id: "school-1", school: " " },
      { school_id: null },
      { display_name: "Skip" },
    ]) {
      expect(schoolChoice(payload)).toBe(payload);
    }
  });
});
