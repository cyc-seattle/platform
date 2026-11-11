import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0011-drop-inventory.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const INVENTORY = [
  "boat_charters",
  "boat_damage",
  "boat_stage_changes",
  "boats",
  "storage_agreements",
  "storage_spaces",
];

async function tables(db: PGlite) {
  const { rows } = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
  );
  return rows.map(({ table_name }) => table_name);
}

async function collections(db: PGlite) {
  const { rows } = await db.query<{ collection: string }>(
    "SELECT collection FROM directus_collections ORDER BY collection",
  );
  return rows.map(({ collection }) => collection);
}

/** Dev as the reverted inventory left it: its tables, their links, and Directus's rows for them. */
async function withInventory() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64)
    );
    CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE boat_classes (id uuid PRIMARY KEY);
    CREATE TABLE people (id uuid PRIMARY KEY);
    CREATE TABLE storage_spaces (id uuid PRIMARY KEY, boat_class_id uuid REFERENCES boat_classes (id));
    CREATE TABLE boats (
      id uuid PRIMARY KEY, boat_class_id uuid REFERENCES boat_classes (id),
      storage_space_id uuid REFERENCES storage_spaces (id)
    );
    CREATE TABLE boat_stage_changes (id uuid PRIMARY KEY, boat_id uuid REFERENCES boats (id));
    CREATE TABLE boat_charters (
      id uuid PRIMARY KEY, boat_id uuid REFERENCES boats (id), person_id uuid REFERENCES people (id)
    );
    CREATE TABLE boat_damage (id uuid PRIMARY KEY, boat_id uuid REFERENCES boats (id));
    CREATE TABLE storage_agreements (
      id uuid PRIMARY KEY, storage_space_id uuid REFERENCES storage_spaces (id), person_id uuid REFERENCES people (id)
    );
    INSERT INTO directus_collections VALUES ('Inventory'), ('boat_classes'), ('people'),
      ('storage_spaces'), ('boats'), ('boat_stage_changes'), ('boat_charters'), ('boat_damage'), ('storage_agreements');
    INSERT INTO directus_fields (collection, field) VALUES ('boats', 'boat_class_id'), ('boat_classes', 'id');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('boats', 'boat_class_id', 'boat_classes'), ('boat_charters', 'person_id', 'people');
    INSERT INTO directus_permissions (collection) VALUES ('boats'), ('boat_classes');
    INSERT INTO directus_presets (collection) VALUES ('storage_spaces');
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the drop inventory migration", { timeout: 30_000 }, () => {
  it("drops the empty inventory, its Directus rows, and its folder", async () => {
    const db = await withInventory();
    await migrate(db);
    await migrate(db);
    expect(await tables(db)).toEqual([
      "boat_classes",
      "directus_collections",
      "directus_fields",
      "directus_permissions",
      "directus_presets",
      "directus_relations",
      "people",
    ]);
    expect(await collections(db)).toEqual(["boat_classes", "people"]);
    const { rows: fields } = await db.query("SELECT collection FROM directus_fields");
    expect(fields).toEqual([{ collection: "boat_classes" }]);
    const { rows: relations } = await db.query("SELECT many_field FROM directus_relations");
    expect(relations).toEqual([]);
    const { rows: permissions } = await db.query("SELECT collection FROM directus_permissions");
    expect(permissions).toEqual([{ collection: "boat_classes" }]);
  });

  it("leaves all of it alone while any of it has rows", async () => {
    const db = await withInventory();
    await db.exec("INSERT INTO storage_spaces (id) VALUES (gen_random_uuid())");
    await migrate(db);
    expect(await tables(db)).toEqual(expect.arrayContaining(INVENTORY));
    expect(await collections(db)).toContain("Inventory");
  });

  it("does nothing on prod, or on a new database", async () => {
    const db = await PGlite.create();
    await db.exec("CREATE TABLE boats (id uuid PRIMARY KEY)");
    await migrate(db);
    expect(await tables(db)).toEqual(["boats"]);
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
