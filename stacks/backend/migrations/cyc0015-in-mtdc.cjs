// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// "Left out of MTDC" becomes an "MTDC" checkbox (cyc-seattle/platform#126): excluded_from_mtdc is
// renamed in_mtdc, true by default, with every value flipped, saved copies' included, since a row
// keeps its meaning. The saved-versions triggers refuse a change to a saved copy's row, so they're
// off for the flip. The schema apply never renames, so this does. It does nothing where in_mtdc
// already exists.

/** Each table whose rows say whether they count toward MTDC. */
const TABLES = ["plan_budget_lines", "plan_revenue_charges"];

const SQL = `
DO $migration$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[${TABLES.map((table) => `'${table}'`).join(", ")}] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND column_name = 'excluded_from_mtdc'
    ) THEN
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
      EXECUTE format('ALTER TABLE %I RENAME COLUMN excluded_from_mtdc TO in_mtdc', t);
      EXECUTE format('UPDATE %I SET in_mtdc = NOT in_mtdc', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN in_mtdc SET DEFAULT true', t);
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
      -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
      -- Directus has none of its tables.
      IF to_regclass('directus_fields') IS NOT NULL THEN
        UPDATE directus_fields SET field = 'in_mtdc' WHERE collection = t AND field = 'excluded_from_mtdc';
      END IF;
    END IF;
  END LOOP;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: excluded_from_mtdc is gone from the schema.
async function down() {}

module.exports = { up, down, SQL, TABLES };
