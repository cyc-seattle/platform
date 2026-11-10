// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Makes the Website files folder, which holds the public website's images (cyc-seattle/platform#150).
// Its ID is fixed, because the csc-website build's policy reads only the files in it, and the image
// fields in schemas/website.yaml upload into it. It does nothing if the folder is there, or if
// Directus has no folders table yet.

const WEBSITE_FOLDER = "1dac44d4-d8ae-4ad1-9e11-f6b4da138a19";

const SQL = `
DO $migration$
BEGIN
  IF to_regclass('directus_folders') IS NOT NULL THEN
    INSERT INTO directus_folders (id, name, parent) VALUES ('${WEBSITE_FOLDER}', 'Website', NULL)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// The folder stays: its files would be left in no folder, where the build can't read them.
async function down() {}

module.exports = { up, down, WEBSITE_FOLDER, SQL };
