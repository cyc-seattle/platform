// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Drops the inventory #229 added, which only dev got before it was reverted (cyc-seattle/platform#126):
// six tables, their Directus records, and the Inventory folder. The schema apply never deletes a
// collection, so this does, and the apply then makes the catalog's boats afresh. It does nothing
// unless every one of the six that exists is empty.

const SQL = `
DO $migration$
DECLARE
  tables text[] := ARRAY[
    'boat_stage_changes', 'boat_charters', 'boat_damage', 'storage_agreements', 'boats', 'storage_spaces'
  ];
  t text;
  used boolean;
BEGIN
  IF to_regclass('storage_spaces') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO used;
      IF used THEN
        RETURN;
      END IF;
    END IF;
  END LOOP;
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_relations') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE many_collection = ANY (tables) OR one_collection = ANY (tables);
    DELETE FROM directus_fields WHERE collection = ANY (tables);
    DELETE FROM directus_permissions WHERE collection = ANY (tables);
    DELETE FROM directus_presets WHERE collection = ANY (tables);
    DELETE FROM directus_collections WHERE collection = ANY (tables) OR collection = 'Inventory';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', t);
  END LOOP;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the inventory is gone from the schema.
async function down() {}

module.exports = { up, down, SQL };
