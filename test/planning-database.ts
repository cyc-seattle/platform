import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import * as yaml from "js-yaml";
import { expect } from "vitest";
import type { FrozenPlansConfig } from "../stacks/backend/policies.ts";
import { installTriggers } from "../stacks/backend/frozen-plans.cjs";

// The planning tables, made from the schemas in a real Postgres (PGlite), with the frozen-plans
// hook's triggers on them.

interface Field {
  collection: string;
  field: string;
  schema?: { data_type: string; is_primary_key: boolean };
}
interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  schema?: { on_delete?: string } | null;
}

export const schemas = ["core", "directory", "hr", "planning"].map((name) => ({
  name,
  schema: yaml.load(fs.readFileSync(path.resolve(import.meta.dirname, `../schemas/${name}.yaml`), "utf8")) as {
    fields: Field[];
    relations: Relation[];
  },
}));

/** The tables, keys, and foreign keys the schemas declare. Only a primary key is required. */
export function tables(): string[] {
  const fields = schemas.flatMap(({ schema }) => schema.fields).filter((field) => field.schema);
  const names = [...new Set(fields.map((field) => field.collection))];
  const create = names.map((table) => {
    const columns = fields
      .filter((field) => field.collection === table)
      .map(({ field, schema }) => `"${field}" ${schema!.data_type}${schema!.is_primary_key ? " PRIMARY KEY" : ""}`);
    return `CREATE TABLE "${table}" (${columns.join(", ")})`;
  });
  const keys = schemas
    .flatMap(({ schema }) => schema.relations)
    .filter(({ related_collection: related }) => related !== null && names.includes(related))
    .map(
      ({ collection, field, related_collection: related, schema }) =>
        `ALTER TABLE "${collection}" ADD FOREIGN KEY ("${field}") REFERENCES "${related}" (id) ON DELETE ${schema?.on_delete ?? "RESTRICT"}`,
    );
  return [...create, ...keys];
}

export async function database(config: FrozenPlansConfig): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pageinspect } });
  await db.exec("CREATE EXTENSION pageinspect");
  for (const statement of tables()) await db.exec(statement);
  const { missing } = await db.transaction((tx) => installTriggers(config, connect(tx)));
  expect(missing).toEqual([]);
  return db;
}

export const connect = (tx: Transaction) => ({
  query: async (sql: string) => (await tx.query<Record<string, unknown>>(sql)).rows,
  exec: (sql: string) => tx.exec(sql),
});
