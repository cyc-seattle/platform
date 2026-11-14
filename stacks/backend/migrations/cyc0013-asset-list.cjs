// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Planning counts boats from the asset list, and prices them by boat class, not from quantities and
// equipment in the Operations Plan (cyc-seattle/platform#126). The schema apply never deletes or
// renames, so this:
// - drops the catalog's old boat list, which had no asset. Prod's is empty. It refuses to run while
//   the old list has rows, so none is lost. The new boats reuse its name, permissions and view.
// - drops plan_boat_rates.quantity, which saved copies lose too.
// - renames boat_classes.sailors_per_boat to max_capacity, keeping its values, and adds the powerboat
//   classes RIB and Support, which carry no sailors. It lists them in cyc_seed_powerboat_classes, for
//   the saved-versions hook to book their upkeep to the Coach boats account once the apply adds it.
// - drops the plan's equipment (plan_resources, plan_block_resources), resource_kinds, and
//   plan_rates.rib_resource_kind_id. Before it does, it copies each draft's coach boats, the
//   resources of its rates' coach-boat kind, into cyc_seed_coach_boats and their blocks' uses into
//   cyc_seed_coach_boat_uses, for the saved-versions hook to move into RIB boat rates and block boats
//   once the schema apply has added their new fields. Saved Financial Plans keep their results.
// It's one statement, so Postgres runs it in one transaction. It skips what's already done, so
// it's safe to run again and does nothing on a new database.

/** Each dropped field, by table. */
const DROPPED = {
  plan_boat_rates: ["quantity"],
};

/** Each dropped table. */
const TABLES = ["plan_block_resources", "plan_resources", "resource_kinds"];

/** The powerboat classes every boat rate and block can name. */
const POWERBOAT_CLASSES = ["RIB", "Support"];

const pairs = Object.entries(DROPPED).flatMap(([table, fields]) => fields.map((field) => `('${table}', '${field}')`));
const drops = Object.entries(DROPPED).flatMap(([table, fields]) => [
  `  IF to_regclass('${table}') IS NOT NULL THEN`,
  ...fields.map((field) => `    ALTER TABLE ${table} DROP COLUMN IF EXISTS ${field};`),
  "  END IF;",
]);
const list = (names) => names.map((name) => `'${name}'`).join(", ");

const SQL = `
DO $migration$
DECLARE
  used boolean;
  dropped integer;
BEGIN
  -- The old boat list has no asset.
  IF to_regclass('boats') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'boats' AND column_name = 'asset_id'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM boats)' INTO used;
    IF used THEN
      RAISE EXCEPTION 'boats still holds the old boat list. Move its rows into assets and boats first.';
    END IF;
    -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
    -- Directus has none of its tables.
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_relations WHERE many_collection = 'boats' OR one_collection = 'boats';
      DELETE FROM directus_fields WHERE collection = 'boats';
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
    WHERE table_schema = current_schema() AND table_name = 'boat_classes' AND column_name = 'sailors_per_boat'
  ) THEN
    ALTER TABLE boat_classes RENAME COLUMN sailors_per_boat TO max_capacity;
    IF to_regclass('directus_fields') IS NOT NULL THEN
      UPDATE directus_fields SET field = 'max_capacity'
        WHERE collection = 'boat_classes' AND field = 'sailors_per_boat';
    END IF;
  END IF;
  IF to_regclass('boat_classes') IS NOT NULL THEN
    INSERT INTO boat_classes (id, name, max_capacity)
      SELECT gen_random_uuid(), n.name, 0 FROM unnest(ARRAY[${list(POWERBOAT_CLASSES)}]) AS n (name)
        WHERE NOT EXISTS (SELECT 1 FROM boat_classes c WHERE lower(c.name) = lower(n.name));
    CREATE TABLE IF NOT EXISTS cyc_seed_powerboat_classes AS
      SELECT id FROM boat_classes WHERE lower(name) IN (${list(POWERBOAT_CLASSES.map((name) => name.toLowerCase()))});
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plan_rates' AND column_name = 'rib_resource_kind_id'
  ) THEN
    CREATE TABLE IF NOT EXISTS cyc_seed_coach_boats AS
      SELECT m.version_set_id AS set_id, r.version_id, r.key, NOT r.excluded_from_mtdc AS owned,
        coalesce(r.fuel_per_hour_cents, 0) AS fuel_per_hour_cents,
        coalesce(r.cost_per_hour_cents, 0) + coalesce(r.maintenance_per_hour_cents, 0) AS upkeep_per_hour_cents,
        r.cost_per_day_cents
        FROM plan_resources r
        JOIN plan_rates rt ON rt.version_id = r.version_id AND rt.rib_resource_kind_id = r.resource_kind_id
        JOIN version_set_members m ON m.version_id = r.version_id
        JOIN version_sets s ON s.id = m.version_set_id AND s.status = 'draft';
    CREATE TABLE IF NOT EXISTS cyc_seed_coach_boat_uses AS
      SELECT k.set_id, u.version_id, u.block_id, k.owned, sum(u.quantity) AS quantity
        FROM plan_block_resources u
        JOIN version_set_members m ON m.version_id = u.version_id
        JOIN cyc_seed_coach_boats k ON k.set_id = m.version_set_id AND k.key = u.resource_key
        GROUP BY k.set_id, u.version_id, u.block_id, k.owned;
    SELECT count(*) INTO dropped FROM plan_resources r
      WHERE NOT EXISTS (SELECT 1 FROM cyc_seed_coach_boats k WHERE k.version_id = r.version_id AND k.key = r.key);
    RAISE NOTICE 'Dropped % plan resources that aren''t a draft''s coach boats', dropped;
    IF to_regclass('directus_fields') IS NOT NULL THEN
      DELETE FROM directus_relations WHERE many_collection = 'plan_rates' AND many_field = 'rib_resource_kind_id';
      DELETE FROM directus_fields WHERE collection = 'plan_rates' AND field = 'rib_resource_kind_id';
    END IF;
    ALTER TABLE plan_rates DROP COLUMN rib_resource_kind_id;
  END IF;

  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_relations
      WHERE many_collection IN (${list(TABLES)}) OR one_collection IN (${list(TABLES)});
    DELETE FROM directus_fields WHERE collection IN (${list(TABLES)});
    DELETE FROM directus_permissions WHERE collection IN (${list(TABLES)});
    DELETE FROM directus_presets WHERE collection IN (${list(TABLES)});
    DELETE FROM directus_collections WHERE collection IN (${list(TABLES)});
  END IF;
  DROP TABLE IF EXISTS ${TABLES.join(", ")};
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the old fields and tables are gone from the schema.
async function down() {}

module.exports = { up, down, SQL, DROPPED, TABLES };
