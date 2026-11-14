import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0013-asset-list.cjs";
import { seedPowerboats } from "../stacks/backend/saved-versions.cjs";

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

/**
 * A draft and a saved Financial Plan, each with an Operations Plan copy whose rates name the coach
 * boat kind, an owned RIB fleet and a rented RIB, and a block given both.
 */
async function withCoachBoats() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE version_sets (id text PRIMARY KEY, status text);
    CREATE TABLE version_set_members (id serial PRIMARY KEY, version_set_id text, version_id text);
    CREATE TABLE plan_rates (version_id text, rib_resource_kind_id text);
    CREATE TABLE plan_resources (
      version_id text, key text, resource_kind_id text, cost_per_hour_cents integer, fuel_per_hour_cents integer,
      maintenance_per_hour_cents integer, excluded_from_mtdc boolean
    );
    CREATE TABLE plan_activity_blocks (id text PRIMARY KEY, version_id text);
    CREATE TABLE plan_block_resources (version_id text, block_id text, resource_key text, quantity integer);
  `);
  for (const set of ["draft", "saved"]) {
    await db.exec(`
      INSERT INTO version_sets VALUES ('${set}', '${set}');
      INSERT INTO version_set_members (version_set_id, version_id) VALUES ('${set}', '${set}-ops'), ('${set}', '${set}-area');
      INSERT INTO plan_rates VALUES ('${set}-ops', 'kind-rib');
      INSERT INTO plan_resources VALUES
        ('${set}-ops', 'fleet', 'kind-rib', 0, 1500, 800, false),
        ('${set}-ops', 'rented', 'kind-rib', 4500, 1500, null, true);
      INSERT INTO plan_activity_blocks VALUES ('${set}-block', '${set}-area');
      INSERT INTO plan_block_resources VALUES
        ('${set}-area', '${set}-block', 'fleet', 3), ('${set}-area', '${set}-block', 'rented', 1);
    `);
  }
  return db;
}

describe("moving drafts' coach boats into their blocks' powerboats", { timeout: 30_000 }, () => {
  const connect = (db: Pick<PGlite, "query" | "exec">) => ({
    query: async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows,
    exec: (sql: string) => db.exec(sql),
  });

  it("waits for the schema apply, then moves only a draft's owned coach boats, and drops the list", async () => {
    const db = await withCoachBoats();
    await migrate(db);
    expect(await columns(db, "plan_rates")).toEqual(["version_id"]);
    expect(await seedPowerboats(connect(db))).toEqual([]);

    await db.exec(`
      ALTER TABLE plan_activity_blocks ADD COLUMN powerboats integer;
      ALTER TABLE plan_rates ADD COLUMN powerboat_per_hour_cents integer;
    `);
    expect(await db.transaction((tx) => seedPowerboats(connect(tx)))).toEqual(["draft"]);
    const { rows: blocks } = await db.query("SELECT id, powerboats FROM plan_activity_blocks ORDER BY id");
    expect(blocks).toEqual([
      { id: "draft-block", powerboats: 3 },
      { id: "saved-block", powerboats: null },
    ]);
    const { rows: uses } = await db.query("SELECT version_id, resource_key FROM plan_block_resources ORDER BY 1, 2");
    expect(uses).toEqual([
      { version_id: "draft-area", resource_key: "rented" },
      { version_id: "saved-area", resource_key: "fleet" },
      { version_id: "saved-area", resource_key: "rented" },
    ]);
    const { rows: rates } = await db.query("SELECT version_id, powerboat_per_hour_cents FROM plan_rates ORDER BY 1");
    expect(rates).toEqual([
      { version_id: "draft-ops", powerboat_per_hour_cents: 2300 },
      { version_id: "saved-ops", powerboat_per_hour_cents: null },
    ]);
    const { rows: resources } = await db.query("SELECT version_id, key FROM plan_resources ORDER BY 1, 2");
    expect(resources).toEqual([
      { version_id: "draft-ops", key: "rented" },
      { version_id: "saved-ops", key: "fleet" },
      { version_id: "saved-ops", key: "rented" },
    ]);
    expect(await seedPowerboats(connect(db))).toEqual([]);
  });
});
