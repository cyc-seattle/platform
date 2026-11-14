import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0013-asset-list.cjs";
import { seedCoachBoats, seedPowerboatAccounts } from "../stacks/backend/saved-versions.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const connect = (db: Pick<PGlite, "query" | "exec">) => ({
  query: async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows,
  exec: (sql: string) => db.exec(sql),
});

async function columns(db: PGlite, table: string) {
  const { rows } = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name",
    [table],
  );
  return rows.map(({ column_name }) => column_name);
}

async function rows(db: PGlite, sql: string) {
  return (await db.query(sql)).rows;
}

/**
 * Prod as it was before the asset list: the old boat list, empty, the plan's quantities and
 * equipment, and a draft and a saved Financial Plan, each with an Operations Plan copy whose rates
 * name the coach boat kind, an owned RIB fleet and a rented RIB, and a block given both.
 */
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
    CREATE TABLE organizations (id text PRIMARY KEY, kind text);
    CREATE TABLE organization_cost_accounts (organization_id text, cost_type text, account_id text);
    CREATE TABLE boat_classes (id uuid PRIMARY KEY, name text, sailors_per_boat integer NOT NULL);
    CREATE TABLE boats (id uuid PRIMARY KEY, boat_class_id uuid REFERENCES boat_classes (id), sail_number text);
    CREATE TABLE version_sets (id text PRIMARY KEY, status text);
    CREATE TABLE version_set_members (id serial PRIMARY KEY, version_set_id text, version_id text);
    CREATE TABLE resource_kinds (id text PRIMARY KEY);
    CREATE TABLE plan_rates (version_id text, rib_resource_kind_id text REFERENCES resource_kinds (id));
    CREATE TABLE plan_boat_rates (
      id uuid PRIMARY KEY, version_id text, key uuid, boat_class_id uuid, maintenance_per_boat_hour_cents integer,
      quantity integer
    );
    CREATE TABLE plan_resources (
      version_id text, key text, resource_kind_id text REFERENCES resource_kinds (id), cost_per_hour_cents integer,
      cost_per_day_cents integer, fuel_per_hour_cents integer, maintenance_per_hour_cents integer,
      excluded_from_mtdc boolean
    );
    CREATE TABLE plan_activity_blocks (id text PRIMARY KEY, version_id text);
    CREATE TABLE plan_block_resources (version_id text, block_id text, resource_key text, quantity integer);
    CREATE TABLE plan_block_boats (
      id uuid PRIMARY KEY, version_id text, key uuid, block_id text, boat_class_id uuid, count integer
    );
    INSERT INTO organizations VALUES ('csc', 'own');
    INSERT INTO organization_cost_accounts VALUES ('csc', 'ribs', 'acct-coach-boats');
    INSERT INTO boat_classes VALUES ('00000000-0000-0000-0000-000000000001', 'FJ', 2);
    INSERT INTO resource_kinds VALUES ('kind-rib'), ('kind-van');
    INSERT INTO directus_collections VALUES
      ('boat_classes'), ('boats'), ('plan_boat_rates'), ('plan_resources'), ('plan_block_resources'), ('resource_kinds');
    INSERT INTO directus_fields (collection, field) VALUES
      ('boat_classes', 'sailors_per_boat'), ('boats', 'boat_class_id'), ('boats', 'sail_number'),
      ('plan_boat_rates', 'quantity'), ('plan_boat_rates', 'maintenance_per_boat_hour_cents'),
      ('plan_rates', 'rib_resource_kind_id'), ('plan_resources', 'name'), ('resource_kinds', 'name');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('boats', 'boat_class_id', 'boat_classes'), ('plan_rates', 'rib_resource_kind_id', 'resource_kinds'),
      ('plan_resources', 'resource_kind_id', 'resource_kinds');
    INSERT INTO directus_permissions (collection) VALUES ('boats'), ('boat_classes'), ('plan_resources');
    INSERT INTO directus_presets (collection) VALUES ('boats'), ('resource_kinds');
  `);
  for (const set of ["draft", "saved"]) {
    await db.exec(`
      INSERT INTO version_sets VALUES ('${set}', '${set}');
      INSERT INTO version_set_members (version_set_id, version_id) VALUES ('${set}', '${set}-ops'), ('${set}', '${set}-area');
      INSERT INTO plan_rates VALUES ('${set}-ops', 'kind-rib');
      INSERT INTO plan_resources VALUES
        ('${set}-ops', 'fleet', 'kind-rib', 0, 1000, 1500, 800, false),
        ('${set}-ops', 'rented', 'kind-rib', 4500, 30000, 1500, null, true),
        ('${set}-ops', 'van', 'kind-van', 2000, null, null, null, false);
      INSERT INTO plan_activity_blocks VALUES ('${set}-block', '${set}-area');
      INSERT INTO plan_block_resources VALUES
        ('${set}-area', '${set}-block', 'fleet', 3), ('${set}-area', '${set}-block', 'rented', 1),
        ('${set}-area', '${set}-block', 'van', 1);
    `);
  }
  return db;
}

/** What the schema apply adds after the migration, which the seeds wait for. */
const applied = `
  ALTER TABLE boat_classes ADD COLUMN account_id text;
  ALTER TABLE plan_boat_rates ADD COLUMN fuel_per_hour_cents integer, ADD COLUMN charter_per_day_cents integer;
  ALTER TABLE plan_block_boats ADD COLUMN chartered integer;
