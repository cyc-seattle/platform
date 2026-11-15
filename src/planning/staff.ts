import type { StaffGrade, StaffLevel, StaffRole } from "./types.ts";

/** The grades, in the order planning lists a role's levels. */
export const STAFF_GRADES: readonly StaffGrade[] = ["volunteer", "junior", "standard", "senior", "head"];

/** `levels` in the order planning lists them: by their role's sort, then by grade, then by name. */
export function sortStaffLevels<T extends Pick<StaffLevel, "name" | "role_id" | "grade">>(
  levels: readonly T[],
  roles: readonly Pick<StaffRole, "id" | "name" | "sort">[],
): T[] {
  const role = new Map(roles.map((r) => [r.id, r]));
  const roleSort = (level: T) => role.get(level.role_id)?.sort ?? Number.MAX_SAFE_INTEGER;
  const roleName = (level: T) => role.get(level.role_id)?.name ?? "";
  return [...levels].sort(
    (a, b) =>
      roleSort(a) - roleSort(b) ||
      roleName(a).localeCompare(roleName(b)) ||
      STAFF_GRADES.indexOf(a.grade) - STAFF_GRADES.indexOf(b.grade) ||
      a.name.localeCompare(b.name),
  );
}
