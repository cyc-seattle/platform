import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { PREFIX, RENAMED, up } from "../stacks/backend/migrations/cyc0001-clubspot-prefix.cjs";

// The Clubspot prefix migration, in a real Postgres (PGlite), on the tables schemas/clubspot.yaml had
// before it: the same tables, keys, and key names, without the prefix.

interface Field {
  collection: string;
  field: string;
  schema?: { data_type: string; is_primary_key: boolean };
}
interface Relation {
  collection: string;
  field: string;
  related_collection: string;
  schema: { constraint_name: string };
}

const schema = yaml.load(fs.readFileSync(path.resolve(import.meta.dirname, "../schemas/clubspot.yaml"), "utf8")) as {
  fields: Field[];
  relations: Relation[];
};

const unprefixed = (name: string): string => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);

/** The mirror's tables as they were, and the CRM's tables they and their relations touch. */
function before(): string[] {
  const fields = schema.fields.filter((field) => field.schema && field.collection.startsWith(PREFIX));
  const tables = [...new Set(fields.map((field) => field.collection))];
  const create = tables.map((table) => {
    const columns = fields
      .filter((field) => field.collection === table)
      .map(({ field, schema }) => `"${field}" ${schema!.data_type}${schema!.is_primary_key ? " PRIMARY KEY" : ""}`);
    return `CREATE TABLE "${unprefixed(table)}" (${columns.join(", ")})`;
  });
  const keys = schema.relations.map(
    ({ collection, field, related_collection: related, schema: { constraint_name: name } }) =>
      `ALTER TABLE "${unprefixed(collection)}" ADD CONSTRAINT "${unprefixed(name)}" ` +
      `FOREIGN KEY ("${field}") REFERENCES "${unprefixed(related)}" (id)`,
  );
  return [
    "CREATE TABLE people (id uuid PRIMARY KEY)",
    "CREATE TABLE programs (id uuid PRIMARY KEY)",
    "CREATE TABLE sync_runs (id uuid PRIMARY KEY)",
    "CREATE TABLE contact_points (id uuid PRIMARY KEY, participant_id varchar(255))",
    ...create,
    "CREATE TABLE event_staff (id uuid PRIMARY KEY, person_id uuid REFERENCES people (id), session_id varchar(255))",
    ...keys,
  ];
}

/** The slice of Directus's own tables the migration touches. */
const DIRECTUS = [
  'CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY, "group" varchar(64))',
  "CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64))",
  "CREATE TABLE directus_relations (id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64))",
  "CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64))",
  "CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64))",
  "CREATE TABLE directus_revisions (id serial PRIMARY KEY, collection varchar(64), item varchar(255))",
  "CREATE TABLE directus_activity (id serial PRIMARY KEY, collection varchar(64), item varchar(255))",
];

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  for (const statement of [...DIRECTUS, ...before()]) await db.exec(statement);
  for (const table of [...RENAMED, "event_staff", "people"]) {
    await db.query("INSERT INTO directus_collections (collection) VALUES ($1)", [table]);
    await db.query("INSERT INTO directus_fields (collection, field) VALUES ($1, 'id')", [table]);
    await db.query("INSERT INTO directus_permissions (collection) VALUES ($1)", [table]);
    await db.query("INSERT INTO directus_presets (collection) VALUES ($1)", [table]);
    await db.query("INSERT INTO directus_revisions (collection, item) VALUES ($1, 'a')", [table]);
    await db.query("INSERT INTO directus_activity (collection, item) VALUES ($1, 'a')", [table]);
  }
  for (const { collection, field, related_collection: related } of schema.relations) {
    await db.query("INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES ($1, $2, $3)", [
      unprefixed(collection),
      field,
      unprefixed(related),
    ]);
  }
  await db.query(
    "INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES ('event_staff', 'person_id', 'people')",
  );
  await db.exec(`
    INSERT INTO camps (id, name) VALUES ('camp-1', 'Summer');
    INSERT INTO classes (id, camp_id, name) VALUES ('class-1', 'camp-1', 'Guppies');
    INSERT INTO participants (id, first_name) VALUES ('participant-1', 'Avery');
    INSERT INTO contact_points (id, participant_id) VALUES ('00000000-0000-4000-8000-000000000001', 'participant-1');
  `);
  return db;
}

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function tables(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT LIKE 'directus_%' ORDER BY 1",
  );
  return rows.map((row) => row.tablename);
}

