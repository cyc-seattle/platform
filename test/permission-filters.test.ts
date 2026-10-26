import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";
import { communityPolicies } from "../stacks/backend/community-rules.ts";
import { guardianRules } from "../stacks/backend/guardian-rules.ts";

interface Snapshot {
  fields: { collection: string; field: string }[];
  relations: {
    collection: string;
    field: string;
    related_collection: string | null;
    meta?: { one_field?: string | null };
  }[];
}

const schema = mergeSchemas(
  discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
    name,
    schema: yaml.load(fs.readFileSync(file, "utf8")),
  })),
) as Snapshot;

function related(collection: string, field: string): string | undefined {
  for (const relation of schema.relations) {
    if (relation.collection === collection && relation.field === field && relation.related_collection) {
      return relation.related_collection;
    }
    if (relation.related_collection === collection && relation.meta?.one_field === field) return relation.collection;
  }
  return undefined;
}

/** Every key in `filter` that isn't a field of the collection it applies to. Directus silently drops
 * such a clause, and the query then fails with a 500. */
function unknownFields(collection: string, filter: unknown, path = collection): string[] {
  if (filter === null || typeof filter !== "object") return [];
  return Object.entries(filter).flatMap(([key, value]) => {
    if (key === "_and" || key === "_or") {
      return (value as unknown[]).flatMap((branch) => unknownFields(collection, branch, path));
    }
    if (key === "_some" || key === "_none") return unknownFields(collection, value, path);
    if (key.startsWith("_")) return [];
    if (!schema.fields.some((field) => field.collection === collection && field.field === key)) {
      return [`${path}.${key}`];
    }
    const target = related(collection, key);
    return target ? unknownFields(target, value, `${path}.${key}`) : [];
  });
}

const rules = [
  ...guardianRules.map((rule) => ({ policy: "Guardian", ...rule })),
  ...communityPolicies.flatMap((policy) => policy.rules.map((rule) => ({ policy: policy.name, ...rule }))),
];

describe("permission filters", () => {
  for (const rule of rules) {
    it(`${rule.policy}'s ${rule.collection} ${rule.action} filter names only real fields, one relation per level`, () => {
      expect(unknownFields(rule.collection, rule.permissions)).toEqual([]);
    });
  }
});

describe("Guardian rules", () => {
  it("reach the guardian link through nested relations, not a dotted key", () => {
    const rule = guardianRules.find((r) => r.collection === "registration_entries");
    expect(rule?.permissions).toEqual({
      registration_id: {
        participant_id: {
          person_id: {
            my_contacts: {
              _and: [
                { relationship_type: { _eq: "guardian" } },
                { contact_id: { directus_user_id: { _eq: "$CURRENT_USER" } } },
              ],
            },
          },
        },
      },
    });
  });
});
