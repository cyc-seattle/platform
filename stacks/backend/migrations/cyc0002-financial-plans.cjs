// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Turns club plans into Financial Plans (docs/planning-schema.md). A Financial Plan holds its own
// copy of each plan, so a plan version no longer names the Operations Plan version it was saved
// with, a saved version no longer has results of its own, and plans are no longer made active one
// by one. This drops those columns and tables, which the schema apply never does, with Directus's
// own records of them, and marks every club plan saved, since each was saved when it was added.
//
// The saved-versions hook's triggers refuse these changes, so this drops them first. The hook
// installs the new ones once Directus starts.
//
// A plan copy is now in one Financial Plan. Older club plans could share a version, as dev's test
// runs left them, so where they do, this keeps the newest and deletes the older ones, with their
// members and results. Prod's single club plan shares nothing.
//
// Plans were made active one by one, and Financial Plans are marked active as a whole. Where an
// organization's year has one saved Financial Plan, it was the one in use, so this lists it in
// cyc_seed_active_sets for the hook to mark active once the schema apply has made the table for
// marks. A year with more than one is left unmarked, and logged.
//
// It adds no column: the schema apply adds every one schemas/planning.yaml declares, and refuses
// one that's already there without Directus's record of it.
//
// It's one statement, so Postgres runs it in one transaction. It skips what's already done or
// doesn't exist, so it's safe to run again and does nothing on a new database.

/** The tables that held a saved version's results beside a club plan's. */
const RESULTS = [
  "plan_result_lines",
  "plan_result_pnl",
  "plan_result_positions",
  "plan_result_warnings",
  "plan_results",
];

/** The tables that go, with everything Directus recorded about them. */
const DROPPED = ["plan_result_versions", "plan_activations"];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const array = (values) => `ARRAY[${values.map(literal).join(", ")}]::text[]`;

const SQL = `
DO $migration$
DECLARE
  item record;
  t text;
BEGIN
  FOR item IN
    SELECT tg.tgname, c.relname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE tg.tgname IN ('cyc_saved_versions', 'cyc_saved_versions_members')
      AND c.relnamespace = current_schema()::regnamespace
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', item.tgname, item.relname);
  END LOOP;

  -- Every club plan was saved when it was added. The schema apply adds version_sets.status, as a
  -- draft, after this runs, and refuses a column it didn't make, so the hook marks these saved then.
  IF to_regclass('version_sets') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'version_sets' AND column_name = 'status'
  ) THEN
    CREATE TABLE IF NOT EXISTS cyc_seed_saved_sets (version_set_id uuid PRIMARY KEY);
    INSERT INTO cyc_seed_saved_sets SELECT id FROM version_sets ON CONFLICT DO NOTHING;
    RAISE NOTICE 'Listed % club plans to mark saved', (SELECT count(*) FROM cyc_seed_saved_sets);
  END IF;

  IF to_regclass('version_set_members') IS NOT NULL THEN
    FOR item IN
      SELECT DISTINCT older.id FROM version_set_members m
        JOIN version_set_members other ON other.version_id = m.version_id AND other.id <> m.id
        JOIN version_sets older ON older.id = m.version_set_id
        JOIN version_sets newer ON newer.id = other.version_set_id
        WHERE (coalesce(older.saved_at, '-infinity'), older.id::text) < (coalesce(newer.saved_at, '-infinity'), newer.id::text)
    LOOP
      DELETE FROM version_set_members WHERE version_set_id = item.id;
      FOREACH t IN ARRAY ${array(RESULTS)} LOOP
        IF to_regclass(quote_ident(t)) IS NOT NULL THEN
          EXECUTE format('DELETE FROM %I WHERE version_set_id = $1', t) USING item.id;
        END IF;
      END LOOP;
      DELETE FROM version_sets WHERE id = item.id;
      RAISE NOTICE 'Deleted club plan %, which shared a version with a newer one', item.id;
    END LOOP;
  END IF;

  IF to_regclass('version_sets') IS NOT NULL AND to_regclass('version_set_activations') IS NULL THEN
    CREATE TABLE IF NOT EXISTS cyc_seed_active_sets (version_set_id uuid PRIMARY KEY);
    INSERT INTO cyc_seed_active_sets
      SELECT s.id FROM version_sets s
        WHERE (
          SELECT count(*) FROM version_sets o
            WHERE o.organization_id = s.organization_id AND o.fiscal_year = s.fiscal_year
        ) = 1
      ON CONFLICT DO NOTHING;
    FOR item IN
      SELECT organization_id, fiscal_year FROM version_sets
        GROUP BY organization_id, fiscal_year HAVING count(*) > 1
    LOOP
      RAISE NOTICE 'Marked no Financial Plan active for % %: it has more than one saved', item.organization_id, item.fiscal_year;
    END LOOP;
  END IF;

  FOREACH t IN ARRAY ${array(RESULTS)} LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND column_name = 'version_id'
    ) THEN
      EXECUTE format('DELETE FROM %I WHERE version_id IS NOT NULL', t);
      EXECUTE format('ALTER TABLE %I DROP COLUMN version_id', t);
      RAISE NOTICE 'Dropped the saved versions'' own results from %', t;
    END IF;
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_fields WHERE collection = t AND field = 'version_id';
      DELETE FROM directus_relations WHERE many_collection = t AND many_field = 'version_id';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plan_versions' AND column_name = 'operations_version_id'
  ) THEN
    ALTER TABLE plan_versions DROP COLUMN operations_version_id;
    RAISE NOTICE 'Dropped plan_versions.operations_version_id';
  END IF;
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields
      WHERE collection = 'plan_versions' AND field IN ('operations_version_id', 'results');
    DELETE FROM directus_relations WHERE many_collection = 'plan_versions' AND many_field = 'operations_version_id';
  END IF;

  FOREACH t IN ARRAY ${array(DROPPED)} LOOP
    IF to_regclass(quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('DROP TABLE %I', t);
      RAISE NOTICE 'Dropped %', t;
    END IF;
    -- Its permissions and default view are the backend stack's, which deletes them.
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_relations WHERE many_collection = t OR one_collection = t;
      DELETE FROM directus_fields WHERE collection = t;
      DELETE FROM directus_collections WHERE collection = t;
    END IF;
  END LOOP;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: what it drops was copied out before the deploy, and the schema no longer has it.
async function down() {}

module.exports = { up, down, RESULTS, DROPPED, SQL };
