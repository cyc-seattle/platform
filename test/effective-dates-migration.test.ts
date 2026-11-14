import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { SEED, up } from "../stacks/backend/migrations/cyc0015-effective-dates.cjs";

// The migration from an active status to a date each Financial Plan is active from, in a real
// Postgres (PGlite), with a trigger that refuses taking a plan out of active, like the
// saved-versions hook's.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [JULY_ORG, JANUARY_ORG, NO_MONTH_ORG] = [id(90), id(91), id(92)];
const [ACTIVE, SAVED, DRAFT, JANUARY, NO_MONTH, LISTED, LISTED_TAKEN] = [1, 2, 3, 4, 5, 6, 7].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY, fiscal_year_start_month integer);
    CREATE TABLE version_sets (id uuid PRIMARY KEY, organization_id uuid, fiscal_year integer, status varchar(255));
    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.status = 'active' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER cyc_saved_versions BEFORE UPDATE ON version_sets FOR EACH ROW EXECUTE FUNCTION refuse();
    INSERT INTO organizations VALUES ('${JULY_ORG}', 7), ('${JANUARY_ORG}', 1), ('${NO_MONTH_ORG}', NULL);
    INSERT INTO version_sets VALUES
      ('${ACTIVE}', '${JULY_ORG}', 2027, 'active'), ('${SAVED}', '${JULY_ORG}', 2027, 'saved'),
      ('${DRAFT}', '${JULY_ORG}', 2027, 'draft'), ('${JANUARY}', '${JANUARY_ORG}', 2027, 'active'),
      ('${NO_MONTH}', '${NO_MONTH_ORG}', 2027, 'active');
  `);
  return db;
}

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });

const statuses = async (db: PGlite) =>
  Object.fromEntries(
    (await db.query<{ id: string; status: string }>("SELECT id, status FROM version_sets")).rows.map((row) => [
      row.id,
      row.status,
    ]),
  );

const seeded = async (db: PGlite) =>
  Object.fromEntries(
    (
      await db.query<{ version_set_id: string; effective_from: string }>(
        `SELECT version_set_id, effective_from::text AS effective_from FROM ${SEED}`,
      )
    ).rows.map((row) => [row.version_set_id, row.effective_from]),
  );

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the effective dates migration", { timeout: 30_000 }, () => {
  it("saves each active Financial Plan, and lists it from the first day of its fiscal year", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect(await statuses(db)).toEqual({
      [ACTIVE]: "saved",
      [SAVED]: "saved",
      [DRAFT]: "draft",
      [JANUARY]: "saved",
      [NO_MONTH]: "saved",
    });
    expect(await seeded(db)).toEqual({
      [ACTIVE]: "2026-07-01",
      [JANUARY]: "2027-01-01",
      [NO_MONTH]: "2027-01-01",
    });
  });

  it("leaves the trigger on", async () => {
    const db = await database();
    await up(knex(db));
    const { rows } = await db.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'cyc_saved_versions'",
    );
    expect(rows).toEqual([{ tgenabled: "O" }]);
  });

  it("lists the plan the Financial Plans migration chose, in a year with no active plan", async () => {
    const db = await database();
    await db.exec(`
      INSERT INTO version_sets VALUES
        ('${LISTED}', '${JULY_ORG}', 2028, 'saved'), ('${LISTED_TAKEN}', '${JULY_ORG}', 2027, 'saved');
      CREATE TABLE cyc_seed_active_sets (version_set_id uuid PRIMARY KEY);
      INSERT INTO cyc_seed_active_sets VALUES ('${LISTED}'), ('${LISTED_TAKEN}');
    `);
    await up(knex(db));
    expect(await seeded(db)).toMatchObject({ [LISTED]: "2027-07-01" });
    expect(await seeded(db)).not.toHaveProperty(LISTED_TAKEN);
    expect((await db.query("SELECT to_regclass('cyc_seed_active_sets') AS seed")).rows).toEqual([{ seed: null }]);
  });

  it("leaves no list where no Financial Plan was active", async () => {
    const db = await database();
    await db.exec("ALTER TABLE version_sets DISABLE TRIGGER USER; UPDATE version_sets SET status = 'saved';");
    await up(knex(db));
    expect((await db.query(`SELECT to_regclass('${SEED}') AS seed`)).rows).toEqual([{ seed: null }]);
  });

  it("does nothing on a new database", async () => {
    await up(knex(await PGlite.create()));
  });
});
