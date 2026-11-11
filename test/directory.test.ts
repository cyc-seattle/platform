import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";

interface Field {
  collection: string;
  field: string;
  meta: { required: boolean } | null;
  schema: { is_nullable: boolean } | null;
}

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  schema: { on_delete: string } | null;
}

const loaded = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const { fields, relations } = mergeSchemas(loaded) as { fields: Field[]; relations: Relation[] };

describe("the directory", () => {
  // An organization or venue still in use can't be deleted (cyc-seattle/platform#128).
  it.each(["organizations", "venues"])(
    "keeps a row in %s from being deleted while another row refers to it",
    (table) => {
      const into = relations.filter(({ related_collection }) => related_collection === table);
      for (const relation of into) {
        expect(`${relation.collection}.${relation.field}: ${relation.schema?.on_delete}`).toBe(
          `${relation.collection}.${relation.field}: RESTRICT`,
        );
      }
    },
  );

  // A venue such as a public marina is run by no one we track.
  it("lets a venue have no organization", () => {
    const field = fields.find(({ collection, field }) => collection === "venues" && field === "organization_id");
    expect(field?.schema?.is_nullable).toBe(true);
    expect(field?.meta?.required).toBe(false);
  });
});
