import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { refusedByGuard, type Grant } from "../scripts/access-lost.ts";
import type { PermissionRuleInput } from "../src/directus/client.ts";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";
import { communityPolicies } from "../stacks/backend/community-rules.ts";
import {
  clubspotCollections,
  crewRules,
  crmCollections,
  fieldsIn,
  groupPolicies,
  writerRules,
} from "../stacks/backend/policies.ts";

const schemas = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const { fields } = mergeSchemas(schemas) as { fields: { collection: string; field: string; type: string }[] };
const fieldsOf = (collection: string) =>
  fields.filter((field) => field.collection === collection && field.type !== "alias").map(({ field }) => field);

/** Permission rows as Directus stores them, from the rules `backend` declares. */
const grants = (rules: Pick<PermissionRuleInput, "collection" | "action" | "fields" | "permissions">[]): Grant[] =>
  rules.map(({ collection, action, fields, permissions }) => ({
    collection,
    action,
    filtered: permissions !== undefined && Object.keys(permissions).length > 0,
    fields: fields ?? ["*"],
  }));

const staff = grants(
  writerRules(crmCollections(schemas), clubspotCollections(schemas), (collection) => fieldsIn(schemas, collection)),
);
const crew = grants([...crewRules, ...communityPolicies.flatMap(({ rules }) => rules)]);
const policy = (name: string) => grants(groupPolicies(schemas).find((each) => each.name === name)!.rules);

describe("what the query guard takes from a Staff user who moves to Crew", () => {
  it("is nothing, with the Staff group's CRM Writer and Medical Writer", () => {
    expect(refusedByGuard(staff, [...crew, ...policy("CRM Writer"), ...policy("Medical Writer")], fieldsOf)).toEqual(
      [],
    );
  });

  it("is relations into the medical information, without Medical Writer", () => {
    expect(refusedByGuard(staff, [...crew, ...policy("CRM Writer")], fieldsOf)).toEqual([
      "relations into medical_profiles",
    ]);
  });
});
