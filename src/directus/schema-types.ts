// Generates src/schema/index.ts, the Directus schema's types, from the merged schemas/*.yaml snapshot
// (`mise run schema-types`). Apps pass the `Schema` it declares to `@directus/sdk`'s `createDirectus`.

import fs from "node:fs";
import * as yaml from "js-yaml";
import * as prettier from "prettier";
import { discoverSchemaFiles, mergeSchemas } from "./client.ts";

interface Choice {
  value: unknown;
}

interface Field {
  collection: string;
  field: string;
  type: string;
  meta?: {
    hidden?: boolean;
    interface?: string | null;
    note?: string | null;
    options?: { choices?: Choice[] | null; allowOther?: boolean } | null;
    special?: string[] | null;
  } | null;
  schema?: { is_nullable?: boolean; is_primary_key?: boolean } | null;
}

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta?: { one_collection?: string | null; one_field?: string | null; many_collection?: string } | null;
}

interface Collection {
  collection: string;
  meta?: { note?: string | null; singleton?: boolean } | null;
  schema?: unknown;
}

export interface Snapshot {
  collections: Collection[];
  fields: Field[];
  relations: Relation[];
}

/** `plan_versions` → `PlanVersions`. */
export function typeName(collection: string): string {
  return collection
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

/** The TypeScript type of a value Directus returns for a field of this type. */
function scalar(field: Field): string {
  const choices = field.meta?.options?.allowOther ? undefined : field.meta?.options?.choices;
  const union = choices?.length ? choices.map((c) => JSON.stringify(c.value)).join(" | ") : undefined;
  switch (field.type) {
    case "integer":
    case "float":
      return union ?? "number";
    case "boolean":
      return "boolean";
    case "csv":
      return "string[]";
    case "json":
      if (field.meta?.interface === "tags") {
        return "string[]";
      }
      return union ? `(${union})[]` : "unknown";
    // Directus returns bigInteger and decimal as strings, so no precision is lost.
    default:
      return union ?? "string";
  }
}

function comment(text: string | null | undefined, indent: string): string {
  if (!text) {
    return "";
  }
  return `${indent}/** ${text.replace(/\*\//g, "*\\/").replace(/\s+/g, " ").trim()} */\n`;
}

/** The TypeScript source of the `Schema` type and one interface per table-backed collection. */
export function generateSchemaTypes(snapshot: Snapshot): string {
  const collections = snapshot.collections
    .filter((c) => c.schema != null)
    .sort((a, b) => a.collection.localeCompare(b.collection));
  const known = new Set(collections.map((c) => c.collection));
  const fieldsOf = (collection: string) => snapshot.fields.filter((f) => f.collection === collection);
  const primaryKey = (collection: string) => {
    const pk = fieldsOf(collection).find((f) => f.schema?.is_primary_key);
    return pk ? scalar(pk) : "string";
  };
  // A collection this snapshot doesn't declare, such as directus_users, is typed by its key alone.
  const related = (collection: string) =>
    known.has(collection) ? `${primaryKey(collection)} | ${typeName(collection)}` : primaryKey(collection);

  const fieldType = (field: Field): string | undefined => {
    if (field.type === "alias") {
      const many = snapshot.relations.find(
        (r) => r.meta?.one_collection === field.collection && r.meta?.one_field === field.field,
      );
      // Groups and dividers carry no data.
      return many ? `(${related(many.collection)})[]` : undefined;
    }
    const one = snapshot.relations.find(
      (r) => r.collection === field.collection && r.field === field.field && r.related_collection,
    );
    const type = one ? related(one.related_collection!) : scalar(field);
    const nullable = field.schema?.is_nullable && !field.schema.is_primary_key && type !== "unknown";
    return nullable ? `${type} | null` : type;
  };

  let out =
    "// Generated from schemas/*.yaml by `mise run schema-types`. Don't edit it by hand.\n\n" +
    "/** Every collection, for `createDirectus<Schema>()`. */\nexport interface Schema {\n";
  for (const c of collections) {
    out += `  ${c.collection}: ${typeName(c.collection)}${c.meta?.singleton ? "" : "[]"};\n`;
  }
  out += "}\n";

  for (const c of collections) {
    out += `\n${comment(c.meta?.note, "")}export interface ${typeName(c.collection)} {\n`;
    for (const field of fieldsOf(c.collection)) {
      const type = fieldType(field);
      if (type !== undefined) {
        out += `${comment(field.meta?.note, "  ")}  ${field.field}: ${type};\n`;
      }
    }
    out += "}\n";
  }
  return out;
}

/** The formatted source of src/schema/index.ts, from every schema in `schemasDir`. */
export async function loadSchemaTypes(schemasDir: string): Promise<string> {
  const snapshot = mergeSchemas(
    discoverSchemaFiles(schemasDir).map(({ name, path }) => ({
      name,
      schema: yaml.load(fs.readFileSync(path, "utf8")),
    })),
  ) as Snapshot;
  const options = await prettier.resolveConfig(schemasDir);
  return prettier.format(generateSchemaTypes(snapshot), { ...options, parser: "typescript" });
}
