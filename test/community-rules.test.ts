import { describe, it, expect } from "vitest";
import { familyPolicies, TEAM_REGISTRATION, teamPolicies } from "../stacks/backend/community-rules.ts";

describe("the Community rules by login", () => {
  const rules = familyPolicies.flatMap((policy) => policy.rules);

  it("let a household change whether it shares, display names, schools, and phones, and nothing else", () => {
    const writes = rules.filter((rule) => rule.action !== "read");
    expect(writes.map(({ collection, action, fields }) => ({ collection, action, fields }))).toEqual([
      { collection: "people", action: "update", fields: ["display_name", "school"] },
      { collection: "people", action: "update", fields: ["phone"] },
      { collection: "households", action: "update", fields: ["share_contact"] },
    ]);
  });

  it("never let a family change an email, which links a login to a person", () => {
    const writes = rules.filter((rule) => rule.action !== "read");
    expect(writes.flatMap((rule) => rule.fields)).not.toContain("email");
  });

  it("give Community one read rule per collection, so the query guard hides nothing from it", () => {
    const reads = rules.filter((rule) => rule.action === "read").map((rule) => rule.collection);
    expect(new Set(reads).size).toBe(reads.length);
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
    const shown = rules.filter(
      (rule) => rule.collection === "people" && (rule.fields.includes("email") || rule.fields.includes("phone")),
    );
    expect(shown).toHaveLength(1);
    expect(JSON.stringify(shown[0]!.permissions)).toContain('"household_id":{"share_contact":{"_eq":true}}');
  });
});
