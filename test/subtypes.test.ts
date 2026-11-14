import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";

interface Field {
  collection: string;
  field: string;
  type: string;
  meta: {
    required: boolean;
    special: string[] | null;
    options: { choices?: { value: string }[]; filter?: unknown } | null;
    validation: unknown;
  };
  schema?: { is_nullable: boolean; is_unique: boolean; foreign_key_table: string | null };
}

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta: { one_field: string | null };
  schema: { on_delete: string };
}

const schema = mergeSchemas(
  discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
    name,
    schema: yaml.load(fs.readFileSync(file, "utf8")),
  })),
) as { fields: Field[]; relations: Relation[] };

/**
 * Every subtype collection, per the subtype pattern in AGENTS.md. `kindOf` is the collection that
 * holds `kind`, and `kindPath` the links from the base to it, for a subtype of a subtype.
 */
const subtypes = [
  {
    base: "products",
    kinds: ["program"],
    kindOf: "products",
    kindPath: [],
    subtype: "programs",
    foreignKey: "product_id",
    alias: "programs",
  },
  {
    base: "assets",
    kinds: ["sailboat", "powerboat"],
    kindOf: "assets",
    kindPath: [],
    subtype: "boats",
    foreignKey: "asset_id",
    alias: "boats",
  },
  {
    base: "boats",
    kinds: ["sailboat"],
    kindOf: "assets",
    kindPath: ["asset_id"],
    subtype: "sailboats",
    foreignKey: "boat_id",
    alias: "sailboats",
  },
];

/** The picker filter for rows whose `kind`, through `path`, is one of `kinds`. */
function kindFilter(path: string[], kinds: string[]): unknown {
  const filter = { kind: kinds.length === 1 ? { _eq: kinds[0] } : { _in: kinds } };
  return path.reduceRight<unknown>((inner, link) => ({ [link]: inner }), filter);
}

function findField(collection: string, field: string): Field {
  const found = schema.fields.find((f) => f.collection === collection && f.field === field);
  if (!found) throw new Error(`no field ${collection}.${field}`);
  return found;
}

function findRelation(collection: string, field: string): Relation {
  const found = schema.relations.find((r) => r.collection === collection && r.field === field);
  if (!found) throw new Error(`no relation ${collection}.${field}`);
  return found;
}

describe("subtypes", () => {
  for (const { base, kinds, kindOf, kindPath, subtype, foreignKey, alias } of subtypes) {
    describe(`${subtype} of ${base}`, () => {
      it(`lists ${kinds.join(" and ")} among ${kindOf}.kind's choices and allowed values`, () => {
        const field = findField(kindOf, "kind");
        expect(field.meta.options?.choices?.map((choice) => choice.value)).toEqual(expect.arrayContaining(kinds));
        expect(field.meta.validation).toMatchObject({ kind: { _in: expect.arrayContaining(kinds) } });
      });

      it(`links each ${subtype} row to one ${base} row, and only to one of kind ${kinds.join(" or ")} in the Data Studio`, () => {
        const field = findField(subtype, foreignKey);
        expect(field.schema).toMatchObject({ foreign_key_table: base, is_unique: true, is_nullable: false });
        expect(field.meta.required).toBe(true);
        expect(field.meta.options?.filter).toEqual(kindFilter(kindPath, kinds));
      });

      it(`blocks deleting a ${base} row that has a ${subtype} row`, () => {
        expect(findRelation(subtype, foreignKey).schema.on_delete).toBe("RESTRICT");
      });

      it(`reads the ${subtype} row from ${base}.${alias}`, () => {
        expect(findRelation(subtype, foreignKey).related_collection).toBe(base);
        expect(findRelation(subtype, foreignKey).meta.one_field).toBe(alias);
        expect(findField(base, alias).meta.special).toEqual(["o2m"]);
      });
    });
  }

  it("lists every unique link to a collection with a kind, or to a subtype", () => {
    const bases = new Set([
      ...schema.fields.filter((f) => f.field === "kind").map((f) => f.collection),
      ...subtypes.map(({ subtype }) => subtype),
    ]);
    const links = schema.fields
      .filter((f) => f.schema?.is_unique && f.schema.foreign_key_table && bases.has(f.schema.foreign_key_table))
      .map((f) => `${f.collection}.${f.field}`);
    expect(links.sort()).toEqual(subtypes.map(({ subtype, foreignKey }) => `${subtype}.${foreignKey}`).sort());
  });
});
