import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0025-storage-areas-no-sort.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

/** A database with storage_areas.sort, its Directus field, and the collection sorted by it. */
async function withSort() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY, sort_field varchar(64));
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE storage_areas (id uuid PRIMARY KEY, name varchar(255), sort integer);
    INSERT INTO directus_collections VALUES ('storage_areas', 'sort'), ('links', 'sort');
    INSERT INTO directus_fields (collection, field) VALUES
      ('storage_areas', 'name'), ('storage_areas', 'sort'), ('links', 'sort');
    INSERT INTO storage_areas VALUES (gen_random_uuid(), 'Docks', 1);
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the storage areas sort migration", { timeout: 30_000 }, () => {
  it("drops the column, its Directus field, and the collection's sort, keeping every row", async () => {
    const db = await withSort();
    await migrate(db);
    await migrate(db);
    const { rows: columns } = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'storage_areas' ORDER BY column_name",
    );
    expect(columns.map(({ column_name }) => column_name)).toEqual(["id", "name"]);
    expect((await db.query("SELECT name FROM storage_areas")).rows).toEqual([{ name: "Docks" }]);
    const { rows: fields } = await db.query("SELECT collection, field FROM directus_fields ORDER BY id");
    expect(fields).toEqual([
      { collection: "storage_areas", field: "name" },
      { collection: "links", field: "sort" },
    ]);
    const { rows: collections } = await db.query("SELECT * FROM directus_collections ORDER BY collection");
    expect(collections).toEqual([
      { collection: "links", sort_field: "sort" },
      { collection: "storage_areas", sort_field: null },
    ]);
  });

  it("does nothing before the apply makes the table", async () => {
    const db = await PGlite.create();
    await db.exec(`
      CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY, sort_field varchar(64));
      CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    `);
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
