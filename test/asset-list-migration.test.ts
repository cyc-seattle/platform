import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0013-asset-list.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function columns(db: PGlite, table: string) {
  const { rows } = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name",
    [table],
  );
  return rows.map(({ column_name }) => column_name);
}

async function directusFields(db: PGlite) {
  const { rows } = await db.query<{ collection: string; field: string }>(
    "SELECT collection, field FROM directus_fields ORDER BY collection, field",
  );
  return rows.map(({ collection, field }) => `${collection}.${field}`);
}

/** Prod as it was before the asset list: the old boat list, empty, and the plan's quantities. */
async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64)
    );
    CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE boat_classes (id uuid PRIMARY KEY, name text, sailors_per_boat integer NOT NULL);
    CREATE TABLE boats (id uuid PRIMARY KEY, boat_class_id uuid REFERENCES boat_classes (id), sail_number text);
    CREATE TABLE plan_boat_rates (id uuid PRIMARY KEY, maintenance_per_boat_hour_cents integer, quantity integer);
    CREATE TABLE plan_resources (id uuid PRIMARY KEY, name text, quantity integer);
    INSERT INTO boat_classes VALUES ('00000000-0000-0000-0000-000000000001', 'FJ', 2);
    INSERT INTO directus_collections VALUES ('boat_classes'), ('boats'), ('plan_boat_rates'), ('plan_resources');
    INSERT INTO directus_fields (collection, field) VALUES
      ('boat_classes', 'sailors_per_boat'), ('boats', 'boat_class_id'), ('boats', 'sail_number'),
      ('plan_boat_rates', 'quantity'), ('plan_boat_rates', 'maintenance_per_boat_hour_cents'),
      ('plan_resources', 'quantity'), ('plan_resources', 'name');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('boats', 'boat_class_id', 'boat_classes');
    INSERT INTO directus_permissions (collection) VALUES ('boats'), ('boat_classes');
    INSERT INTO directus_presets (collection) VALUES ('boats');
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the asset list migration", { timeout: 30_000 }, () => {
  it("drops the empty old boat list and the plan's quantities, and renames max capacity", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    expect(await columns(db, "boats")).toEqual([]);
    expect(await columns(db, "plan_boat_rates")).toEqual(["id", "maintenance_per_boat_hour_cents"]);
    expect(await columns(db, "plan_resources")).toEqual(["id", "name"]);
    expect(await columns(db, "boat_classes")).toEqual(["id", "max_capacity", "name"]);
    const { rows } = await db.query("SELECT max_capacity FROM boat_classes");
    expect(rows).toEqual([{ max_capacity: 2 }]);
    expect(await directusFields(db)).toEqual([
      "boat_classes.max_capacity",
      "plan_boat_rates.maintenance_per_boat_hour_cents",
      "plan_resources.name",
    ]);
    const { rows: collections } = await db.query("SELECT collection FROM directus_collections ORDER BY 1");
    expect(collections).toEqual([
      { collection: "boat_classes" },
      { collection: "plan_boat_rates" },
      { collection: "plan_resources" },
    ]);
    const { rows: relations } = await db.query("SELECT many_field FROM directus_relations");
    expect(relations).toEqual([]);
    const { rows: permissions } = await db.query("SELECT collection FROM directus_permissions");
    expect(permissions).toEqual([{ collection: "boat_classes" }]);
    const { rows: presets } = await db.query("SELECT collection FROM directus_presets");
    expect(presets).toEqual([]);
  });

  it("refuses to drop an old boat list that has rows, and changes nothing", async () => {
    const db = await before();
    await db.exec("INSERT INTO boats VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '123')");
    await expect(migrate(db)).rejects.toThrow(/old boat list/);
    expect(await columns(db, "boats")).toEqual(["boat_class_id", "id", "sail_number"]);
    expect(await columns(db, "boat_classes")).toEqual(["id", "name", "sailors_per_boat"]);
    expect(await columns(db, "plan_resources")).toEqual(["id", "name", "quantity"]);
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
