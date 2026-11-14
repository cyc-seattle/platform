// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Planning counts boats from the asset list, not from quantities in the Operations Plan
// (cyc-seattle/platform#126). The schema apply never deletes or renames, so this:
// - drops the catalog's old boat list, which the asset list replaces, with Directus's records of it.
//   Prod's is empty. It refuses to run while the old list has rows, so none is lost.
// - drops plan_boat_rates.quantity and plan_resources.quantity, which saved copies lose too.
// - renames boat_classes.sailors_per_boat to max_capacity, keeping its values.
// - drops plan_rates.rib_resource_kind_id: blocks now count powerboats, at one hourly rate. It first
//   lists each copy's coach-boat kind in cyc_seed_powerboats, so the saved-versions hook can move
//   drafts' coach boats into their blocks' powerboats once the schema apply has added them.
// It's one statement, so Postgres runs it in one transaction. It skips what's already done, so
// it's safe to run again and does nothing on a new database.

/** Each dropped field, by table. */
const DROPPED = {
  plan_boat_rates: ["quantity"],
  plan_resources: ["quantity"],
};

const pairs = Object.entries(DROPPED).flatMap(([table, fields]) => fields.map((field) => `('${table}', '${field}')`));
const drops = Object.entries(DROPPED).flatMap(([table, fields]) => [
  `  IF to_regclass('${table}') IS NOT NULL THEN`,
  ...fields.map((field) => `    ALTER TABLE ${table} DROP COLUMN IF EXISTS ${field};`),
  "  END IF;",
]);

const SQL = `
DO $migration$
DECLARE
  used boolean;
BEGIN
  IF to_regclass('boats') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM boats)' INTO used;
    IF used THEN
      RAISE EXCEPTION 'boats still holds the old boat list. Move its rows into assets, boats and sailboats first.';
    END IF;
    -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
    -- Directus has none of its tables.
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_relations WHERE many_collection = 'boats' OR one_collection = 'boats';
      DELETE FROM directus_fields WHERE collection = 'boats';
      DELETE FROM directus_permissions WHERE collection = 'boats';
      DELETE FROM directus_presets WHERE collection = 'boats';
      DELETE FROM directus_collections WHERE collection = 'boats';
    END IF;
    DROP TABLE boats;
  END IF;

  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_fields WHERE (collection, field) IN (${pairs.join(", ")});
  END IF;
${drops.join("\n")}

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plan_rates' AND column_name = 'rib_resource_kind_id'
  ) THEN
    CREATE TABLE IF NOT EXISTS cyc_seed_powerboats AS
      SELECT version_id, rib_resource_kind_id AS resource_kind_id FROM plan_rates
        WHERE rib_resource_kind_id IS NOT NULL;
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_relations WHERE many_collection = 'plan_rates' AND many_field = 'rib_resource_kind_id';
      DELETE FROM directus_fields WHERE collection = 'plan_rates' AND field = 'rib_resource_kind_id';
    END IF;
    ALTER TABLE plan_rates DROP COLUMN rib_resource_kind_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'boat_classes' AND column_name = 'sailors_per_boat'
  ) THEN
    ALTER TABLE boat_classes RENAME COLUMN sailors_per_boat TO max_capacity;
    IF to_regclass('directus_fields') IS NOT NULL THEN
      UPDATE directus_fields SET field = 'max_capacity'
        WHERE collection = 'boat_classes' AND field = 'sailors_per_boat';
    END IF;
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the old fields are gone from the schema.
async function down() {}

module.exports = { up, down, SQL, DROPPED };
