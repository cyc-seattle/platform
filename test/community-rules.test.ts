import { describe, it, expect } from "vitest";
import { familyPolicies, TEAM_REGISTRATION, teamPolicies } from "../stacks/backend/community-rules.ts";

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
    const shown = rules.filter(
      (rule) => rule.collection === "people" && (rule.fields.includes("email") || rule.fields.includes("phone")),
    );
    expect(shown).toHaveLength(1);
    expect(JSON.stringify(shown[0]!.permissions)).toContain('"share_contact":{"_eq":true}');
  });
});
