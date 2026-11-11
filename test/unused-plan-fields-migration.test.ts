import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { DROPPED, up } from "../stacks/backend/migrations/cyc0012-unused-plan-fields.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function columns(db: PGlite, table: string) {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY column_name`,
  );
  return rows.map(({ column_name }) => column_name);
}

/** A database with the five fields, and Directus's rows for them, holding a saved copy's values. */
async function withFields() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (
      collection varchar(64) PRIMARY KEY, archive_field varchar(64), archive_value varchar(255),
      unarchive_value varchar(255)
    );
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64)
    );
    CREATE TABLE catalog_offerings (id uuid PRIMARY KEY);
    CREATE TABLE plans (id uuid PRIMARY KEY, name varchar(255), archived boolean NOT NULL DEFAULT false);
    CREATE TABLE plan_offerings (
      id uuid PRIMARY KEY, name varchar(255), catalog_offering_id uuid REFERENCES catalog_offerings (id)
    );
    CREATE TABLE plan_staff_levels (id uuid PRIMARY KEY, name varchar(255), qualifications json);
    CREATE TABLE plan_salaried_positions (
      id uuid PRIMARY KEY, name varchar(255), qualifications json, form_990_line varchar(255)
    );
    INSERT INTO directus_collections VALUES ('plans', 'archived', 'true', 'false'), ('catalog_offerings', NULL, NULL, NULL);
    INSERT INTO directus_fields (collection, field) VALUES
      ('plans', 'name'), ('plans', 'archived'), ('plan_offerings', 'name'), ('plan_offerings', 'catalog_offering_id'),
      ('plan_staff_levels', 'name'), ('plan_staff_levels', 'qualifications'), ('plan_salaried_positions', 'name'),
      ('plan_salaried_positions', 'qualifications'), ('plan_salaried_positions', 'form_990_line');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('plan_offerings', 'catalog_offering_id', 'catalog_offerings');
    INSERT INTO catalog_offerings VALUES (gen_random_uuid());
    INSERT INTO plans VALUES (gen_random_uuid(), 'Operations', true);
    INSERT INTO plan_offerings SELECT gen_random_uuid(), 'Fall practices', id FROM catalog_offerings;
    INSERT INTO plan_staff_levels VALUES (gen_random_uuid(), 'Instructor', '["q-1"]');
    INSERT INTO plan_salaried_positions VALUES (gen_random_uuid(), 'Director', '["q-1"]', '5');
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the unused plan fields migration", { timeout: 30_000 }, () => {
  it("drops the fields, their Directus rows, and plans' archive setting, keeping every row", async () => {
    const db = await withFields();
    await migrate(db);
    await migrate(db);
    for (const table of Object.keys(DROPPED)) {
      expect(await columns(db, table)).toEqual(["id", "name"]);
      expect((await db.query(`SELECT name FROM ${table}`)).rows).toHaveLength(1);
    }
    const { rows: fields } = await db.query<{ field: string }>("SELECT field FROM directus_fields");
    expect(fields.map(({ field }) => field)).toEqual(["name", "name", "name", "name"]);
    expect((await db.query("SELECT 1 FROM directus_relations")).rows).toEqual([]);
    const { rows: collections } = await db.query("SELECT * FROM directus_collections WHERE collection = 'plans'");
    expect(collections).toEqual([
      { collection: "plans", archive_field: null, archive_value: null, unarchive_value: null },
    ]);
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
