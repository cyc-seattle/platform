// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// The directory (cyc-seattle/platform#128) gives organizations a required kind. Every organization
// before it was our own, so this adds the column and marks them `own` before the schema apply makes
// it NOT NULL, which would fail on a row without one. It does nothing without an organizations table.

const SQL = `
DO $migration$
BEGIN
  IF to_regclass('organizations') IS NOT NULL THEN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kind varchar(255);
    UPDATE organizations SET kind = 'own' WHERE kind IS NULL;
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// The column stays: the schema apply owns it from here.
async function down() {}

module.exports = { up, down, SQL };
