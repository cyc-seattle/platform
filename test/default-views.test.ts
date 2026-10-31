import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";
import { defaultViews } from "../stacks/backend/default-views.ts";

interface Collection {
  collection: string;
  meta: { hidden: boolean };
  schema?: unknown;
}

interface Field {
  collection: string;
  field: string;
  meta: { hidden: boolean };
  schema?: { is_primary_key: boolean } | null;
}

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
}

const schema = mergeSchemas(
  discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
    name,
    schema: yaml.load(fs.readFileSync(file, "utf8")),
  })),
) as { collections: Collection[]; fields: Field[]; relations: Relation[] };

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
});
