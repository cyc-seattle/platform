import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0005-planning-blocks.cjs";

// The move to blocks, in a real Postgres (PGlite): the three collections that worked out staffing,
// with an old plan's rows in them guarded by a trigger that refuses changes, like the saved-versions
// hook's, beside an offering that stays.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DROPPED = ["plan_activity_block_rules", "plan_offering_boat_classes", "plan_activity_resources"];

const BEFORE = [
  "CREATE TABLE plan_offerings (id uuid PRIMARY KEY)",
  "CREATE TABLE plan_activities (id uuid PRIMARY KEY, offering_id uuid REFERENCES plan_offerings (id))",
  "CREATE TABLE plan_activity_block_rules (id uuid PRIMARY KEY, name varchar(255))",
  "CREATE TABLE plan_offering_boat_classes (id uuid PRIMARY KEY, offering_id uuid REFERENCES plan_offerings (id))",
  "CREATE TABLE plan_activity_resources (id uuid PRIMARY KEY, activity_id uuid REFERENCES plan_activities (id))",
  `CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$`,
  ...["plan_offerings", "plan_activities", ...DROPPED].map(
    (table) =>
      `CREATE TRIGGER cyc_saved_versions BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION refuse()`,
  ),
  "CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY)",
  "CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64))",
  "CREATE TABLE directus_relations (id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64))",
];

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  for (const statement of BEFORE) await db.exec(statement);
  await db.exec(`
    INSERT INTO plan_offerings VALUES ('${id(1)}');
    INSERT INTO plan_activities VALUES ('${id(2)}', '${id(1)}');
    INSERT INTO plan_activity_block_rules VALUES ('${id(3)}', 'Wednesdays');
    INSERT INTO plan_offering_boat_classes VALUES ('${id(4)}', '${id(1)}');
    INSERT INTO plan_activity_resources VALUES ('${id(5)}', '${id(2)}');
    INSERT INTO directus_collections VALUES ('plan_offerings'), ${DROPPED.map((c) => `('${c}')`).join(", ")};
    INSERT INTO directus_fields (collection, field) VALUES
      ('plan_offerings', 'id'), ('plan_activity_resources', 'activity_id'), ('plan_offering_boat_classes', 'offering_id');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('plan_activity_resources', 'activity_id', 'plan_activities'),
      ('plan_offering_boat_classes', 'offering_id', 'plan_offerings'),
      ('plan_activities', 'offering_id', 'plan_offerings');
  `);
  return db;
}

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });
const exists = async (db: PGlite, table: string) =>
  (await db.query<{ t: string | null }>(`SELECT to_regclass('${table}')::text AS t`)).rows[0]!.t !== null;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the planning blocks migration", { timeout: 30_000 }, () => {
  it("drops the three collections, old plans' rows and all", async () => {
    const db = await database();
    await up(knex(db));
    for (const table of DROPPED) expect(await exists(db, table), table).toBe(false);
  });

  it("drops Directus's records of them, and nothing else", async () => {
    const db = await database();
    await up(knex(db));
    expect((await db.query("SELECT collection FROM directus_collections")).rows).toEqual([
      { collection: "plan_offerings" },
    ]);
    expect((await db.query("SELECT collection, field FROM directus_fields")).rows).toEqual([
      { collection: "plan_offerings", field: "id" },
    ]);
    expect((await db.query("SELECT many_collection FROM directus_relations")).rows).toEqual([
      { many_collection: "plan_activities" },
    ]);
    expect((await db.query("SELECT count(*)::int AS n FROM plan_activities")).rows).toEqual([{ n: 1 }]);
  });

  it("does nothing when run again, or on a new database", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    await up(knex(await PGlite.create()));
    expect(await exists(db, "plan_offerings")).toBe(true);
  });
});
