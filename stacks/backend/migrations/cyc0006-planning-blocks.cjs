// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Plans now give each block of activities its staff, RIBs and boats, in place of the engine working
// them out (cyc-seattle/platform#149). This drops the three collections that worked them out, with
// Directus's records of them, which the schema apply never does: the recurring block rules, each
// offering's boat classes, and each activity's resources. The apply drops the old fields on offerings
// and activities itself.
//
// Its key is cyc0006, not cyc0005, because dev recorded cyc0005 when the branch was tried there, then
// main's schema made the three again. Old plans may still hold rows in them; this drops those too,
// since dropping a table fires no row trigger. It's one statement, so Postgres runs it in one
// transaction. It skips what's already gone, so it's safe to run again and does nothing on a new
// database.

const SQL = `
DO $migration$
DECLARE
  dropped text;
BEGIN
  FOREACH dropped IN ARRAY ARRAY['plan_activity_block_rules', 'plan_offering_boat_classes', 'plan_activity_resources']
  LOOP
    IF to_regclass(dropped) IS NOT NULL THEN
      EXECUTE format('DROP TABLE %I', dropped);
      RAISE NOTICE 'Dropped %', dropped;
    END IF;
    -- Their permissions and default views are the backend stack's, which deletes them.
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_relations WHERE many_collection = dropped OR one_collection = dropped;
      DELETE FROM directus_fields WHERE collection = dropped;
      DELETE FROM directus_collections WHERE collection = dropped;
    END IF;
  END LOOP;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the old plans are drafted again in blocks.
async function down() {}

module.exports = { up, down, SQL };
