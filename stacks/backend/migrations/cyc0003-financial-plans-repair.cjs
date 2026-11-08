// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Repairs a database where an earlier cyc0002 added version_sets.status itself, which the schema
// apply then refused to add again, so the deploy failed half way (dev, once). It lists the sets
// that column marks saved, for the saved-versions hook to mark saved again once the schema apply
// has made the column, and drops the column Directus has no record of. Then it runs cyc0002 again,
// since a deploy of the code before Financial Plans may have put back what cyc0002 drops.
//
// It does nothing where cyc0002 ran as it is now, such as prod, or on a new database.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const financialPlans = require("./cyc0002-financial-plans.cjs");

const SQL = `
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'version_sets' AND column_name = 'status'
  ) AND (
    to_regclass('directus_fields') IS NULL
    OR NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'version_sets' AND field = 'status')
  ) THEN
    CREATE TABLE IF NOT EXISTS cyc_seed_saved_sets (version_set_id uuid PRIMARY KEY);
    INSERT INTO cyc_seed_saved_sets SELECT id FROM version_sets WHERE status = 'saved' ON CONFLICT DO NOTHING;
    ALTER TABLE version_sets DROP COLUMN status;
    RAISE NOTICE 'Dropped version_sets.status, which Directus has no record of';
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
  await financialPlans.up(knex);
}

async function down() {}

module.exports = { up, down, SQL };
