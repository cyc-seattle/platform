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

/** Every subtype collection, per the subtype pattern in AGENTS.md. */
const subtypes = [
  {
    base: "products",
    kind: "program",
    subtype: "programs",
    foreignKey: "product_id",
    alias: "programs",
  },
];

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
  for (const { base, kind, subtype, foreignKey, alias } of subtypes) {
    describe(`${subtype} of ${base}`, () => {
      it(`lists ${kind} among ${base}.kind's choices and allowed values`, () => {
        const field = findField(base, "kind");
        expect(field.meta.options?.choices?.map((choice) => choice.value)).toContain(kind);
        expect(field.meta.validation).toMatchObject({ kind: { _in: expect.arrayContaining([kind]) } });
      });

      it(`links each ${subtype} row to one ${base} row, and only to one of kind ${kind} in the Data Studio`, () => {
        const field = findField(subtype, foreignKey);
        expect(field.schema).toMatchObject({ foreign_key_table: base, is_unique: true, is_nullable: false });
        expect(field.meta.required).toBe(true);
        expect(field.meta.options?.filter).toEqual({ kind: { _eq: kind } });
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

  it("lists every unique link to a collection with a kind", () => {
    const bases = new Set(schema.fields.filter((f) => f.field === "kind").map((f) => f.collection));
    const links = schema.fields
      .filter((f) => f.schema?.is_unique && f.schema.foreign_key_table && bases.has(f.schema.foreign_key_table))
      .map((f) => `${f.collection}.${f.field}`);
    expect(links.sort()).toEqual(subtypes.map(({ subtype, foreignKey }) => `${subtype}.${foreignKey}`).sort());
  });
});
