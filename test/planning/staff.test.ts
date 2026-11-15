import { describe, expect, it } from "vitest";
import { STAFF_GRADES, sortStaffLevels } from "../../src/planning/index.ts";
import type { StaffLevel } from "../../src/planning/index.ts";

describe("sortStaffLevels", () => {
  const roles = [
    { id: "coach", name: "Coach", sort: 2 },
    { id: "instructor", name: "Instructor", sort: 1 },
    { id: "office", name: "Office", sort: 3 },
  ];
  const level = (name: string, role_id: string, grade: StaffLevel["grade"]) => ({ name, role_id, grade });

  it("lists levels by their role's order, then by grade", () => {
    const levels = [
      level("Office Staff", "office", "standard"),
      level("Head Coach", "coach", "head"),
      level("Volunteer Coach", "coach", "volunteer"),
      level("Coach", "coach", "standard"),
      level("Senior Instructor", "instructor", "senior"),
      level("Junior Instructor", "instructor", "junior"),
      level("Instructor", "instructor", "standard"),
      level("Head Instructor", "instructor", "head"),
    ];
    expect(sortStaffLevels(levels, roles).map((l) => l.name)).toEqual([
      "Junior Instructor",
      "Instructor",
      "Senior Instructor",
      "Head Instructor",
      "Volunteer Coach",
      "Coach",
      "Head Coach",
      "Office Staff",
    ]);
  });

  it("lists a level whose role isn't known last", () => {
    const levels = [level("Rigger", "gone", "standard"), level("Coach", "coach", "standard")];
    expect(sortStaffLevels(levels, roles).map((l) => l.name)).toEqual(["Coach", "Rigger"]);
  });

  it("orders the grades from volunteer to head", () => {
    expect(STAFF_GRADES).toEqual(["volunteer", "junior", "standard", "senior", "head"]);
  });
});
