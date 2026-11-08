import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0002-financial-plans.cjs";
import { up as repair } from "../stacks/backend/migrations/cyc0003-financial-plans-repair.cjs";

// The Financial Plans migration, in a real Postgres (PGlite), on the planning tables as they were
// with club plans: a saved club plan, a saved version's own results, a version that names its
// Operations Plan version, and plan activations, each guarded by a trigger that refuses changes.

const BEFORE = [
  "CREATE TABLE plans (id uuid PRIMARY KEY)",
  `CREATE TABLE plan_versions (id uuid PRIMARY KEY, plan_id uuid REFERENCES plans (id), status varchar(255),
    operations_version_id uuid REFERENCES plan_versions (id))`,
  `CREATE TABLE version_sets (id uuid PRIMARY KEY, name varchar(255), saved_at timestamptz, organization_id uuid,
    fiscal_year integer)`,
  `CREATE TABLE version_set_members (id uuid PRIMARY KEY, version_set_id uuid REFERENCES version_sets (id),
    plan_id uuid REFERENCES plans (id), version_id uuid REFERENCES plan_versions (id))`,
  "CREATE TABLE plan_activations (id uuid PRIMARY KEY, plan_id uuid REFERENCES plans (id), version_id uuid REFERENCES plan_versions (id))",
  `CREATE TABLE plan_result_versions (id uuid PRIMARY KEY, version_id uuid REFERENCES plan_versions (id),
    calculated_with_id uuid REFERENCES plan_versions (id))`,
  ...["plan_results", "plan_result_lines", "plan_result_pnl", "plan_result_positions", "plan_result_warnings"].map(
    (table) =>
      `CREATE TABLE ${table} (id uuid PRIMARY KEY, version_id uuid REFERENCES plan_versions (id), version_set_id uuid REFERENCES version_sets (id))`,
  ),
];

// Triggers like the saved-versions hook's, which refuse every change.
const TRIGGERS = [
  `CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$`,
  ...["version_sets", "plan_versions", "plan_activations", "plan_results", "plan_result_lines"].map(
    (table) =>
      `CREATE TRIGGER cyc_saved_versions BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION refuse()`,
  ),
  `CREATE TRIGGER cyc_saved_versions_members AFTER INSERT ON version_sets FOR EACH ROW EXECUTE FUNCTION refuse()`,
];

