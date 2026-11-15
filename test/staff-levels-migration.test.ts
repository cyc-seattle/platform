import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0018-staff-levels.cjs";

// Staff levels as records of their own (cyc-seattle/platform#295), in a real Postgres (PGlite), with
// a trigger like the frozen-plans hook's that refuses every write.

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [FROZEN, DRAFT] = [id(1), id(2)];
const [FROZEN_OPS, FROZEN_AREA, DRAFT_OPS, DRAFT_AREA] = [id(10), id(11), id(12), id(13)];
const [HEAD, SUMMER, MIN_WAGE, VOLUNTEER, ODD, DRAFT_HEAD_KEY] = [id(20), id(21), id(22), id(23), id(24), id(25)];
const key = (n: number) => id(100 + n);

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE directus_relations (id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64));
    CREATE TABLE plans (id uuid PRIMARY KEY, financial_plan_id uuid NOT NULL, kind varchar(255) NOT NULL);
    CREATE TABLE plan_staff_levels (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL,
      name varchar(255) NOT NULL, pay_type varchar(255) NOT NULL, hourly_rate_cents integer);
    CREATE TABLE plan_programs (id uuid PRIMARY KEY, plan_id uuid NOT NULL, staff_level_key uuid);
    CREATE TABLE plan_block_staff (id uuid PRIMARY KEY, plan_id uuid NOT NULL, staff_level_key uuid);
    CREATE TABLE plan_labor_lines (id uuid PRIMARY KEY, plan_id uuid NOT NULL, staff_level_key uuid NOT NULL);
    INSERT INTO plans VALUES ('${FROZEN_OPS}', '${FROZEN}', 'operations'), ('${FROZEN_AREA}', '${FROZEN}', 'program_area'),
      ('${DRAFT_OPS}', '${DRAFT}', 'operations'), ('${DRAFT_AREA}', '${DRAFT}', 'program_area');
    -- The frozen plan's levels, and the draft's copy of them, each keeping its key.
    INSERT INTO plan_staff_levels VALUES
      ('${HEAD}', '${FROZEN_OPS}', '${key(1)}', '4 - head instructor', 'hourly', 3000),
      ('${SUMMER}', '${FROZEN_OPS}', '${key(2)}', 'Summer head instructor (level 4 + 10%)', 'hourly', 3300),
      ('${MIN_WAGE}', '${FROZEN_OPS}', '${key(3)}', '  1 -  Min Wage ', 'hourly', 2000),
      ('${VOLUNTEER}', '${FROZEN_OPS}', '${key(4)}', 'Volunteer', 'volunteer', 1500),
      ('${ODD}', '${FROZEN_OPS}', '${key(5)}', 'Rigger', 'hourly', NULL),
      ('${DRAFT_HEAD_KEY}', '${DRAFT_OPS}', '${key(2)}', 'Summer head instructor (level 4 + 10%)', 'hourly', 3300);
    INSERT INTO plan_programs VALUES ('${id(30)}', '${FROZEN_AREA}', '${key(3)}'), ('${id(31)}', '${DRAFT_AREA}', '${key(2)}'),
      ('${id(32)}', '${DRAFT_AREA}', NULL);
    INSERT INTO plan_block_staff VALUES ('${id(40)}', '${FROZEN_AREA}', '${key(2)}'), ('${id(41)}', '${FROZEN_AREA}', '${key(9)}');
    INSERT INTO plan_labor_lines VALUES ('${id(50)}', '${FROZEN_OPS}', '${key(5)}');
    INSERT INTO directus_fields (collection, field) VALUES ('plan_staff_levels', 'name'), ('plan_staff_levels', 'pay_type'),
      ('plan_staff_levels', 'hourly_rate_cents'), ('plan_programs', 'staff_level_key'), ('plan_block_staff', 'staff_level_key'),
      ('plan_labor_lines', 'staff_level_key');
    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'frozen'; END $$;
    CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON plan_staff_levels FOR EACH ROW EXECUTE FUNCTION refuse();
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the staff levels migration", { timeout: 30_000 }, () => {
  it("lists each level, mapping the plans' names onto them, with a name it doesn't know as its own", async () => {
    const db = await before();
    await migrate(db);
    const { rows } = await db.query(
      "SELECT name, role, grade, role_sort FROM cyc_seed_staff_levels ORDER BY role_sort, name",
    );
    expect(rows).toEqual([
      { name: "Head Instructor", role: "Instructor", grade: "head", role_sort: 1 },
      { name: "Instructor", role: "Instructor", grade: "standard", role_sort: 1 },
      { name: "Junior Instructor", role: "Instructor", grade: "junior", role_sort: 1 },
      { name: "Rigger", role: "Instructor", grade: "standard", role_sort: 1 },
      { name: "Senior Instructor", role: "Instructor", grade: "senior", role_sort: 1 },
      { name: "Coach", role: "Coach", grade: "standard", role_sort: 2 },
      { name: "Head Coach", role: "Coach", grade: "head", role_sort: 2 },
      { name: "Volunteer Coach", role: "Coach", grade: "volunteer", role_sort: 2 },
      { name: "Office Staff", role: "Office", grade: "standard", role_sort: 3 },
    ]);
  });

  it("keeps one of a plan's levels that map onto one, frozen plans' too, at the first one's rate", async () => {
    const db = await before();
    await migrate(db);
    const { rows: levels } = await db.query("SELECT id, hourly_rate_cents FROM plan_staff_levels ORDER BY id");
    expect(levels).toEqual([
      { id: HEAD, hourly_rate_cents: 3000 },
      { id: MIN_WAGE, hourly_rate_cents: 2000 },
      { id: VOLUNTEER, hourly_rate_cents: 0 },
      { id: ODD, hourly_rate_cents: 0 },
      // A plan with only the summer head instructor keeps it, as its Head Instructor.
      { id: DRAFT_HEAD_KEY, hourly_rate_cents: 3300 },
    ]);
    // The trigger is back on.
    await expect(db.exec("UPDATE plan_staff_levels SET hourly_rate_cents = 1")).rejects.toThrow(/frozen/);
  });

  it("names the level of each row that named one by key, in its own Financial Plan", async () => {
    const db = await before();
    await migrate(db);
    const { rows } = await db.query("SELECT collection, id, level FROM cyc_seed_staff_level_rows ORDER BY id");
    expect(rows).toEqual([
      { collection: "plan_staff_levels", id: HEAD, level: "Head Instructor" },
      { collection: "plan_staff_levels", id: MIN_WAGE, level: "Instructor" },
      { collection: "plan_staff_levels", id: VOLUNTEER, level: "Volunteer Coach" },
      { collection: "plan_staff_levels", id: ODD, level: "Rigger" },
      { collection: "plan_staff_levels", id: DRAFT_HEAD_KEY, level: "Head Instructor" },
      { collection: "plan_programs", id: id(30), level: "Instructor" },
      { collection: "plan_programs", id: id(31), level: "Head Instructor" },
      // The summer head instructor's staff are Head Instructors; a key with no level names none.
      { collection: "plan_block_staff", id: id(40), level: "Head Instructor" },
      { collection: "plan_labor_lines", id: id(50), level: "Rigger" },
    ]);
  });

  it("drops the old fields and Directus's records of them, once", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    const { rows: columns } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE column_name IN ('name', 'pay_type', 'staff_level_key') AND table_name LIKE 'plan_%'`,
    );
    expect(columns).toEqual([]);
    const { rows: fields } = await db.query("SELECT collection, field FROM directus_fields");
    expect(fields).toEqual([{ collection: "plan_staff_levels", field: "hourly_rate_cents" }]);
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
