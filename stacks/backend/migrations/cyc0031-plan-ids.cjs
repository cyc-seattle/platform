// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// No plan keys (cyc-seattle/platform#395): a plan row has one identifier, its `id`. Each reference by
// key becomes a reference by id, to the row with that key in the same Financial Plan, and the `key`
// columns go. A key no row in its Financial Plan has:
// - in a column that may be empty (a row's term, position or cost center, a result line's cost center,
//   a P&L row's term, a bonus's term) is cleared, since an id must name a row;
// - in one that may not (an offering's P&L row, a bonus's owner, a position's pay, a capital rank)
//   stops the migration, naming the table and the Financial Plan, before it changes anything;
// - as a warning's subject is left as it was, since a subject can also be a product's id or a rate.
// Results change only their references, so a frozen Financial Plan's numbers stay.
//
// It changes frozen Financial Plans, which the frozen-plans rules forbid, so their triggers are off
// for these statements. ALTER TABLE locks each table until the migration commits, so no other write
// gets in while they're off. The schema apply adds the new links' foreign keys after it.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once
// `plan_offerings.key` is gone, or on a new database.

/** Each plan row table, whose `key` column goes. */
const ROWS = [
  "plan_activities",
  "plan_activity_blocks",
  "plan_block_boats",
  "plan_block_staff",
  "plan_boat_rates",
  "plan_bonus_owner_products",
  "plan_bonus_owners",
  "plan_budget_lines",
  "plan_capital_items",
  "plan_closed_dates",
  "plan_labor_lines",
  "plan_offerings",
  "plan_payroll_taxes",
  "plan_pools",
  "plan_programs",
  "plan_rates",
  "plan_revenue_charges",
  "plan_salaried_bookings",
  "plan_salaried_positions",
  "plan_terms",
  "plan_trips",
];

/** The tables of a Financial Plan's results, as stacks/backend/policies.ts lists them. */
const RESULTS = [
  "plan_results",
  "plan_result_lines",
  "plan_result_pnl",
  "plan_result_bonuses",
  "plan_result_positions",
  "plan_result_capital",
  "plan_result_warnings",
];

/** Each reference by key, as [table, old column, new column], renamed in place. */
const RENAMED = [
  ["plan_offerings", "term_key", "term_id"],
  ["plan_bonus_owners", "term_key", "term_id"],
  ["plan_bonus_owners", "position_key", "position_id"],
  ["plan_block_staff", "position_key", "position_id"],
  ["plan_labor_lines", "cost_center_key", "cost_center_id"],
  ["plan_budget_lines", "cost_center_key", "cost_center_id"],
  ["plan_result_lines", "cost_center_key", "cost_center_id"],
  ["plan_result_pnl", "subject_key", "subject_id"],
  ["plan_result_pnl", "term_key", "term_id"],
  ["plan_result_bonuses", "term_key", "term_id"],
  ["plan_result_bonuses", "bonus_owner_key", "bonus_owner_id"],
  ["plan_result_bonuses", "program_area_key", "program_area_id"],
  ["plan_result_positions", "position_key", "position_id"],
  ["plan_result_capital", "item_key", "item_id"],
  ["plan_result_warnings", "subject_key", "subject_id"],
];

/**
 * Each result column that may not be empty, as [table, column, the tables its key can name as a Postgres
 * array, which of its rows hold a key], checked before anything changes.
 */
const REQUIRED = [
  ["plan_result_pnl", "subject_key", "{plan_offerings}", "t.level = 'offering'"],
  ["plan_result_bonuses", "bonus_owner_key", "{plan_bonus_owners}", "true"],
  ["plan_result_positions", "position_key", "{plan_salaried_positions}", "true"],
  ["plan_result_capital", "item_key", "{plan_capital_items,plan_budget_lines}", "true"],
];

