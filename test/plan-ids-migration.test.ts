import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0031-plan-ids.cjs";

// No plan keys (cyc-seattle/platform#395), in a real Postgres (PGlite), with a trigger like the
// frozen-plans hook's that refuses every write.

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number) => id(100 + n);
const [FROZEN, DRAFT] = [id(1), id(2)];
const [F_OPS, F_AREA, D_OPS, D_AREA] = [id(10), id(11), id(12), id(13)];
// Each row in the frozen Financial Plan, and its copy in the draft, which keeps its key.
const [F_TERM, D_TERM, F_POS, D_POS, F_OFF, D_OFF, F_POOL, D_POOL] = [21, 22, 23, 24, 25, 26, 27, 28].map(id);
const [F_OWNER, F_ITEM, F_LINE, F_STAFF, D_STAFF] = [31, 32, 33, 34, 35].map(id);
const PRODUCT = id(90);

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE plans (id uuid PRIMARY KEY, financial_plan_id uuid NOT NULL);
    CREATE TABLE plan_terms (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL);
    CREATE TABLE plan_salaried_positions (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL);
    CREATE TABLE plan_pools (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL);
    CREATE TABLE plan_offerings (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL, term_key uuid);
    CREATE TABLE plan_bonus_owners (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL,
      term_key uuid, position_key uuid);
    CREATE TABLE plan_block_staff (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL, position_key uuid);
    CREATE TABLE plan_capital_items (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL);
    CREATE TABLE plan_budget_lines (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL,
      cost_center_type varchar(255) NOT NULL, cost_center_key uuid);
    CREATE TABLE plan_labor_lines (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL,
      cost_center_type varchar(255) NOT NULL, cost_center_key uuid);
    CREATE TABLE plan_result_lines (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL,
      cost_center_type varchar(255) NOT NULL, cost_center_key uuid);
    CREATE TABLE plan_result_pnl (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL, level varchar(255) NOT NULL,
      subject_key uuid NOT NULL, term_key uuid);
    CREATE TABLE plan_result_bonuses (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL, bonus_owner_key uuid NOT NULL,
      term_key uuid, program_area_key uuid);
    CREATE TABLE plan_result_positions (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL, position_key uuid NOT NULL);
    CREATE TABLE plan_result_capital (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL, item_key uuid NOT NULL);
    CREATE TABLE plan_result_warnings (id serial PRIMARY KEY, financial_plan_id uuid NOT NULL, subject_key varchar(255));

    INSERT INTO plans VALUES ('${F_OPS}', '${FROZEN}'), ('${F_AREA}', '${FROZEN}'), ('${D_OPS}', '${DRAFT}'), ('${D_AREA}', '${DRAFT}');
    INSERT INTO plan_terms VALUES ('${F_TERM}', '${F_OPS}', '${key(1)}'), ('${D_TERM}', '${D_OPS}', '${key(1)}');
    INSERT INTO plan_salaried_positions VALUES ('${F_POS}', '${F_OPS}', '${key(2)}'), ('${D_POS}', '${D_OPS}', '${key(2)}');
    INSERT INTO plan_pools VALUES ('${F_POOL}', '${F_OPS}', '${key(4)}'), ('${D_POOL}', '${D_OPS}', '${key(4)}');
    -- The draft's offering names a term no row in its Financial Plan has.
    INSERT INTO plan_offerings VALUES ('${F_OFF}', '${F_AREA}', '${key(3)}', '${key(1)}'),
      ('${D_OFF}', '${D_AREA}', '${key(3)}', '${key(9)}');
    INSERT INTO plan_bonus_owners VALUES ('${F_OWNER}', '${F_OPS}', '${key(5)}', '${key(1)}', '${key(2)}');
    INSERT INTO plan_block_staff VALUES ('${F_STAFF}', '${F_AREA}', '${key(7)}', '${key(2)}'),
      ('${D_STAFF}', '${D_AREA}', '${key(7)}', '${key(2)}');
    INSERT INTO plan_capital_items VALUES ('${F_ITEM}', '${F_OPS}', '${key(6)}');
    INSERT INTO plan_budget_lines VALUES ('${F_LINE}', '${F_AREA}', '${key(8)}', 'offering', '${key(3)}'),
      ('${id(36)}', '${F_OPS}', '${key(10)}', 'pool', '${key(4)}'),
      ('${id(37)}', '${F_AREA}', '${key(11)}', 'product', '${PRODUCT}'),
      ('${id(38)}', '${D_AREA}', '${key(8)}', 'offering', '${key(3)}');
    INSERT INTO plan_labor_lines VALUES ('${id(39)}', '${F_OPS}', '${key(12)}', 'org', NULL);
    INSERT INTO plan_result_lines (financial_plan_id, cost_center_type, cost_center_key) VALUES
      ('${FROZEN}', 'offering', '${key(3)}'), ('${FROZEN}', 'product', '${PRODUCT}'), ('${FROZEN}', 'pool', '${key(4)}'),
      ('${DRAFT}', 'offering', '${key(3)}');
    INSERT INTO plan_result_pnl (financial_plan_id, level, subject_key, term_key) VALUES
      ('${FROZEN}', 'offering', '${key(3)}', NULL), ('${FROZEN}', 'product', '${PRODUCT}', NULL),
      ('${FROZEN}', 'program_area_term', '${PRODUCT}', '${key(1)}');
    INSERT INTO plan_result_bonuses (financial_plan_id, bonus_owner_key, term_key, program_area_key) VALUES
      ('${FROZEN}', '${key(5)}', '${key(1)}', '${PRODUCT}');
    INSERT INTO plan_result_positions (financial_plan_id, position_key) VALUES ('${FROZEN}', '${key(2)}');
    INSERT INTO plan_result_capital (financial_plan_id, item_key) VALUES ('${FROZEN}', '${key(6)}'), ('${FROZEN}', '${key(8)}');
    INSERT INTO plan_result_warnings (financial_plan_id, subject_key) VALUES
      ('${FROZEN}', '${key(3)}'), ('${FROZEN}', 'coach_wages'), ('${FROZEN}', NULL);
    INSERT INTO directus_fields (collection, field) VALUES ('plan_offerings', 'key'), ('plan_offerings', 'term_key'),
      ('plan_terms', 'key'), ('plan_result_pnl', 'subject_key'), ('plan_result_pnl', 'level');

    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'frozen'; END $$;
    CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON plan_offerings FOR EACH ROW EXECUTE FUNCTION refuse();
    CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON plan_result_pnl FOR EACH ROW EXECUTE FUNCTION refuse();
  `);
  return db;
}

const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the plan ids migration", { timeout: 30_000 }, () => {
  it("points each reference at the row with its key in the same Financial Plan", async () => {
    const db = await before();
    await migrate(db);
    expect(await rows(db, "SELECT id, term_id FROM plan_offerings ORDER BY id")).toEqual([
      { id: F_OFF, term_id: F_TERM },
      // A key no row in its Financial Plan has is cleared.
      { id: D_OFF, term_id: null },
    ]);
    expect(await rows(db, "SELECT term_id, position_id FROM plan_bonus_owners")).toEqual([
      { term_id: F_TERM, position_id: F_POS },
    ]);
    expect(await rows(db, "SELECT id, position_id FROM plan_block_staff ORDER BY id")).toEqual([
      { id: F_STAFF, position_id: F_POS },
      { id: D_STAFF, position_id: D_POS },
    ]);
    expect(await rows(db, "SELECT cost_center_type, cost_center_id FROM plan_budget_lines ORDER BY id")).toEqual([
      { cost_center_type: "offering", cost_center_id: F_OFF },
      { cost_center_type: "pool", cost_center_id: F_POOL },
      { cost_center_type: "product", cost_center_id: PRODUCT },
      { cost_center_type: "offering", cost_center_id: D_OFF },
    ]);
    expect(await rows(db, "SELECT cost_center_type, cost_center_id FROM plan_labor_lines")).toEqual([
      { cost_center_type: "org", cost_center_id: null },
    ]);
  });

  it("points a result's references at its own Financial Plan's rows, even a frozen one's", async () => {
    const db = await before();
    await migrate(db);
    expect(await rows(db, "SELECT cost_center_id FROM plan_result_lines ORDER BY id")).toEqual([
      { cost_center_id: F_OFF },
      { cost_center_id: PRODUCT },
      { cost_center_id: F_POOL },
      { cost_center_id: D_OFF },
    ]);
    expect(await rows(db, "SELECT subject_id, term_id FROM plan_result_pnl ORDER BY id")).toEqual([
      { subject_id: F_OFF, term_id: null },
      { subject_id: PRODUCT, term_id: null },
      { subject_id: PRODUCT, term_id: F_TERM },
    ]);
    expect(await rows(db, "SELECT bonus_owner_id, term_id, program_area_id FROM plan_result_bonuses")).toEqual([
      { bonus_owner_id: F_OWNER, term_id: F_TERM, program_area_id: PRODUCT },
    ]);
    expect(await rows(db, "SELECT position_id FROM plan_result_positions")).toEqual([{ position_id: F_POS }]);
    // Capital entered as a budget line names the line.
    expect(await rows(db, "SELECT item_id FROM plan_result_capital ORDER BY id")).toEqual([
      { item_id: F_ITEM },
      { item_id: F_LINE },
    ]);
    expect(await rows(db, "SELECT subject_id FROM plan_result_warnings ORDER BY id")).toEqual([
      { subject_id: F_OFF },
      { subject_id: "coach_wages" },
      { subject_id: null },
    ]);
  });

  it("drops every key, with Directus's records of them and of the old names, and turns the triggers back on", async () => {
    const db = await before();
    await migrate(db);
    const keys = await rows(
      db,
      `SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema()
        AND (column_name = 'key' OR column_name LIKE '%\\_key')`,
    );
    expect(keys).toEqual([]);
    expect(await rows(db, "SELECT collection, field FROM directus_fields ORDER BY id")).toEqual([
      { collection: "plan_offerings", field: "term_id" },
      { collection: "plan_result_pnl", field: "subject_id" },
      { collection: "plan_result_pnl", field: "level" },
    ]);
    await expect(db.exec(`UPDATE plan_offerings SET term_id = NULL`)).rejects.toThrow("frozen");
  });

  it("stops before changing anything when a result that needs a row names a key no row has", async () => {
    const db = await before();
    await db.exec(
      `INSERT INTO plan_result_positions (financial_plan_id, position_key) VALUES ('${DRAFT}', '${key(99)}')`,
    );
    await expect(migrate(db)).rejects.toThrow(
      `cyc0031: plan_result_positions.position_key names a key no row in Financial Plan ${DRAFT} has.`,
    );
    expect(await rows(db, "SELECT term_key FROM plan_offerings ORDER BY id")).toEqual([
      { term_key: key(1) },
      { term_key: key(9) },
    ]);
  });

  it("takes a warning's subject from the table it can name, when two of a Financial Plan's rows share its key", async () => {
    const db = await before();
    // A key the frozen plan's offering and its rates both have, which only the offering can be a warning about.
    await db.exec(`
      CREATE TABLE plan_rates (id uuid PRIMARY KEY, plan_id uuid NOT NULL, key uuid NOT NULL);
      INSERT INTO plan_rates VALUES ('${id(40)}', '${F_OPS}', '${key(3)}');
    `);
    await migrate(db);
    expect(await rows(db, "SELECT subject_id FROM plan_result_warnings ORDER BY id LIMIT 1")).toEqual([
      { subject_id: F_OFF },
    ]);
  });

  it("does nothing when run again, or on a new database", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    expect(await rows(db, "SELECT term_id FROM plan_offerings ORDER BY id")).toEqual([
      { term_id: F_TERM },
      { term_id: null },
    ]);
    await migrate(await PGlite.create());
  });
});
