import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0010-drop-terms.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function tables(db: PGlite) {
  const { rows } = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
  );
  return rows.map(({ table_name }) => table_name);
}

async function columns(db: PGlite, table: string) {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY column_name`,
  );
  return rows.map(({ column_name }) => column_name);
}

async function count(db: PGlite, table: string, collection: string) {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE collection = $1`, [
    collection,
  ]);
  return rows[0]!.n;
}

/** Dev as #229 left it: terms, boat_charters.term_id, and Directus's rows for them. */
async function withTerms(rows: boolean) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64)
    );
    CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE terms (id uuid PRIMARY KEY, name varchar(255) NOT NULL);
    CREATE TABLE boat_charters (id uuid PRIMARY KEY, term_id uuid REFERENCES terms (id), fee_cents integer);
    INSERT INTO directus_collections VALUES ('terms'), ('boat_charters');
    INSERT INTO directus_fields (collection, field) VALUES
      ('terms', 'id'), ('terms', 'name'), ('boat_charters', 'term_id'), ('boat_charters', 'fee_cents');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('boat_charters', 'term_id', 'terms');
    INSERT INTO directus_permissions (collection) VALUES ('terms'), ('boat_charters');
    INSERT INTO directus_presets (collection) VALUES ('terms');
  `);
  if (rows) await db.exec("INSERT INTO terms VALUES (gen_random_uuid(), 'Fall 2026')");
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the drop terms migration", { timeout: 30_000 }, () => {
  it("drops an empty terms, boat_charters.term_id, and Directus's rows for them", async () => {
    const db = await withTerms(false);
    await migrate(db);
    await migrate(db);
    expect(await tables(db)).not.toContain("terms");
    expect(await columns(db, "boat_charters")).toEqual(["fee_cents", "id"]);
    for (const table of ["directus_collections", "directus_fields", "directus_permissions", "directus_presets"]) {
      expect(await count(db, table, "terms")).toBe(0);
    }
    const { rows } = await db.query("SELECT many_field FROM directus_relations");
    expect(rows).toEqual([]);
    expect(await count(db, "directus_fields", "boat_charters")).toBe(1);
    expect(await count(db, "directus_permissions", "boat_charters")).toBe(1);
  });

  it("leaves terms alone once it has rows", async () => {
    const db = await withTerms(true);
    await migrate(db);
    expect(await tables(db)).toContain("terms");
    expect(await columns(db, "boat_charters")).toEqual(["fee_cents", "id", "term_id"]);
  });

  it("does nothing on prod, or on a new database", async () => {
    const db = await PGlite.create();
    await db.exec("CREATE TABLE boat_charters (id uuid PRIMARY KEY)");
    await migrate(db);
    expect(await tables(db)).toEqual(["boat_charters"]);
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
