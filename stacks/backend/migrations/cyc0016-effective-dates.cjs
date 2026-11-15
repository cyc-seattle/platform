// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// A Financial Plan is active from a date, in place of an active status (cyc-seattle/platform#251).
// Each active one becomes saved, which it already was, and is listed in cyc_seed_effective_sets with
// the first day of its fiscal year, for the saved-versions hook to set once the schema apply has
// added version_sets.effective_from. The schema apply refuses a column that's already there without
// Directus's record of it, so this adds none. The Financial Plans migration's (cyc0002) list of plans
// to mark active joins it, the same way.
//
// The hook's triggers refuse taking a plan out of active, so they're off for the one update. It's
// one statement, so Postgres runs it in one transaction. It skips what's already done or doesn't
// exist, so it's safe to run again and does nothing on a new database.

const SEED = "cyc_seed_effective_sets";

/**
 * The first day of a Financial Plan's fiscal year, which ends in calendar year `fiscal_year`
 * (src/planning/dates.ts). An organization with no start month is read as starting in January.
 */
const MONTH = "coalesce(o.fiscal_year_start_month, 1)";
const FIRST_DAY = `make_date(CASE WHEN ${MONTH} = 1 THEN s.fiscal_year ELSE s.fiscal_year - 1 END, ${MONTH}, 1)`;

const SQL = `
DO $migration$
BEGIN
  IF to_regclass('version_sets') IS NULL OR to_regclass('organizations') IS NULL THEN
    RETURN;
  END IF;
  CREATE TABLE IF NOT EXISTS ${SEED} (version_set_id uuid PRIMARY KEY, effective_from date NOT NULL);

  IF EXISTS (SELECT 1 FROM version_sets WHERE status = 'active') THEN
    INSERT INTO ${SEED}
      SELECT s.id, ${FIRST_DAY} FROM version_sets s JOIN organizations o ON o.id = s.organization_id
        WHERE s.status = 'active'
      ON CONFLICT DO NOTHING;
    ALTER TABLE version_sets DISABLE TRIGGER USER;
    UPDATE version_sets SET status = 'saved' WHERE status = 'active';
    ALTER TABLE version_sets ENABLE TRIGGER USER;
    RAISE NOTICE 'Listed % active Financial Plans to date', (SELECT count(*) FROM ${SEED});
  END IF;

  -- Each year's one listed plan, as cyc0002 chose it; a year with an active plan already has its date.
  IF to_regclass('cyc_seed_active_sets') IS NOT NULL THEN
    INSERT INTO ${SEED}
      SELECT s.id, ${FIRST_DAY}
        FROM cyc_seed_active_sets seed
        JOIN version_sets s ON s.id = seed.version_set_id
        JOIN organizations o ON o.id = s.organization_id
        WHERE NOT EXISTS (
          SELECT 1 FROM ${SEED} dated JOIN version_sets d ON d.id = dated.version_set_id
            WHERE d.organization_id = s.organization_id AND d.fiscal_year = s.fiscal_year
        )
      ON CONFLICT DO NOTHING;
    DROP TABLE cyc_seed_active_sets;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ${SEED}) THEN
    DROP TABLE ${SEED};
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the status no longer has active.
async function down() {}

module.exports = { up, down, SQL, SEED };
