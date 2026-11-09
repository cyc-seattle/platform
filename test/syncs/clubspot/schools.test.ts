import { describe, it, expect, vi } from "vitest";
import winston from "winston";
import { keyOf, SchoolMatcher } from "../../../src/syncs/clubspot/schools.ts";

const fatima = { id: "school-1", name: "Our Lady of Fatima", aliases: ["OLF"] };
const lincoln = { id: "school-2", name: "Lincoln High", aliases: ["Hamilton (going to Lincoln)"] };

describe("SchoolMatcher", () => {
  const schools = new SchoolMatcher([fatima, lincoln]);

  it("matches a name or an alias, ignoring case, spaces, and punctuation", () => {
    expect(schools.match("our lady of  fatima")).toBe(fatima);
    expect(schools.match(" olf ")).toBe(fatima);
    expect(schools.match("Hamilton - going to Lincoln")).toBe(lincoln);
  });

  it("never guesses at a near miss", () => {
    expect(schools.match("Our Lady of Fatima School")).toBeUndefined();
  });

  it("files a match under the list, and anything else in the family's own words", () => {
    expect(schools.fieldsFor("lincoln high")).toEqual({ school_id: "school-2", school: null });
    expect(schools.fieldsFor(" Garfield ")).toEqual({ school_id: null, school: "Garfield" });
    expect(schools.fieldsFor("  ")).toBeNull();
    expect(schools.fieldsFor(null)).toBeNull();
  });

  it("gives two answers naming the same school the same key, and the person's stored pick the same one", () => {
    expect(schools.keyFor("OLF")).toBe(schools.keyFor("Our Lady of Fatima"));
    expect(schools.keyFor("OLF")).toBe(keyOf({ school_id: "school-1", school: null }));
    expect(schools.keyFor("Garfield")).toBe(keyOf({ school_id: null, school: "Garfield" }));
    expect(keyOf({ school_id: null, school: null })).toBeNull();
  });

  it("matches neither school when one name means both, and warns", () => {
    const warn = vi.spyOn(winston, "warn").mockReturnThis();
    try {
      const both = new SchoolMatcher([fatima, { id: "school-3", name: "Fatima", aliases: ["olf"] }]);
      expect(both.match("OLF")).toBeUndefined();
      expect(both.match("Fatima")?.id).toBe("school-3");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("names two schools"), expect.anything());
    } finally {
      warn.mockRestore();
    }
  });
});
