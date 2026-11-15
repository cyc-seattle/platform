// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Each payroll tax is a row of plan_payroll_taxes, charged the way it's collected, in place of one
// plan_rates.payroll_tax_rate (cyc-seattle/platform#301). A draft's Operations Plan gets TAXES. A
// frozen one keeps one "Payroll tax" at its old rate, so its rows read as they were calculated.
//
// The schema apply makes plan_payroll_taxes, and refuses a table that's already there without
// Directus's record of it, so this lists each plan's rows in cyc_seed_payroll_taxes for the
// frozen-plans hook to add once the apply has made it. Then it drops the old field, which the apply
// never deletes. It's one statement, so Postgres runs it in one transaction. It does nothing once
// plan_rates.payroll_tax_rate is gone, or on a new database.

/** A draft's taxes: its name, its share of wages, and its cents for each paid hour. */
const TAXES = [
  ["Social Security", 0.062, null],
  ["Medicare", 0.0145, null],
  ["WA unemployment", 0.0027, null],
  ["L&I", null, 45.235],
];

const literal = (value) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const taxes = TAXES.map(
  ([name, share, hourly], i) => `(${literal(name)}, ${literal(share)}, ${literal(hourly)}, ${i + 1})`,
);

const SQL = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'plan_rates' AND column_name = 'payroll_tax_rate'
  ) THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS cyc_seed_payroll_taxes (
    plan_id uuid NOT NULL, name text NOT NULL, wage_share numeric, hourly_cents numeric, sort integer,
    PRIMARY KEY (plan_id, name)
  );
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
  IF to_regclass('plans') IS NOT NULL AND to_regclass('financial_plans') IS NOT NULL THEN
    INSERT INTO cyc_seed_payroll_taxes
      SELECT p.id, t.name, t.wage_share, t.hourly_cents, t.sort
        FROM plans p JOIN financial_plans f ON f.id = p.financial_plan_id
        CROSS JOIN (VALUES ${taxes.join(", ")}) AS t (name, wage_share, hourly_cents, sort)
        WHERE p.kind = 'operations' AND f.status = 'draft'
      ON CONFLICT DO NOTHING;
    INSERT INTO cyc_seed_payroll_taxes
      SELECT DISTINCT ON (p.id) p.id, 'Payroll tax', r.payroll_tax_rate, NULL::numeric, 1
        FROM plans p JOIN financial_plans f ON f.id = p.financial_plan_id JOIN plan_rates r ON r.plan_id = p.id
        WHERE p.kind = 'operations' AND f.status <> 'draft' AND r.payroll_tax_rate IS NOT NULL
        ORDER BY p.id, r.id
      ON CONFLICT DO NOTHING;
  END IF;

  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields WHERE collection = 'plan_rates' AND field = 'payroll_tax_rate';
  END IF;
  ALTER TABLE plan_rates DROP COLUMN payroll_tax_rate;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the old field is gone from the schema.
async function down() {}

module.exports = { up, down, SQL, TAXES };
