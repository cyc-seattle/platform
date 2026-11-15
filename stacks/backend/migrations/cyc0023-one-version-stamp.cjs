// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Drops financial_plans.platform_version, which only a freeze set: plan_results.platform_version
// records the engine on every calculation, draft or frozen (cyc-seattle/platform#305). A frozen
// plan whose results predate their own stamp gets its plan's first, so none is lost. The results'
// triggers refuse that write, so they're off while it runs. The schema apply never deletes a field,
// so this does. It does nothing once the field is gone, or on a new database.

const SQL = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'financial_plans' AND column_name = 'platform_version'
  ) THEN
    RETURN;
  END IF;
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
  IF to_regclass('plan_results') IS NOT NULL THEN
    ALTER TABLE plan_results DISABLE TRIGGER USER;
    UPDATE plan_results r SET platform_version = f.platform_version FROM financial_plans f
      WHERE r.financial_plan_id = f.id AND r.platform_version IS NULL AND f.platform_version IS NOT NULL;
    ALTER TABLE plan_results ENABLE TRIGGER USER;
  END IF;
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields WHERE collection = 'financial_plans' AND field = 'platform_version';
  END IF;
  ALTER TABLE financial_plans DROP COLUMN platform_version;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the field is gone from the schema.
async function down() {}

module.exports = { up, down, SQL };
