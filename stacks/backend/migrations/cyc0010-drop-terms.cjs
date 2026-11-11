// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Drops the terms collection #229 added, which only dev got (cyc-seattle/platform#126): boat wear is
// counted by year, and CSC says season, not term. The schema apply never deletes a collection, so
// this does, with boat_charters.term_id and their metadata, so the apply finds nothing left to do.
// It does nothing where terms has rows, or doesn't exist.

const SQL = `
DO $migration$
DECLARE
  used boolean;
BEGIN
  IF to_regclass('terms') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM terms)' INTO used;
  IF used THEN
    RETURN;
  END IF;
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_relations') IS NOT NULL THEN
    DELETE FROM directus_relations
    WHERE one_collection = 'terms' OR many_collection = 'terms'
      OR (many_collection = 'boat_charters' AND many_field = 'term_id');
    DELETE FROM directus_fields
    WHERE collection = 'terms' OR (collection = 'boat_charters' AND field = 'term_id');
    DELETE FROM directus_permissions WHERE collection = 'terms';
    DELETE FROM directus_presets WHERE collection = 'terms';
    DELETE FROM directus_collections WHERE collection = 'terms';
  END IF;
  IF to_regclass('boat_charters') IS NOT NULL THEN
    ALTER TABLE boat_charters DROP COLUMN IF EXISTS term_id;
  END IF;
  DROP TABLE terms;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: terms is gone from the schema.
async function down() {}

module.exports = { up, down, SQL };
