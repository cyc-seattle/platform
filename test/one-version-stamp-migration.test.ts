import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0023-one-version-stamp.cjs";

// One engine version stamp, on the results (cyc-seattle/platform#305), in a real Postgres (PGlite),
// with a trigger like the frozen-plans hook's that refuses every write to the results.

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OLD, NEW, DRAFT] = [id(1), id(2), id(3)];

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE financial_plans (id uuid PRIMARY KEY, status varchar(255), platform_version varchar(255));
    CREATE TABLE plan_results (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL, platform_version varchar(255));
    INSERT INTO directus_fields (collection, field) VALUES
      ('financial_plans', 'status'), ('financial_plans', 'platform_version'), ('plan_results', 'platform_version');
    -- Frozen before the results had a stamp, frozen since, and a draft.
    INSERT INTO financial_plans VALUES ('${OLD}', 'frozen', '2.0.0+engine.aaa'), ('${NEW}', 'frozen', '2.3.0+engine.bbb'),
      ('${DRAFT}', 'draft', NULL);
    INSERT INTO plan_results (financial_plan_id, platform_version) VALUES
      ('${OLD}', NULL), ('${NEW}', '2.3.0+engine.bbb'), ('${DRAFT}', '3.0.0+engine.ccc');
    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$;
    CREATE TRIGGER refuse BEFORE INSERT OR UPDATE OR DELETE ON plan_results FOR EACH ROW EXECUTE FUNCTION refuse();
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the one version stamp migration", { timeout: 30_000 }, () => {
  it("moves a frozen plan's stamp onto results that lack one, and drops the field", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    const { rows: results } = await db.query(
      "SELECT financial_plan_id, platform_version FROM plan_results ORDER BY financial_plan_id",
    );
    expect(results).toEqual([
      { financial_plan_id: OLD, platform_version: "2.0.0+engine.aaa" },
      { financial_plan_id: NEW, platform_version: "2.3.0+engine.bbb" },
      { financial_plan_id: DRAFT, platform_version: "3.0.0+engine.ccc" },
    ]);
    const { rows: columns } = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'financial_plans' ORDER BY column_name",
    );
    expect(columns).toEqual([{ column_name: "id" }, { column_name: "status" }]);
    const { rows: fields } = await db.query("SELECT collection, field FROM directus_fields ORDER BY id");
    expect(fields).toEqual([
      { collection: "financial_plans", field: "status" },
      { collection: "plan_results", field: "platform_version" },
    ]);
    // The results' trigger is back on.
    await expect(db.exec("DELETE FROM plan_results")).rejects.toThrow(/refused/);
  });

  it("does nothing on a new database", async () => {
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
