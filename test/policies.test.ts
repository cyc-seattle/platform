import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { discoverSchemaFiles } from "../src/directus/client.ts";
import { communityPolicies } from "../stacks/backend/community-rules.ts";
import {
  crewRules,
  fieldsIn,
  groupPolicies,
  groupPoliciesConfig,
  queryGuardConfig,
  savedVersionsConfig,
} from "../stacks/backend/policies.ts";

const schemas = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const policies = groupPolicies(schemas);
const fieldsOf = (collection: string) => fieldsIn(schemas, collection);
const named = (name: string) => policies.find((policy) => policy.name === name)!;
const collections = (name: string, action: string) =>
  new Set(
    named(name)
      .rules.filter((rule) => rule.action === action)
      .map((rule) => rule.collection),
  );

describe("the policies a group can give", () => {
  it("are the CRM, Medical, Catalog, and Plan policies", () => {
    expect(groupPoliciesConfig(policies).grantable).toEqual([
      "CRM Reader",
      "CRM Writer",
      "Catalog Reader",
      "Catalog Writer",
      "Medical Reader",
      "Medical Writer",
      "Plan Reader",
      "Plan Writer",
    ]);
  });

  it("are coarse: no row filters and no field lists, but a person's writable fields and CRM Writer's two hand-set ones", () => {
    for (const rule of policies.flatMap((policy) => policy.rules)) {
      expect(rule.permissions).toBeUndefined();
    }
    const fielded = named("CRM Writer").rules.filter((rule) => rule.fields && rule.collection !== "people");
    expect(fielded.map(({ collection, fields }) => `${collection}.${fields}`)).toEqual([
      "classes.program_id",
      "participants.person_id",
    ]);
  });

  it("keep medical information to the Medical policies", () => {
    for (const name of ["CRM Reader", "CRM Writer"]) {
      expect(collections(name, "read").has("medical_profiles")).toBe(false);
    }
    expect([...collections("Medical Reader", "read")]).toEqual(["medical_profiles"]);
    expect([...collections("Medical Writer", "delete")]).toEqual(["medical_profiles"]);
  });

  it("leave groups to admins, and the catalog's money to the Catalog policies", () => {
    for (const policy of policies) {
      const touched = policy.rules.map((rule) => rule.collection);
      for (const collection of ["groups", "group_members", "group_policies"]) {
        expect(touched).not.toContain(collection);
      }
      const changed = policy.rules.filter((rule) => rule.action !== "read").map((rule) => rule.collection);
      if (!policy.name.startsWith("Catalog ")) {
        expect(changed).not.toContain("products");
        expect(changed).not.toContain("accounts");
      }
      if (!policy.name.startsWith("Catalog ") && !policy.name.startsWith("Plan ")) {
        expect(touched).not.toContain("products");
        expect(touched).not.toContain("accounts");
      }
    }
  });

  it("let a CRM Writer change people, but not Clubspot's own records", () => {
    expect(collections("CRM Writer", "update").has("people")).toBe(true);
    expect(collections("CRM Writer", "update").has("registrations")).toBe(false);
    expect(collections("CRM Reader", "read")).toEqual(collections("CRM Writer", "read"));
  });
});

describe("the Catalog policies", () => {
  const catalog = [
    "products",
    "accounts",
    "qualifications",
    "qualification_covers",
    "boat_classes",
    "resource_kinds",
    "programs",
    "organizations",
    "organization_cost_accounts",
  ];

  it("let a Catalog Reader see the whole catalog, and change none of it", () => {
    expect([...collections("Catalog Reader", "read")].sort()).toEqual([...catalog].sort());
    expect(named("Catalog Reader").rules.every((rule) => rule.action === "read")).toBe(true);
  });

  it("let a Catalog Writer change the whole catalog", () => {
    for (const action of ["create", "read", "update", "delete"]) {
      expect([...collections("Catalog Writer", action)].sort()).toEqual([...catalog].sort());
    }
  });

  it("are the only policies that change programs", () => {
    const writers = policies.filter((policy) =>
      policy.rules.some((rule) => rule.collection === "programs" && rule.action !== "read"),
    );
    expect(writers.map(({ name }) => name)).toEqual(["Catalog Writer"]);
    expect(collections("CRM Writer", "read").has("programs")).toBe(true);
  });
});

const plans = [
  "plans",
  "plan_versions",
  "plan_activations",
  "plan_offerings",
  "plan_offering_boat_classes",
  "plan_trips",
  "plan_activities",
  "plan_activity_resources",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_rates",
  "plan_staff_levels",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_resources",
  "plan_boat_rates",
  "plan_activity_block_rules",
  "plan_pools",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
];

