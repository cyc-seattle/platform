import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// The by-hand delete of every plan, in a real Postgres (PGlite): a saved and a draft Financial Plan,
// with plan tables guarded by a trigger that refuses changes, like the saved-versions hook's, and
// the catalog they point at.

const SQL = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/delete-plans.sql"), "utf8");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLAN_TABLES = [
  "version_sets",
  "plans",
  "plan_versions",
  "version_set_members",
  "plan_offerings",
  "plan_results",
  "plan_result_lines",
];

const BEFORE = [
  "CREATE TABLE products (id uuid PRIMARY KEY)",
  "CREATE TABLE catalog_offerings (id uuid PRIMARY KEY, product_id uuid REFERENCES products (id))",
  "CREATE TABLE version_sets (id uuid PRIMARY KEY, status varchar(255))",
  "CREATE TABLE plans (id uuid PRIMARY KEY)",
  "CREATE TABLE plan_versions (id uuid PRIMARY KEY, plan_id uuid REFERENCES plans (id), status varchar(255))",
  `CREATE TABLE version_set_members (id uuid PRIMARY KEY, version_set_id uuid REFERENCES version_sets (id),
    version_id uuid REFERENCES plan_versions (id))`,
  `CREATE TABLE plan_offerings (id uuid PRIMARY KEY, version_id uuid REFERENCES plan_versions (id),
    product_id uuid REFERENCES products (id), catalog_offering_id uuid REFERENCES catalog_offerings (id))`,
  "CREATE TABLE plan_results (id uuid PRIMARY KEY, version_set_id uuid REFERENCES version_sets (id))",
  "CREATE TABLE plan_result_lines (id uuid PRIMARY KEY, results_id uuid REFERENCES plan_results (id))",
  `CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$`,
  ...PLAN_TABLES.map(
    (table) =>
      `CREATE TRIGGER cyc_saved_versions BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION refuse()`,
  ),
];

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  for (const statement of BEFORE) await db.exec(statement);
  await db.exec(`
    INSERT INTO products VALUES ('${id(1)}');
    INSERT INTO catalog_offerings VALUES ('${id(2)}', '${id(1)}');
    INSERT INTO version_sets VALUES ('${id(10)}', 'saved'), ('${id(11)}', 'draft');
    INSERT INTO plans VALUES ('${id(20)}');
    INSERT INTO plan_versions VALUES ('${id(30)}', '${id(20)}', 'saved'), ('${id(31)}', '${id(20)}', 'draft');
    INSERT INTO version_set_members VALUES ('${id(40)}', '${id(10)}', '${id(30)}'), ('${id(41)}', '${id(11)}', '${id(31)}');
    INSERT INTO plan_offerings VALUES ('${id(50)}', '${id(30)}', '${id(1)}', '${id(2)}'),
      ('${id(51)}', '${id(31)}', '${id(1)}', '${id(2)}');
    INSERT INTO plan_results VALUES ('${id(60)}', '${id(10)}');
    INSERT INTO plan_result_lines VALUES ('${id(70)}', '${id(60)}');
  `);
  return db;
}

async function counts(db: PGlite, tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of tables) {
    out[table] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  }
  return out;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("deleting every plan", { timeout: 30_000 }, () => {
  it("deletes every Financial Plan, plan, copy, row and result, saved ones included", async () => {
    const db = await database();
    await db.exec(SQL);
    expect(await counts(db, PLAN_TABLES)).toEqual(Object.fromEntries(PLAN_TABLES.map((t) => [t, 0])));
  });

  it("keeps the catalog, and the saved-versions triggers", async () => {
    const db = await database();
    await db.exec(SQL);
    expect(await counts(db, ["products", "catalog_offerings"])).toEqual({ products: 1, catalog_offerings: 1 });
    const triggers = await db.query("SELECT 1 FROM pg_trigger WHERE tgname = 'cyc_saved_versions'");
    expect(triggers.rows).toHaveLength(PLAN_TABLES.length);
  });

  it("deletes nothing if a table outside planning points at a plan", async () => {
    const db = await database();
    await db.exec(`CREATE TABLE elsewhere (id uuid PRIMARY KEY, offering_id uuid REFERENCES plan_offerings (id));
      INSERT INTO elsewhere VALUES ('${id(80)}', '${id(50)}')`);
    await expect(db.exec(SQL)).rejects.toThrow();
    expect((await counts(db, ["version_sets"]))["version_sets"]).toBe(2);
  });

  it("does nothing when run again, or on a new database", async () => {
    const db = await database();
    await db.exec(SQL);
    await db.exec(SQL);
    expect((await counts(db, ["version_sets"]))["version_sets"]).toBe(0);
    await (await PGlite.create()).exec(SQL);
  });
});
