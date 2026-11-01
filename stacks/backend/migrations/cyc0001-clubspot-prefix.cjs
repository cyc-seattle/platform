// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Gives the Clubspot mirrors the clubspot_ prefix (cyc-seattle/isthmia#241). Directus can't rename a
// collection, and clubspot-sync can't rebuild the mirrors, since it reads only camps that aren't
// archived. So this renames each table in place, with its keys and Directus's own records of it,
// and every row keeps its id. It also drops event_staff, which nothing writes, if it's empty.
//
// It's one statement, so Postgres runs it in one transaction. It skips a table that's already
// renamed or doesn't exist, so it's safe to run again and does nothing on a new database.

const RENAMED = [
  "camps",
  "sessions",
  "classes",
  "session_classes",
  "entry_caps",
  "registrations",
  "registration_entries",
  "registration_billing",
  "participants",
  "custom_field_definitions",
  "custom_field_responses",
  "promoted_fields",
];

const PREFIX = "clubspot_";

/** Directus's tables that name a collection, and their columns that do. Each is skipped if missing. */
const REFERENCES = [
  ["directus_collections", "collection"],
  ["directus_fields", "collection"],
  ["directus_relations", "many_collection"],
  ["directus_relations", "one_collection"],
  ["directus_permissions", "collection"],
  ["directus_presets", "collection"],
  ["directus_revisions", "collection"],
  ["directus_activity", "collection"],
  ["directus_comments", "collection"],
  ["directus_versions", "collection"],
  ["directus_shares", "collection"],
  ["directus_notifications", "collection"],
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const array = (values) => `ARRAY[${values.map(literal).join(", ")}]::text[]`;

const SQL = `
DO $migration$
DECLARE
  from_name text;
  to_name text;
  ref text[];
  item record;
  empty boolean;
BEGIN
  FOREACH from_name IN ARRAY ${array(RENAMED)} LOOP
    to_name := ${literal(PREFIX)} || from_name;
    IF to_regclass(quote_ident(from_name)) IS NULL OR to_regclass(quote_ident(to_name)) IS NOT NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I RENAME TO %I', from_name, to_name);
    -- Directus names a key after its table, and its schema snapshot records the name.
    FOR item IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = to_regclass(quote_ident(to_name)) AND starts_with(conname, from_name || '_')
    LOOP
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', to_name, item.conname, ${literal(PREFIX)} || item.conname);
    END LOOP;
    FOR item IN
      SELECT indexname FROM pg_indexes
      WHERE tablename = to_name AND schemaname = current_schema() AND starts_with(indexname, from_name || '_')
    LOOP
      EXECUTE format('ALTER INDEX %I RENAME TO %I', item.indexname, ${literal(PREFIX)} || item.indexname);
    END LOOP;
    FOREACH ref SLICE 1 IN ARRAY ARRAY[${REFERENCES.map(array).join(", ")}] LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ref[1] AND column_name = ref[2]
      ) THEN
        EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', ref[1], ref[2], ref[2]) USING to_name, from_name;
      END IF;
    END LOOP;
    RAISE NOTICE 'Renamed % to %', from_name, to_name;
  END LOOP;

  IF to_regclass('event_staff') IS NOT NULL THEN
    EXECUTE 'SELECT NOT EXISTS (SELECT 1 FROM event_staff)' INTO empty;
    IF empty THEN
      -- Its permissions and default view are the backend stack's, which deletes them.
      DELETE FROM directus_relations WHERE many_collection = 'event_staff';
      DELETE FROM directus_fields WHERE collection = 'event_staff';
      DELETE FROM directus_collections WHERE collection = 'event_staff';
      DROP TABLE event_staff;
      RAISE NOTICE 'Dropped event_staff';
    ELSE
      RAISE NOTICE 'Kept event_staff: it has rows';
    END IF;
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// The rename is one way: the backend stack's schema no longer has the old names.
async function down() {}

module.exports = { up, down, RENAMED, PREFIX, SQL };
