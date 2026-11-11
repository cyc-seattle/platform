// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Drops five planning fields nothing reads (cyc-seattle/sail-team#73), with their Directus metadata
// and plans' archive setting. The schema apply never deletes a field, so this does, and the apply
// finds nothing left to do. A saved Financial Plan's copies lose them too, which the engine never
// read. It does nothing where they're already gone.

/** Each dropped field, by table. */
const DROPPED = {
  plans: ["archived"],
  plan_offerings: ["catalog_offering_id"],
  plan_staff_levels: ["qualifications"],
  plan_salaried_positions: ["qualifications", "form_990_line"],
};

const pairs = Object.entries(DROPPED).flatMap(([table, fields]) => fields.map((field) => `('${table}', '${field}')`));
const drops = Object.entries(DROPPED).flatMap(([table, fields]) => [
  `  IF to_regclass('${table}') IS NOT NULL THEN`,
  ...fields.map((field) => `    ALTER TABLE ${table} DROP COLUMN IF EXISTS ${field};`),
  "  END IF;",
]);

const SQL = `
DO $migration$
BEGIN
  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE (many_collection, many_field) IN (${pairs.join(", ")});
    DELETE FROM directus_fields WHERE (collection, field) IN (${pairs.join(", ")});
    UPDATE directus_collections SET archive_field = NULL, archive_value = NULL, unarchive_value = NULL
      WHERE collection = 'plans' AND archive_field = 'archived';
  END IF;
${drops.join("\n")}
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the fields are gone from the schema.
async function down() {}

module.exports = { up, down, SQL, DROPPED };
