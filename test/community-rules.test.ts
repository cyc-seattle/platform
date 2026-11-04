import { describe, it, expect } from "vitest";
import {
  ACTIVE_CAMP,
  communityPolicies,
  familyPolicies,
  TEAM_REGISTRATION,
  teamPolicies,
} from "../stacks/backend/community-rules.ts";

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

describe("the Community rules by login", () => {
  const rules = familyPolicies.flatMap((policy) => policy.rules);

  it("let a family change only whether they share, and nothing else", () => {
    const writes = rules.filter((rule) => rule.action !== "read");
    expect(writes).toEqual([
      expect.objectContaining({ collection: "people", action: "update", fields: ["share_contact"] }),
    ]);
  });

  it("match the signed-in user by their login, never by email", () => {
    expect(JSON.stringify(rules)).toContain("$CURRENT_USER");
    expect(JSON.stringify(rules)).not.toContain("$CURRENT_USER.email");
  });
});

describe("the Team rules", () => {
  const rules = teamPolicies.flatMap((policy) => policy.rules);

  it("only read", () => {
    expect(rules.every((rule) => rule.action === "read")).toBe(true);
  });

  it("put someone on a team through a confirmed sign-up for a team's offering, for 12 months after it ends", () => {
    expect(TEAM_REGISTRATION).toEqual({
      _and: [
        { status: { _eq: "confirmed" } },
        { offering_id: { program_id: { team: { _eq: true } } } },
        { offering_id: { _or: [{ ends_on: { _null: true } }, { ends_on: { _gte: "$NOW(-12 months)" } }] } },
      ],
    });
  });

  it("show an email or phone only for someone who chose to share", () => {
    const shown = rules.filter((rule) => rule.fields.includes("email") || rule.fields.includes("phone"));
    expect(shown).toHaveLength(1);
    expect(JSON.stringify(shown[0]!.permissions)).toContain('"share_contact":{"_eq":true}');
  });
});
