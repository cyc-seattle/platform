// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Drops storage_areas.sort, which nothing reads or sets (cyc-seattle/sail-team#114), with its
// Directus field and the collection's manual sort. The schema apply never deletes a field, so this
// does. It does nothing where the field is already gone, or the table isn't made yet.

const SQL = `
DO $migration$
BEGIN
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields WHERE collection = 'storage_areas' AND field = 'sort';
    UPDATE directus_collections SET sort_field = NULL
      WHERE collection = 'storage_areas' AND sort_field = 'sort';
  END IF;
  IF to_regclass('storage_areas') IS NOT NULL THEN
    ALTER TABLE storage_areas DROP COLUMN IF EXISTS sort;
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the field is gone from the schema.
async function down() {}

module.exports = { up, down, SQL };