describe("the Plan policies", () => {
  const catalog = collections("Catalog Reader", "read");

  it("let both see every plan and the catalog, with no field held back", () => {
    for (const name of ["Plan Reader", "Plan Writer"]) {
      expect([...collections(name, "read")].sort()).toEqual([...plans, ...catalog].sort());
      expect(named(name).rules.every((rule) => rule.fields === undefined)).toBe(true);
    }
  });

  it("let a Plan Reader change nothing", () => {
    expect(named("Plan Reader").rules.every((rule) => rule.action === "read")).toBe(true);
  });

  it("let a Plan Writer change plans, add to the activation log, and change none of the catalog", () => {
    for (const action of ["update", "delete"]) {
      expect([...collections("Plan Writer", action)].sort()).toEqual(
        plans.filter((collection) => collection !== "plan_activations").sort(),
      );
    }
    expect([...collections("Plan Writer", "create")].sort()).toEqual([...plans].sort());
  });

  it("are the only policies that see plans", () => {
    for (const policy of policies.filter(({ name }) => !name.startsWith("Plan "))) {
      expect(policy.rules.filter((rule) => plans.includes(rule.collection))).toEqual([]);
    }
    expect(crewRules.filter((rule) => plans.includes(rule.collection))).toEqual([]);
  });
});

describe("savedVersionsConfig", () => {
  it("guards every collection whose rows belong to a version, but the activation log", () => {
    const { versioned, deletable } = savedVersionsConfig(schemas, false);
    expect(versioned.sort()).toEqual(
      plans.filter((collection) => !["plans", "plan_versions", "plan_activations"].includes(collection)).sort(),
    );
    expect(deletable).toBe(false);
  });

  it("lists every link from a plan row to another, which must stay in the row's version", () => {
    const { links } = savedVersionsConfig(schemas, false);
    expect(links).toEqual({
      plan_offering_boat_classes: { offering_id: "plan_offerings" },
      plan_trips: { offering_id: "plan_offerings" },
      plan_activities: { offering_id: "plan_offerings", trip_id: "plan_trips" },
      plan_activity_resources: { activity_id: "plan_activities" },
      plan_salaried_positions: { remainder_pool_id: "plan_pools" },
      plan_salaried_bookings: { position_id: "plan_salaried_positions" },
      plan_activity_block_rules: { coach_level_id: "plan_staff_levels" },
      plan_bonus_owner_products: { bonus_owner_id: "plan_bonus_owners" },
    });
  });
});

describe("a person's login", () => {
  it("is linked only by an admin or the group hook, never through a policy a person can hold", () => {
    const held = [
      ...policies.flatMap((policy) => policy.rules),
      ...crewRules,
      ...communityPolicies.flatMap((policy) => policy.rules),
    ];
    const writes = held.filter(
      (rule) => rule.collection === "people" && rule.action !== "read" && rule.action !== "delete",
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const rule of writes) {
      expect(rule.fields, `${rule.action} on people`).toBeDefined();
      expect(rule.fields).not.toContain("*");
      expect(rule.fields).not.toContain("directus_user_id");
    }
  });

  it("leaves every other field of a person to a CRM Writer", () => {
    const update = named("CRM Writer").rules.find((rule) => rule.collection === "people" && rule.action === "update");
    expect([...(update?.fields ?? []), "directus_user_id"].sort()).toEqual(fieldsOf("people").sort());
  });
});

describe("Crew", () => {
  it("reads every roster and the catalog's money, and changes nothing", () => {
    expect(crewRules.every((rule) => rule.action === "read" && rule.permissions === undefined)).toBe(true);
    expect(crewRules.map((rule) => rule.collection)).toEqual(
      expect.arrayContaining(["registration_entries", "people", "products", "accounts"]),
    );
    expect(crewRules.map((rule) => rule.collection)).not.toContain("medical_profiles");
  });
});

describe("queryGuardConfig", () => {
  it("records each policy's read rules, their fields, and whether they limit rows", () => {
    const config = queryGuardConfig([...communityPolicies, ...policies]);
    expect(config.policies["CRM Reader"]?.["people"]).toEqual([{ fields: "*", filtered: false }]);
    expect(config.policies["Community: own children"]?.["medical_profiles"]).toEqual([{ fields: "*", filtered: true }]);
    expect(config.policies["Community: names"]?.["programs"]).toEqual([{ fields: ["id", "name"], filtered: false }]);
  });
});
