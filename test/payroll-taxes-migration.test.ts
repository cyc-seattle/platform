import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0019-payroll-taxes.cjs";

// Each payroll tax as a row of its own (cyc-seattle/platform#301), in a real Postgres (PGlite), with
// a trigger like the frozen-plans hook's that refuses every write to the rates.

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [FROZEN, UNRATED, DRAFT] = [id(1), id(2), id(3)];
const [FROZEN_OPS, FROZEN_AREA, UNRATED_OPS, DRAFT_OPS, DRAFT_AREA] = [id(10), id(11), id(12), id(13), id(14)];

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE financial_plans (id uuid PRIMARY KEY, status varchar(255));
    CREATE TABLE plans (id uuid PRIMARY KEY, financial_plan_id uuid NOT NULL, kind varchar(255) NOT NULL);
    CREATE TABLE plan_rates (id uuid PRIMARY KEY, plan_id uuid NOT NULL, payroll_tax_rate numeric(12, 4),
      mileage_rate_cents integer);
    INSERT INTO financial_plans VALUES ('${FROZEN}', 'frozen'), ('${UNRATED}', 'frozen'), ('${DRAFT}', 'draft');
    INSERT INTO plans VALUES ('${FROZEN_OPS}', '${FROZEN}', 'operations'), ('${FROZEN_AREA}', '${FROZEN}', 'program_area'),
      ('${UNRATED_OPS}', '${UNRATED}', 'operations'), ('${DRAFT_OPS}', '${DRAFT}', 'operations'),
      ('${DRAFT_AREA}', '${DRAFT}', 'program_area');
    INSERT INTO plan_rates VALUES ('${id(20)}', '${FROZEN_OPS}', 0.0948, 67), ('${id(21)}', '${UNRATED_OPS}', NULL, 67),
      ('${id(22)}', '${DRAFT_OPS}', 0.0948, 67);
    INSERT INTO directus_fields (collection, field) VALUES ('plan_rates', 'payroll_tax_rate'), ('plan_rates', 'mileage_rate_cents');
    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$;
    CREATE TRIGGER refuse BEFORE INSERT OR UPDATE OR DELETE ON plan_rates FOR EACH ROW EXECUTE FUNCTION refuse();
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the payroll taxes migration", { timeout: 30_000 }, () => {
  it("gives a draft each tax as it's collected, and a frozen plan its old rate, then drops the field", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    const { rows: taxes } = await db.query(
      `SELECT plan_id, name, wage_share::float AS wage_share, hourly_cents::float AS hourly_cents, sort
        FROM cyc_seed_payroll_taxes ORDER BY plan_id, sort`,
    );
    expect(taxes).toEqual([
      { plan_id: FROZEN_OPS, name: "Payroll tax", wage_share: 0.0948, hourly_cents: null, sort: 1 },
      { plan_id: DRAFT_OPS, name: "Social Security", wage_share: 0.062, hourly_cents: null, sort: 1 },
      { plan_id: DRAFT_OPS, name: "Medicare", wage_share: 0.0145, hourly_cents: null, sort: 2 },
      { plan_id: DRAFT_OPS, name: "WA unemployment", wage_share: 0.0027, hourly_cents: null, sort: 3 },
      { plan_id: DRAFT_OPS, name: "L&I", wage_share: null, hourly_cents: 45.235, sort: 4 },
    ]);
    const { rows: columns } = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'plan_rates' ORDER BY column_name",
    );
    expect(columns).toEqual([{ column_name: "id" }, { column_name: "mileage_rate_cents" }, { column_name: "plan_id" }]);
    const { rows: fields } = await db.query("SELECT collection, field FROM directus_fields ORDER BY id");
    expect(fields).toEqual([{ collection: "plan_rates", field: "mileage_rate_cents" }]);
    // The rates' trigger is still on.
    await expect(db.exec("DELETE FROM plan_rates")).rejects.toThrow(/refused/);
  });

  it("does nothing on a new database", async () => {
    const db = await PGlite.create();
    await expect(migrate(db)).resolves.toBeUndefined();
    const { rows } = await db.query("SELECT to_regclass('cyc_seed_payroll_taxes') AS seed");
    expect(rows).toEqual([{ seed: null }]);
  });
});