async function constraints(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text NOT LIKE 'directus_%' ORDER BY 1",
  );
  return rows.map((row) => row.conname);
}

async function collections(db: PGlite, table: string, column: string): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(`SELECT DISTINCT ${column} AS name FROM ${table} ORDER BY 1`);
  return rows.map((row) => row.name);
}

const prefixed = RENAMED.map((name) => `${PREFIX}${name}`);

describe("the Clubspot prefix migration", () => {
  it("renames each mirror's table, keeping its rows", async () => {
    const db = await database();
    await migrate(db);

    expect(await tables(db)).toEqual(
      [...prefixed, "contact_points", "people", "programs", "sync_runs"].sort((a, b) => a.localeCompare(b)),
    );
    const { rows } = await db.query<{ name: string }>(
      "SELECT c.name FROM clubspot_classes c JOIN clubspot_camps k ON k.id = c.camp_id",
    );
    expect(rows).toEqual([{ name: "Guppies" }]);
  });

  it("gives each key the name schemas/clubspot.yaml records", async () => {
    const db = await database();
    await migrate(db);

    const declared = schema.relations.map((relation) => relation.schema.constraint_name);
    expect(await constraints(db)).toEqual([...declared].sort());
    const { rows } = await db.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE contype = 'p' AND conrelid = 'clubspot_camps'::regclass",
    );
    expect(rows).toEqual([{ conname: "clubspot_camps_pkey" }]);
  });

  it("renames the collection everywhere Directus records it", async () => {
    const db = await database();
    await migrate(db);

    const expected = [...prefixed, "people"].sort();
    for (const table of ["directus_collections", "directus_fields", "directus_permissions", "directus_presets"]) {
      expect(await collections(db, table, "collection"), table).toEqual(
        // event_staff's permissions and default view are the stack's to delete.
        table === "directus_permissions" || table === "directus_presets"
          ? [...expected, "event_staff"].sort()
          : expected,
      );
    }
    for (const table of ["directus_revisions", "directus_activity"]) {
      expect(await collections(db, table, "collection"), table).toEqual([...expected, "event_staff"].sort());
    }
    expect(await collections(db, "directus_relations", "many_collection")).toEqual(
      [...prefixed.filter((name) => schema.relations.some((r) => r.collection === name)), "contact_points"].sort(),
    );
  });

  it("drops event_staff only when it's empty", async () => {
    const db = await database();
    await db.exec(
      "INSERT INTO people (id) VALUES ('00000000-0000-4000-8000-000000000002');" +
        "INSERT INTO event_staff (id, person_id) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002')",
    );
    await migrate(db);
    expect(await tables(db)).toContain("event_staff");

    await db.exec("DELETE FROM event_staff");
    await migrate(db);
    expect(await tables(db)).not.toContain("event_staff");
    expect(await collections(db, "directus_collections", "collection")).not.toContain("event_staff");
  });

  it("changes nothing when it runs again", async () => {
    const db = await database();
    await migrate(db);
    const dump = async () => ({
      tables: await tables(db),
      constraints: await constraints(db),
      collections: await collections(db, "directus_collections", "collection"),
      relations: (await db.query("SELECT * FROM directus_relations ORDER BY id")).rows,
    });
    const first = await dump();

    await migrate(db);
    expect(await dump()).toEqual(first);
  });

  it("does nothing on a database with no mirrors", async () => {
    const db = await PGlite.create();
    for (const statement of DIRECTUS) await db.exec(statement);

    await migrate(db);
    expect(await tables(db)).toEqual([]);
  });

  it("leaves a mirror alone when both its names exist", async () => {
    const db = await database();
    await db.exec("CREATE TABLE clubspot_camps (id varchar(255) PRIMARY KEY)");
    await migrate(db);

    expect(await tables(db)).toEqual(expect.arrayContaining(["camps", "clubspot_camps", "clubspot_classes"]));
    expect(await collections(db, "directus_collections", "collection")).toContain("camps");
  });
});
