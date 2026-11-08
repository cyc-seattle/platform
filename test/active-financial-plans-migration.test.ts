import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0004-active-financial-plans.cjs";

// The migration from the log of active marks to an active status, in a real Postgres (PGlite): two
// organizations' years, one marked twice, and a year with no mark, each guarded by a trigger that
// refuses changes, like the saved-versions hook's.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, OTHER] = [id(90), id(91)];
const [FIRST, SECOND, ELSEWHERE, UNMARKED, DRAFT] = [id(1), id(2), id(3), id(4), id(5)];

const BEFORE = [
  `CREATE TABLE version_sets (id uuid PRIMARY KEY, organization_id uuid, fiscal_year integer, status varchar(255))`,
  `CREATE TABLE version_set_activations (id uuid PRIMARY KEY, version_set_id uuid REFERENCES version_sets (id),
    activated_at timestamptz, activated_by uuid, sequence integer)`,
  `CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$`,
  ...["version_sets", "version_set_activations"].map(
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
    INSERT INTO version_sets VALUES
      ('${FIRST}', '${ORG}', 2027, 'saved'), ('${SECOND}', '${ORG}', 2027, 'saved'),
      ('${ELSEWHERE}', '${OTHER}', 2027, 'saved'), ('${UNMARKED}', '${ORG}', 2028, 'saved'),
      ('${DRAFT}', '${ORG}', 2028, 'draft');
    INSERT INTO version_set_activations VALUES
      ('${id(10)}', '${FIRST}', now(), NULL, 1), ('${id(11)}', '${SECOND}', now(), NULL, 2),
      ('${id(12)}', '${FIRST}', now(), NULL, 3), ('${id(13)}', '${ELSEWHERE}', now(), NULL, 1);
    INSERT INTO directus_collections VALUES ('version_sets'), ('version_set_activations');
    INSERT INTO directus_fields (collection, field) VALUES
      ('version_sets', 'status'), ('version_set_activations', 'id'), ('version_set_activations', 'version_set_id');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('version_set_activations', 'version_set_id', 'version_sets');
  `);
  return db;
}

const statuses = async (db: PGlite) =>
  Object.fromEntries(
    (await db.query<{ id: string; status: string }>("SELECT id, status FROM version_sets")).rows.map((row) => [
      row.id,
      row.status,
    ]),
  );

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the active Financial Plans migration", { timeout: 30_000 }, () => {
  it("marks active the Financial Plan in each year's newest mark", async () => {
    const db = await database();
    await up(knex(db));
    expect(await statuses(db)).toEqual({
      [FIRST]: "active",
      [SECOND]: "saved",
      [ELSEWHERE]: "active",
      [UNMARKED]: "saved",
      [DRAFT]: "draft",
    });
  });

  it("drops the log, with Directus's records of it, and nothing else", async () => {
    const db = await database();
    await up(knex(db));
    expect((await db.query("SELECT to_regclass('version_set_activations') AS log")).rows).toEqual([{ log: null }]);
    expect((await db.query("SELECT collection FROM directus_collections")).rows).toEqual([
      { collection: "version_sets" },
    ]);
    expect((await db.query("SELECT collection, field FROM directus_fields")).rows).toEqual([
      { collection: "version_sets", field: "status" },
    ]);
    expect((await db.query("SELECT 1 FROM directus_relations")).rows).toEqual([]);
  });

  it("does nothing when run again, or on a new database", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect((await statuses(db))[FIRST]).toBe("active");
    await up(knex(await PGlite.create()));
  });
});