/** The tables a warning's subject can name a row of, in the order a key found in two is taken from. */
const SUBJECTS = [
  "plan_offerings",
  "plan_activities",
  "plan_trips",
  "plan_block_staff",
  "plan_closed_dates",
  "plan_budget_lines",
  "plan_labor_lines",
  "plan_capital_items",
  "plan_pools",
  "plan_payroll_taxes",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_bonus_owners",
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const array = (values) => `ARRAY[${values.map(literal).join(", ")}]`;

// `ids` holds each row's id by its Financial Plan and key. A row's Financial Plan comes through its plan;
// a result's is its own `financial_plan_id`.
const byKey = (table, column, where, set) => `
  UPDATE ${table} t SET ${column} = (
    SELECT i.id FROM cyc_plan_ids i
      WHERE i.financial_plan_id = ${set} AND i.key = t.${column}::text AND i.tbl = ANY (${where})
      LIMIT 1
  ) WHERE t.${column} IS NOT NULL`;
const rowSet = "(SELECT p.financial_plan_id FROM plans p WHERE p.id = t.plan_id)";
const resultSet = "t.financial_plan_id";

const SQL = `
DO $migration$
DECLARE
  t text;
  ref text[];
  missing uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'plan_offerings' AND column_name = 'key'
  ) THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ${array([...ROWS, ...RESULTS])} LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
    END IF;
  END LOOP;

  CREATE TEMPORARY TABLE cyc_plan_ids (financial_plan_id uuid, key text, id uuid, tbl text) ON COMMIT DROP;
  FOREACH t IN ARRAY ${array(ROWS)} LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO cyc_plan_ids SELECT p.financial_plan_id, r.key::text, r.id, %L FROM %I r JOIN plans p ON p.id = r.plan_id',
        t, t);
    END IF;
  END LOOP;

  -- A result column that may not be empty needs every key in it to name a row.
  FOREACH ref SLICE 1 IN ARRAY ARRAY[${REQUIRED.map(array).join(", ")}] LOOP
    IF to_regclass(ref[1]) IS NOT NULL THEN
      EXECUTE format($sql$
        SELECT t.financial_plan_id FROM %I t
          WHERE %s AND NOT EXISTS (
            SELECT 1 FROM cyc_plan_ids i
              WHERE i.financial_plan_id = t.financial_plan_id AND i.key = t.%I::text AND i.tbl = ANY (%L::text[])
          ) LIMIT 1$sql$, ref[1], ref[4], ref[2], ref[3]) INTO missing;
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'cyc0031: %.% names a key no row in Financial Plan % has. Fix it before this runs.',
          ref[1], ref[2], missing;
      END IF;
    END IF;
  END LOOP;

  FOREACH ref SLICE 1 IN ARRAY ARRAY[${RENAMED.map(array).join(", ")}] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ref[1] AND column_name = ref[2]
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', ref[1], ref[2], ref[3]);
      -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
      IF to_regclass('directus_fields') IS NOT NULL THEN
        UPDATE directus_fields SET field = ref[3] WHERE collection = ref[1] AND field = ref[2];
      END IF;
    END IF;
  END LOOP;

  ${byKey("plan_offerings", "term_id", "ARRAY['plan_terms']", rowSet)};
  ${byKey("plan_bonus_owners", "term_id", "ARRAY['plan_terms']", rowSet)};
  ${byKey("plan_bonus_owners", "position_id", "ARRAY['plan_salaried_positions']", rowSet)};
  ${byKey("plan_block_staff", "position_id", "ARRAY['plan_salaried_positions']", rowSet)};
  -- A cost center names an offering or a pool by key, and a product or program area by its own id.
  FOREACH t IN ARRAY ARRAY['plan_labor_lines', 'plan_budget_lines'] LOOP
    EXECUTE format($sql$
      UPDATE %I t SET cost_center_id = (
        SELECT i.id FROM cyc_plan_ids i, plans p
          WHERE p.id = t.plan_id AND i.financial_plan_id = p.financial_plan_id AND i.key = t.cost_center_id::text
            AND i.tbl = CASE t.cost_center_type WHEN 'offering' THEN 'plan_offerings' ELSE 'plan_pools' END
          LIMIT 1
      ) WHERE t.cost_center_type IN ('offering', 'pool') AND t.cost_center_id IS NOT NULL$sql$, t);
  END LOOP;

  IF to_regclass('plan_result_lines') IS NOT NULL THEN
    UPDATE plan_result_lines t SET cost_center_id = (
      SELECT i.id FROM cyc_plan_ids i
        WHERE i.financial_plan_id = t.financial_plan_id AND i.key = t.cost_center_id::text
          AND i.tbl = CASE t.cost_center_type WHEN 'offering' THEN 'plan_offerings' ELSE 'plan_pools' END
        LIMIT 1
    ) WHERE t.cost_center_type IN ('offering', 'pool') AND t.cost_center_id IS NOT NULL;
    UPDATE plan_result_pnl t SET subject_id = (
      SELECT i.id FROM cyc_plan_ids i
        WHERE i.financial_plan_id = t.financial_plan_id AND i.key = t.subject_id::text AND i.tbl = 'plan_offerings'
        LIMIT 1
    ) WHERE t.level = 'offering';
    ${byKey("plan_result_pnl", "term_id", "ARRAY['plan_terms']", resultSet)};
    ${byKey("plan_result_bonuses", "term_id", "ARRAY['plan_terms']", resultSet)};
    ${byKey("plan_result_bonuses", "bonus_owner_id", "ARRAY['plan_bonus_owners']", resultSet)};
    ${byKey("plan_result_positions", "position_id", "ARRAY['plan_salaried_positions']", resultSet)};
    ${byKey("plan_result_capital", "item_id", "ARRAY['plan_capital_items', 'plan_budget_lines']", resultSet)};
    -- A warning's subject is a row's key, or something else, such as a product's id, which stays.
    UPDATE plan_result_warnings t SET subject_id = coalesce((
      SELECT i.id::text FROM cyc_plan_ids i
        WHERE i.financial_plan_id = t.financial_plan_id AND i.key = t.subject_id AND i.tbl = ANY (${array(SUBJECTS)})
        ORDER BY array_position(${array(SUBJECTS)}, i.tbl)
        LIMIT 1
    ), t.subject_id) WHERE t.subject_id IS NOT NULL;
  END IF;

  FOREACH t IN ARRAY ${array(ROWS)} LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS key', t);
    END IF;
  END LOOP;
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields WHERE collection = ANY (${array(ROWS)}) AND field = 'key';
  END IF;

  FOREACH t IN ARRAY ${array([...ROWS, ...RESULTS])} LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
    END IF;
  END LOOP;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the keys are gone.
async function down() {}

module.exports = { up, down, SQL };