const DIRECTUS = [
  "CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY)",
  "CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64))",
  "CREATE TABLE directus_relations (id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64))",
];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PLAN, OPERATIONS, AREA, SET, ORG] = [id(1), id(2), id(3), id(4), id(99)];

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  for (const statement of [...DIRECTUS, ...BEFORE]) await db.exec(statement);
  await db.exec(`
    INSERT INTO plans VALUES ('${PLAN}');
    INSERT INTO plan_versions VALUES ('${OPERATIONS}', '${PLAN}', 'saved', NULL);
    INSERT INTO plan_versions VALUES ('${AREA}', '${PLAN}', 'saved', '${OPERATIONS}');
    INSERT INTO version_sets VALUES ('${SET}', '2026 financial model', now(), '${ORG}', 2026);
    INSERT INTO version_set_members VALUES ('${id(20)}', '${SET}', '${PLAN}', '${OPERATIONS}');
    INSERT INTO version_set_members VALUES ('${id(21)}', '${SET}', '${PLAN}', '${AREA}');
    INSERT INTO plan_activations VALUES ('${id(5)}', '${PLAN}', '${AREA}');
    INSERT INTO plan_result_versions VALUES ('${id(6)}', '${AREA}', '${OPERATIONS}');
    INSERT INTO plan_results VALUES ('${id(7)}', '${AREA}', NULL), ('${id(8)}', NULL, '${SET}');
    INSERT INTO plan_result_lines VALUES ('${id(9)}', '${AREA}', NULL), ('${id(10)}', NULL, '${SET}');
  `);
  for (const statement of TRIGGERS) await db.exec(statement);
  for (const collection of ["plan_activations", "plan_result_versions", "plan_versions", "version_sets"]) {
    await db.query("INSERT INTO directus_collections VALUES ($1)", [collection]);
  }
  for (const [collection, field] of [
    ["plan_activations", "id"],
    ["plan_result_versions", "id"],
    ["plan_versions", "operations_version_id"],
    ["plan_versions", "results"],
    ["plan_versions", "status"],
    ["plan_results", "version_id"],
    ["plan_results", "version_set_id"],
    ["plan_result_lines", "version_id"],
  ]) {
    await db.query("INSERT INTO directus_fields (collection, field) VALUES ($1, $2)", [collection, field]);
  }
  for (const [many, field, one] of [
    ["plan_activations", "version_id", "plan_versions"],
    ["plan_result_versions", "version_id", "plan_versions"],
    ["plan_versions", "operations_version_id", "plan_versions"],
    ["plan_results", "version_id", "plan_versions"],
    ["plan_results", "version_set_id", "version_sets"],
  ]) {
    await db.query("INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES ($1, $2, $3)", [
      many,
      field,
      one,
    ]);
  }
  return db;
}

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function columns(db: PGlite, table: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY 1",
    [table],
  );
  return rows.map((row) => row.column_name);
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the Financial Plans migration", { timeout: 30_000 }, () => {
  it("lists each club plan for the hook to mark saved, keeping its results", async () => {
    const db = await database();
    await migrate(db);
    expect((await db.query("SELECT version_set_id FROM cyc_seed_saved_sets")).rows).toEqual([{ version_set_id: SET }]);
    expect((await db.query("SELECT id FROM plan_results ORDER BY id")).rows).toEqual([{ id: id(8) }]);
    expect((await db.query("SELECT id FROM plan_result_lines ORDER BY id")).rows).toEqual([{ id: id(10) }]);
  });

  it("drops a saved version's own results, its Operations Plan version, and plan activations", async () => {
    const db = await database();
    await migrate(db);
    expect(await columns(db, "plan_results")).toEqual(["id", "version_set_id"]);
    expect(await columns(db, "plan_versions")).toEqual(["id", "plan_id", "status"]);
    const { rows } = await db.query(
      "SELECT tablename FROM pg_tables WHERE tablename IN ('plan_activations', 'plan_result_versions')",
    );
    expect(rows).toEqual([]);
    // The saved versions themselves stay as they were.
    expect((await db.query("SELECT id, status FROM plan_versions ORDER BY id")).rows).toEqual([
      { id: OPERATIONS, status: "saved" },
      { id: AREA, status: "saved" },
    ]);
  });

  it("drops Directus's records of what it drops, and nothing else", async () => {
    const db = await database();
    await migrate(db);
    expect((await db.query("SELECT collection FROM directus_collections ORDER BY 1")).rows).toEqual([
      { collection: "plan_versions" },
      { collection: "version_sets" },
    ]);
    expect((await db.query("SELECT collection, field FROM directus_fields ORDER BY 1, 2")).rows).toEqual([
      { collection: "plan_results", field: "version_set_id" },
      { collection: "plan_versions", field: "status" },
    ]);
    expect((await db.query("SELECT many_collection, many_field FROM directus_relations")).rows).toEqual([
      { many_collection: "plan_results", many_field: "version_set_id" },
    ]);
  });

  it("lists a year's only saved Financial Plan, for the hook to mark active", async () => {
    const db = await database();
    await migrate(db);
    expect((await db.query("SELECT version_set_id FROM cyc_seed_active_sets")).rows).toEqual([{ version_set_id: SET }]);
  });

  it("marks none active for a year with more than one saved", async () => {
    const db = await database();
    await db.exec("DROP TRIGGER cyc_saved_versions_members ON version_sets");
    await db.exec(`INSERT INTO version_sets VALUES ('${id(30)}', 'Another', now(), '${ORG}', 2026)`);
    await migrate(db);
    expect((await db.query("SELECT version_set_id FROM cyc_seed_active_sets")).rows).toEqual([]);
  });

  it("keeps the newest of club plans that share a version, and deletes the older ones with their results", async () => {
    const db = await database();
    const older = id(40);
    await db.exec("DROP TRIGGER cyc_saved_versions_members ON version_sets");
    await db.exec(`
      INSERT INTO version_sets VALUES ('${older}', 'Older', now() - interval '1 day', '${ORG}', 2025);
      INSERT INTO version_set_members VALUES ('${id(41)}', '${older}', '${PLAN}', '${AREA}');
      INSERT INTO plan_result_lines VALUES ('${id(42)}', NULL, '${older}');
    `);
    await migrate(db);
    expect((await db.query("SELECT id FROM version_sets ORDER BY id")).rows).toEqual([{ id: SET }]);
    expect((await db.query("SELECT version_id FROM version_set_members ORDER BY version_id")).rows).toEqual([
      { version_id: OPERATIONS },
      { version_id: AREA },
    ]);
    expect((await db.query(`SELECT id FROM plan_result_lines WHERE id = '${id(42)}'`)).rows).toEqual([]);
  });

  it("takes the old triggers off, for the hook to put its own on", async () => {
    const db = await database();
    await migrate(db);
    const { rows } = await db.query("SELECT tgname FROM pg_trigger WHERE tgname LIKE 'cyc_saved_versions%'");
    expect(rows).toEqual([]);
  });

  it("adds no column, since the schema apply adds every one and refuses one it didn't make", async () => {
    const db = await database();
    const all = async () =>
      (
        await db.query<{ c: string }>(
          "SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()",
        )
      ).rows.map((r) => r.c);
    const before = new Set(await all());
    await migrate(db);
    await repair({ raw: (sql: string) => db.exec(sql) });
    expect((await all()).filter((c) => !before.has(c) && !c.startsWith("cyc_seed_"))).toEqual([]);
  });

  it("does nothing more when run again, as the repair runs it", async () => {
    const db = await database();
    await migrate(db);
    const seeded = (await db.query("SELECT version_set_id FROM cyc_seed_saved_sets")).rows;
    await repair({ raw: (sql: string) => db.exec(sql) });
    expect((await db.query("SELECT version_set_id FROM cyc_seed_saved_sets")).rows).toEqual(seeded);
    expect((await db.query("SELECT id FROM version_sets")).rows).toEqual([{ id: SET }]);
  });

  it("repairs a database where an earlier version added version_sets.status itself", async () => {
    const db = await database();
    // As dev was left: status added with no record of it in directus_fields, and plan_activations put back by a deploy
    // of the code before Financial Plans.
    await db.exec("DROP TRIGGER cyc_saved_versions_members ON version_sets");
    await db.exec("DROP TRIGGER cyc_saved_versions ON version_sets");
    await db.exec("ALTER TABLE version_sets ADD COLUMN status varchar(255) NOT NULL DEFAULT 'draft'");
    await db.exec(`UPDATE version_sets SET status = 'saved'`);
    await db.exec(`INSERT INTO version_sets VALUES ('${id(50)}', 'A draft', now(), '${ORG}', 2027, 'draft')`);
    await repair({ raw: (sql: string) => db.exec(sql) });
    expect(await columns(db, "version_sets")).not.toContain("status");
    expect((await db.query("SELECT version_set_id FROM cyc_seed_saved_sets ORDER BY 1")).rows).toEqual(
      [{ version_set_id: SET }, { version_set_id: id(50) }].sort((a, b) =>
        a.version_set_id.localeCompare(b.version_set_id),
      ),
    );
    const { rows } = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'plan_activations'");
    expect(rows).toEqual([]);
  });

  it("leaves a status column the schema apply made alone", async () => {
    const db = await database();
    await migrate(db);
    await db.exec("ALTER TABLE version_sets ADD COLUMN status varchar(255) NOT NULL DEFAULT 'draft'");
    await db.query("INSERT INTO directus_fields (collection, field) VALUES ('version_sets', 'status')");
    await repair({ raw: (sql: string) => db.exec(sql) });
    expect(await columns(db, "version_sets")).toContain("status");
  });

  it("does nothing on a new database", async () => {
    const db = await PGlite.create();
    await migrate(db);
    for (const statement of DIRECTUS) await db.exec(statement);
    await migrate(db);
    expect(
      (await db.query("SELECT 1 FROM pg_tables WHERE tablename NOT LIKE 'directus_%' AND schemaname = 'public'")).rows,
    ).toEqual([]);
  });
});
