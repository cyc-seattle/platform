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
  it("are CRM Reader, CRM Writer, Medical Reader, and Medical Writer", () => {
    expect(groupPoliciesConfig(policies).grantable).toEqual([
      "CRM Reader",
      "CRM Writer",
      "Medical Reader",
      "Medical Writer",
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

  it("leave groups and the catalog's money to admins and their own policies", () => {
    for (const policy of policies) {
      for (const collection of ["groups", "group_members", "group_policies", "products", "accounts"]) {
        expect(policy.rules.map((rule) => rule.collection)).not.toContain(collection);
      }
    }
  });

  it("let a CRM Writer change people, but not Clubspot's own records", () => {
    expect(collections("CRM Writer", "update").has("people")).toBe(true);
    expect(collections("CRM Writer", "update").has("registrations")).toBe(false);
    expect(collections("CRM Reader", "read")).toEqual(collections("CRM Writer", "read"));
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
