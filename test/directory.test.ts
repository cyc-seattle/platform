import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";

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
const { relations } = mergeSchemas(loaded) as { relations: Relation[] };

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
});
