import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";
import { effectiveAccess, violation } from "../stacks/backend/community-query-guard.cjs";
import { communityPolicies } from "../stacks/backend/community-rules.ts";
import { defaultViews } from "../stacks/backend/default-views.ts";
import { crewRules, groupPolicies, queryGuardConfig } from "../stacks/backend/policies.ts";

interface Collection {
  collection: string;
  meta: { hidden: boolean };
  schema?: unknown;
}

interface Field {
  collection: string;
  field: string;
  type: string;
  meta: { hidden: boolean };
  schema?: { is_primary_key: boolean } | null;
}

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta?: { one_field?: string | null };
}

const schemas = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const schema = mergeSchemas(schemas) as { collections: Collection[]; fields: Field[]; relations: Relation[] };

const fieldOf = (collection: string, name: string) =>
  schema.fields.find((field) => field.collection === collection && field.field === name);

/** The field a dotted path ends at, following each link to the row it points to. */
function resolve(collection: string, fieldPath: string): Field | undefined {
  const [first, ...rest] = fieldPath.split(".");
  const field = fieldOf(collection, first!);
  if (field === undefined || rest.length === 0) return field;
  const related = schema.relations.find((r) => r.collection === collection && r.field === first)?.related_collection;
  return related ? resolve(related, rest.join(".")) : undefined;
}

describe("the default views", () => {
  const visible = schema.collections.filter((c) => c.schema !== undefined && !c.meta.hidden).map((c) => c.collection);

  it("give every collection the sidebar shows exactly one", () => {
    expect(defaultViews.map((view) => view.collection).sort()).toEqual([...visible].sort());
  });

  it.each(defaultViews.map((view) => [view.collection, view]))("%s sorts and shows real fields", (_, view) => {
    for (const sort of view.sort) {
      expect(resolve(view.collection, sort.replace(/^-/, "")), sort).toBeDefined();
    }
    for (const column of view.fields) {
      const field = resolve(view.collection, column);
      expect(field, column).toBeDefined();
      expect(field!.meta.hidden, `${column} is hidden`).toBe(false);
      expect(field!.schema?.is_primary_key ?? false, `${column} is a row ID`).toBe(false);
    }
  });

  it("never open sorted by a row ID", () => {
    for (const view of defaultViews) {
      expect(view.sort.map((sort) => sort.replace(/^-/, ""))).not.toContain("id");
    }
  });

  describe("open for someone whose reads the query guard limits", () => {
    const config = queryGuardConfig([
      ...communityPolicies,
      { name: "Crew", rules: crewRules },
      ...groupPolicies(schemas),
    ]);
    const fieldsOf = (collection: string) =>
      schema.fields.filter((f) => f.collection === collection && f.type !== "alias").map(({ field }) => field);
    const community = communityPolicies.map(({ name }) => name);
    const holders = [
      ["Community", ["Community", ...community]],
      ["Crew", ["Crew", ...community]],
      ["Community with Plan and Catalog Reader", ["Community", ...community, "Plan Reader", "Catalog Reader"]],
      ["Crew with Plan and Catalog Reader", ["Crew", ...community, "Plan Reader", "Catalog Reader"]],
    ] as const;

    it.each(holders)("%s", (_, names) => {
      const access = effectiveAccess(config, [...names], fieldsOf)!;
      const reads = new Set(names.flatMap((name) => Object.keys(config.policies[name] ?? {})));
      const refused = defaultViews
        .filter((view) => reads.has(view.collection))
        .flatMap((view) => {
          const reason = violation(access, schema.relations, view.collection, { sort: view.sort, filter: view.filter });
          return reason ? [`${view.collection}: ${reason}`] : [];
        });
      expect(refused).toEqual([]);
    });
  });
});
