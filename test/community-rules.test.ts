import { describe, it, expect } from "vitest";
import { ACTIVE_CAMP, communityPolicies } from "../stacks/backend/community-rules.ts";

describe("ACTIVE_CAMP", () => {
  it("looks back 36 hours on end_date, covering Pacific's full last day (cyc-seattle/isthmia#166)", () => {
    expect(ACTIVE_CAMP).toEqual({
      start_date: { _lte: "$NOW" },
      end_date: { _gte: "$NOW(-36 hours)" },
    });
  });
});

describe("family policy's own-guardian-link grant", () => {
  it("reads only subject_id, contact_id, and relationship_type on contacts (cyc-seattle/isthmia#166)", () => {
    const family = communityPolicies.find((policy) => policy.key === "family")!;
    const rule = family.rules.find((r) => r.collection === "contacts")!;
    expect(rule.action).toBe("read");
    expect(rule.fields.sort()).toEqual(["contact_id", "relationship_type", "subject_id"]);
  });
});

/** The most relations any path through a rule's filter crosses. Keys that start with `_` are operators. */
function relationalDepth(filter: unknown): number {
  if (Array.isArray(filter)) {
    return Math.max(0, ...filter.map(relationalDepth));
  }
  if (typeof filter !== "object" || filter === null) {
    return 0;
  }
  return Math.max(
    0,
    ...Object.entries(filter).map(([key, value]) => {
      if (key.startsWith("_")) {
        return relationalDepth(value);
      }
      const isRelation =
        typeof value === "object" &&
        value !== null &&
        Object.keys(value).some((inner) => !inner.startsWith("_") || ["_and", "_or", "_some", "_none"].includes(inner));
      return isRelation ? 1 + relationalDepth(value) : 0;
    }),
  );
}

describe("the deepest Community rule", () => {
  // crm.feature's opted-in child's guardian runs through this rule on dev, which leaves Directus's
  // MAX_RELATIONAL_DEPTH at its default of 10, so it shows the rule resolves past it
  // (cyc-seattle/isthmia#175).
  it("nests 14 relations, deeper than Directus's default relational depth", () => {
    const deepest = Math.max(
      ...communityPolicies.flatMap((policy) => policy.rules.map((rule) => relationalDepth(rule.permissions))),
    );
    expect(deepest).toBe(14);
  });
});
