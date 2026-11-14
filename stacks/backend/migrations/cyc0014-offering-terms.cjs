// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// An offering is in one of its Financial Plan's terms, a list in the Operations Plan, in place of
// free text in season_term (cyc-seattle/platform#251). The schema apply makes plan_terms after this
// runs, and refuses a table it didn't make, so this lists each draft offering's text, with its
// draft Financial Plan's Operations Plan copy, in cyc_seed_terms, for the saved-versions hook to
// make the terms from. Then it drops season_term, with Directus's record of it, as cyc0012 did. A
// saved Financial Plan's offerings lose their text too, which the engine never read.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once season_term is
// gone, or on a new database.

const SEED = "cyc_seed_terms";

const SQL = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'plan_offerings' AND column_name = 'season_term'
  ) THEN
    RETURN;
  END IF;
  CREATE TABLE IF NOT EXISTS ${SEED} (offering_id uuid PRIMARY KEY, operations_version_id uuid NOT NULL, name text NOT NULL);
  INSERT INTO ${SEED}
    SELECT o.id, operations.version_id, btrim(o.season_term)
      FROM plan_offerings o
      JOIN version_set_members member ON member.version_id = o.version_id
      JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
      JOIN version_set_members operations ON operations.version_set_id = s.id
      JOIN plans plan ON plan.id = operations.plan_id AND plan.kind = 'operations'
      WHERE btrim(coalesce(o.season_term, '')) <> ''
    ON CONFLICT DO NOTHING;
  RAISE NOTICE 'Listed % draft offerings to put in terms', (SELECT count(*) FROM ${SEED});
  IF NOT EXISTS (SELECT 1 FROM ${SEED}) THEN
    DROP TABLE ${SEED};
  END IF;
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields WHERE collection = 'plan_offerings' AND field = 'season_term';
  END IF;
  ALTER TABLE plan_offerings DROP COLUMN season_term;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the free text is gone.
async function down() {}

module.exports = { up, down, SQL, SEED };
