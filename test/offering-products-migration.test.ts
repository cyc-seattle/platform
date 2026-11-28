import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0030-offering-products.cjs";

// Offerings moving from their program to its product, in a real Postgres (PGlite), with Directus's own
// tables cut down to the columns the migration touches.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows;

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64), special varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64),
      one_field varchar(64)
    );
    CREATE TABLE products (id uuid PRIMARY KEY);
    CREATE TABLE programs (id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products (id));
    CREATE TABLE offerings (
      id uuid PRIMARY KEY,
      program_id uuid NOT NULL CONSTRAINT offerings_program_id_foreign REFERENCES programs (id) ON DELETE RESTRICT,
      name varchar(255)
    );
    INSERT INTO directus_fields (collection, field, special) VALUES ('offerings', 'program_id', 'm2o'), ('offerings', 'name', NULL);
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES ('offerings', 'program_id', 'programs');

    INSERT INTO products VALUES ('${id(1)}'), ('${id(2)}');
    INSERT INTO programs VALUES ('${id(11)}', '${id(1)}'), ('${id(12)}', '${id(2)}');
    INSERT INTO offerings VALUES ('${id(21)}', '${id(11)}', 'Week 1'), ('${id(22)}', '${id(12)}', 'Fall');
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the offering products migration", { timeout: 30_000 }, () => {
  it("gives each offering its program's product, and drops program_id", async () => {
    const db = await database();
    await migrate(db);
    expect(await rows(db, "SELECT id, product_id FROM offerings ORDER BY id")).toEqual([
      { id: id(21), product_id: id(1) },
      { id: id(22), product_id: id(2) },
    ]);
    expect(
      await rows(db, "SELECT column_name FROM information_schema.columns WHERE table_name = 'offerings' ORDER BY 1"),
    ).toEqual([{ column_name: "id" }, { column_name: "name" }, { column_name: "product_id" }]);
  });

  it("makes product_id required, and a product with offerings undeletable", async () => {
    const db = await database();
    await migrate(db);
    await expect(db.exec(`INSERT INTO offerings (id) VALUES ('${id(23)}')`)).rejects.toThrow(/null/);
    await expect(db.exec(`DELETE FROM products WHERE id = '${id(1)}'`)).rejects.toThrow(/foreign key/);
  });

  it("moves Directus's records of the field and its link", async () => {
    const db = await database();
    await migrate(db);
    expect(await rows(db, "SELECT field, special FROM directus_fields ORDER BY field")).toEqual([
      { field: "name", special: null },
      { field: "product_id", special: "m2o" },
    ]);
    expect(await rows(db, "SELECT many_field, one_collection FROM directus_relations")).toEqual([
      { many_field: "product_id", one_collection: "products" },
    ]);
  });

  it("does nothing when run again", async () => {
    const db = await database();
    await migrate(db);
    const before = await rows(db, "SELECT * FROM offerings ORDER BY id");
    await migrate(db);
    expect(await rows(db, "SELECT * FROM offerings ORDER BY id")).toEqual(before);
    expect(await rows(db, "SELECT count(*)::int AS n FROM directus_fields WHERE field = 'product_id'")).toEqual([
      { n: 1 },
    ]);
  });

  it("does nothing on a new database", async () => {
    const db = await PGlite.create();
    await migrate(db);
    expect(await rows(db, "SELECT to_regclass('offerings') AS t")).toEqual([{ t: null }]);
  });
});
