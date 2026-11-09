// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Replaces the log of which Financial Plan is active, version_set_activations, with an active status
// on the Financial Plan itself (cyc-seattle/sail-team#50). Directus's revisions keep who marked one
// active, and when. For each organization's year, this marks active the Financial Plan in its newest
// mark, then drops the log, with Directus's records of it, which the schema apply never does.
//
// The saved-versions hook's triggers refuse a saved Financial Plan's change, and the old ones don't
// know an active one, so this drops every one of them rather than leave some stale. The hook installs
// the new ones once Directus starts, and the deploy's saved-versions-check fails if it couldn't.
//
// It's one statement, so Postgres runs it in one transaction. It skips what's already done or
// doesn't exist, so it's safe to run again and does nothing on a new database.

const SQL = `
DO $migration$
DECLARE
  item record;
BEGIN
  IF to_regclass('version_set_activations') IS NULL THEN
    RETURN;
  END IF;
  FOR item IN
    SELECT c.relname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE tg.tgname = 'cyc_saved_versions' AND c.relnamespace = current_schema()::regnamespace
  LOOP
    EXECUTE format('DROP TRIGGER cyc_saved_versions ON %I', item.relname);
  END LOOP;

  FOR item IN
    SELECT DISTINCT ON (s.organization_id, s.fiscal_year) s.id
      FROM version_set_activations a JOIN version_sets s ON s.id = a.version_set_id
      WHERE s.status = 'saved'
      ORDER BY s.organization_id, s.fiscal_year, a.sequence DESC, s.id
  LOOP
    UPDATE version_sets SET status = 'active' WHERE id = item.id;
    RAISE NOTICE 'Marked Financial Plan % active', item.id;
  END LOOP;

  DROP TABLE version_set_activations;
  RAISE NOTICE 'Dropped version_set_activations';
  -- Its permissions and default view are the backend stack's, which deletes them.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_relations
      WHERE many_collection = 'version_set_activations' OR one_collection = 'version_set_activations';
    DELETE FROM directus_fields WHERE collection = 'version_set_activations';
    DELETE FROM directus_collections WHERE collection = 'version_set_activations';
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: Directus's revisions of the log stay, and the schema no longer has it.
async function down() {}

module.exports = { up, down, SQL };