`;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the asset list migration", { timeout: 30_000 }, () => {
  it("drops the old boat list, the plan's quantities and equipment, and renames max capacity", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    expect(await columns(db, "boats")).toEqual([]);
    expect(await columns(db, "plan_resources")).toEqual([]);
    expect(await columns(db, "plan_block_resources")).toEqual([]);
    expect(await columns(db, "resource_kinds")).toEqual([]);
    expect(await columns(db, "plan_rates")).toEqual(["version_id"]);
    expect(await columns(db, "plan_boat_rates")).not.toContain("quantity");
    expect(await rows(db, "SELECT name, max_capacity FROM boat_classes ORDER BY name")).toEqual([
      { name: "FJ", max_capacity: 2 },
      { name: "RIB", max_capacity: 0 },
      { name: "Support", max_capacity: 0 },
    ]);
    expect(await rows(db, "SELECT collection, field FROM directus_fields ORDER BY 1, 2")).toEqual([
      { collection: "boat_classes", field: "max_capacity" },
      { collection: "plan_boat_rates", field: "maintenance_per_boat_hour_cents" },
    ]);
    expect(await rows(db, "SELECT collection FROM directus_collections ORDER BY 1")).toEqual([
      { collection: "boat_classes" },
      { collection: "plan_boat_rates" },
    ]);
    expect(await rows(db, "SELECT many_field FROM directus_relations")).toEqual([]);
    // The new boats reuse the old ones' permissions and default view, which the backend stack rewrites.
    expect(await rows(db, "SELECT collection FROM directus_permissions ORDER BY 1")).toEqual([
      { collection: "boat_classes" },
      { collection: "boats" },
    ]);
    expect(await rows(db, "SELECT collection FROM directus_presets")).toEqual([{ collection: "boats" }]);
  });

  it("refuses to drop an old boat list that has rows, and changes nothing", async () => {
    const db = await before();
    await db.exec("INSERT INTO boats VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '123')");
    await expect(migrate(db)).rejects.toThrow(/old boat list/);
    expect(await columns(db, "boats")).toEqual(["boat_class_id", "id", "sail_number"]);
    expect(await columns(db, "boat_classes")).toEqual(["id", "name", "sailors_per_boat"]);
    expect(await columns(db, "plan_resources")).not.toEqual([]);
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});

describe("the asset list's seeds", { timeout: 30_000 }, () => {
  it("wait for the schema apply, then book the powerboat classes to the coach boats account", async () => {
    const db = await before();
    await migrate(db);
    expect(await seedPowerboatAccounts(connect(db))).toEqual([]);
    await db.exec(applied);
    await db.exec("UPDATE boat_classes SET account_id = 'acct-other' WHERE name = 'Support'");
    expect(await seedPowerboatAccounts(connect(db))).toEqual(["draft"]);
    expect(await rows(db, "SELECT name, account_id FROM boat_classes ORDER BY name")).toEqual([
      { name: "FJ", account_id: null },
      { name: "RIB", account_id: "acct-coach-boats" },
      { name: "Support", account_id: "acct-other" },
    ]);
    expect(await seedPowerboatAccounts(connect(db))).toEqual([]);
  });

  it("move only a draft's coach boats into RIB rates and block boats, owned and chartered", async () => {
    const db = await before();
    await migrate(db);
    expect(await seedCoachBoats(connect(db))).toEqual([]);
    await db.exec(applied);
    expect(await db.transaction((tx) => seedCoachBoats(connect(tx)))).toEqual(["draft"]);
    const [rib] = await rows(db, "SELECT id FROM boat_classes WHERE name = 'RIB'");
    expect(
      await rows(
        db,
        `SELECT version_id, boat_class_id, maintenance_per_boat_hour_cents, fuel_per_hour_cents, charter_per_day_cents
          FROM plan_boat_rates`,
      ),
    ).toEqual([
      {
        version_id: "draft-ops",
        boat_class_id: (rib as { id: string }).id,
        maintenance_per_boat_hour_cents: 800,
        fuel_per_hour_cents: 1500,
        charter_per_day_cents: 30000,
      },
    ]);
    expect(await rows(db, "SELECT version_id, block_id, count, chartered FROM plan_block_boats")).toEqual([
      { version_id: "draft-area", block_id: "draft-block", count: 3, chartered: 1 },
    ]);
    expect(await seedCoachBoats(connect(db))).toEqual([]);
  });
});
