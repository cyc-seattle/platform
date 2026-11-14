import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0014-in-mtdc.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

/** Two budget lines, one left out of MTDC, a charge, and a trigger like saved-versions' that refuses any change. */
async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE plan_budget_lines (id text PRIMARY KEY, excluded_from_mtdc boolean NOT NULL DEFAULT false);
    CREATE TABLE plan_revenue_charges (id text PRIMARY KEY, excluded_from_mtdc boolean NOT NULL DEFAULT false);
    INSERT INTO plan_budget_lines VALUES ('in', false), ('out', true);
    INSERT INTO plan_revenue_charges VALUES ('scholarships', true);
    INSERT INTO directus_fields (collection, field) VALUES
      ('plan_budget_lines', 'excluded_from_mtdc'), ('plan_revenue_charges', 'excluded_from_mtdc');
    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'saved'; END $$;
    CREATE TRIGGER saved BEFORE UPDATE ON plan_budget_lines FOR EACH ROW EXECUTE FUNCTION refuse();
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the in_mtdc migration", { timeout: 30_000 }, () => {
  it("renames excluded_from_mtdc to in_mtdc, flipping every value, saved rows' too, once", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    const { rows: lines } = await db.query("SELECT id, in_mtdc FROM plan_budget_lines ORDER BY id");
    expect(lines).toEqual([
      { id: "in", in_mtdc: true },
      { id: "out", in_mtdc: false },
    ]);
    const { rows: charges } = await db.query("SELECT in_mtdc FROM plan_revenue_charges");
    expect(charges).toEqual([{ in_mtdc: false }]);
    await db.exec("INSERT INTO plan_revenue_charges (id) VALUES ('card fees')");
    const { rows: added } = await db.query("SELECT in_mtdc FROM plan_revenue_charges WHERE id = 'card fees'");
    expect(added).toEqual([{ in_mtdc: true }]);
    const { rows: fields } = await db.query("SELECT field FROM directus_fields");
    expect(fields).toEqual([{ field: "in_mtdc" }, { field: "in_mtdc" }]);
    // The trigger is back on.
    await expect(db.exec("UPDATE plan_budget_lines SET in_mtdc = true")).rejects.toThrow(/saved/);
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
