import { describe, it, expect } from "vitest";
import { parseSchoolsFile, planSchoolCleanup, planSchoolUpserts } from "../../../src/syncs/clubspot/apply-schools.ts";
import { SchoolMatcher } from "../../../src/syncs/clubspot/schools.ts";

const FILE = `
schools:
  - name: Our Lady of Fatima
    aliases: ["our lady of fatima", "OLF"]
  - name: Lincoln High
    aliases: ["Hamilton (going to Lincoln)"]
clear: ["na", "None", "Test School"]
`;

describe("parseSchoolsFile", () => {
  it("reads the schools, their aliases, and the values to clear", () => {
    expect(parseSchoolsFile(FILE)).toEqual({
      schools: [
        { name: "Our Lady of Fatima", aliases: ["our lady of fatima", "OLF"] },
        { name: "Lincoln High", aliases: ["Hamilton (going to Lincoln)"] },
      ],
      clear: ["na", "None", "Test School"],
    });
  });

  it("refuses a school with no name, or aliases that aren't a list of strings", () => {
    expect(() => parseSchoolsFile("schools:\n  - aliases: [a]\n")).toThrow(/name/);
    expect(() => parseSchoolsFile("schools:\n  - name: A\n    aliases: b\n")).toThrow(/aliases/);
    expect(() => parseSchoolsFile("clear: [na]\n")).toThrow(/schools/);
  });
});

describe("planSchoolUpserts", () => {
  it("adds a new school, and adds only new aliases to one on the list, keeping staff's", () => {
    const plan = planSchoolUpserts(parseSchoolsFile(FILE), [
      { id: "school-1", name: "our lady of fatima", aliases: ["Fatima"] },
    ]);
    expect(plan).toEqual({
      create: [{ name: "Lincoln High", aliases: ["Hamilton (going to Lincoln)"] }],
      update: [{ id: "school-1", aliases: ["Fatima", "our lady of fatima", "OLF"] }],
    });
  });

  it("changes nothing on a second run", () => {
    const plan = planSchoolUpserts(parseSchoolsFile(FILE), [
      { id: "school-1", name: "Our Lady of Fatima", aliases: ["our lady of fatima", "OLF"] },
      { id: "school-2", name: "Lincoln High", aliases: ["Hamilton (going to Lincoln)"] },
    ]);
    expect(plan).toEqual({ create: [], update: [] });
  });
});

describe("planSchoolCleanup", () => {
  const schools = new SchoolMatcher([
    { id: "school-1", name: "Our Lady of Fatima", aliases: ["OLF"] },
    { id: "school-2", name: "Lincoln High", aliases: ["Hamilton (going to Lincoln)"] },
  ]);

  it("moves a match onto the list, clears junk, and counts what's left", () => {
    const cleanup = planSchoolCleanup(
      [
        { id: "p1", school_id: null, school: "Our lady of fatima" },
        { id: "p2", school_id: null, school: "Hamilton (going to Lincoln)" },
        { id: "p3", school_id: null, school: "NA" },
        { id: "p4", school_id: null, school: "Garfield" },
        { id: "p5", school_id: null, school: "Garfield" },
        { id: "p6", school_id: "school-2", school: null },
        { id: "p7", school_id: null, school: null },
      ],
      schools,
      ["na", "None"],
    );
    expect(cleanup.patches).toEqual([
      { id: "p1", patch: { school_id: "school-1", school: null } },
      { id: "p2", patch: { school_id: "school-2", school: null } },
      { id: "p3", patch: { school: null } },
    ]);
    expect(cleanup.leftOver).toEqual(new Map([["Garfield", 2]]));
  });
});
