// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Undoes what an earlier cyc0008 did on dev (cyc-seattle/platform#128): it added organizations.kind
// before the schema apply, which then failed creating the field Directus didn't know. The apply now
// creates kind itself, its default filling in existing rows, so this drops a kind column Directus has
// no field for. Once the apply has made the field, it leaves the column alone.

const SQL = `
DO $migration$
BEGIN
  -- Nested, because PL/pgSQL prepares an expression only when it reaches it, and a new database
  -- has no directus_fields.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'organizations' AND column_name = 'kind'
  ) THEN
    IF to_regclass('directus_fields') IS NULL THEN
      ALTER TABLE organizations DROP COLUMN kind;
    ELSIF NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'organizations' AND field = 'kind') THEN
      ALTER TABLE organizations DROP COLUMN kind;
    END IF;
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the apply makes the column.
async function down() {}

module.exports = { up, down, SQL };
