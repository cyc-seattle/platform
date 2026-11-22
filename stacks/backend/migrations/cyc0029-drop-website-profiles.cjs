// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Drops the website's old crew bios, website_profiles, and the category lists that named them, now
// that the website reads Crew (cyc-seattle/platform#263). The bios were copied onto crew members by
// hand first. The schema apply never deletes a collection, so this does, with Directus's records of
// them. The photos stay: crew members use the same files.
//
// If there are bios but no crew member is on the website, the copy hasn't happened, so it fails
// rather than be recorded as done. It does nothing once they're gone, or on a new database.

const SQL = `
DO $migration$
DECLARE
  dropped text[] := ARRAY['website_categories_profiles', 'website_profiles'];
BEGIN
  IF to_regclass('website_profiles') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM website_profiles) AND (
    to_regclass('crew_members') IS NULL OR NOT EXISTS (SELECT 1 FROM crew_members WHERE on_website)
  ) THEN
    RAISE EXCEPTION 'cyc0029: website_profiles holds bios, but no crew member is on the website yet. Copy the bios onto Crew first.';
  END IF;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
  IF to_regclass('directus_relations') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE many_collection = ANY (dropped) OR one_collection = ANY (dropped);
    DELETE FROM directus_fields WHERE collection = ANY (dropped)
      OR (collection = 'website_categories' AND field = 'profiles');
    DELETE FROM directus_permissions WHERE collection = ANY (dropped);
    DELETE FROM directus_presets WHERE collection = ANY (dropped);
    DELETE FROM directus_collections WHERE collection = ANY (dropped);
  END IF;
  DROP TABLE IF EXISTS website_categories_profiles;
  DROP TABLE website_profiles;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the bios live on crew members now.
async function down() {}

module.exports = { up, down, SQL };
