// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// An offering belongs to a product, not a program, so charters and storage can have offerings too
// (cyc-seattle/platform#395). Each offering's `product_id` is its program's product, and
// `program_id` goes. The schema apply refuses a column it didn't make without Directus's record of
// it, so this adds the field's and the link's records too.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once `program_id` is
// gone, or on a new database.

const SQL = `
DO $migration$
DECLARE
  unmatched integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'offerings' AND column_name = 'program_id'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE offerings ADD COLUMN product_id uuid
    CONSTRAINT offerings_product_id_foreign REFERENCES products (id) ON DELETE RESTRICT;
  UPDATE offerings SET product_id = (SELECT program.product_id FROM programs program WHERE program.id = offerings.program_id);
  SELECT count(*) INTO unmatched FROM offerings WHERE product_id IS NULL;
  IF unmatched > 0 THEN
    RAISE EXCEPTION 'cyc0030: % offerings have a program with no product', unmatched;
  END IF;
  ALTER TABLE offerings ALTER COLUMN product_id SET NOT NULL;
  ALTER TABLE offerings DROP COLUMN program_id;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE many_collection = 'offerings' AND many_field = 'program_id';
    DELETE FROM directus_fields WHERE collection = 'offerings' AND field = 'program_id';
    INSERT INTO directus_fields (collection, field, special) VALUES ('offerings', 'product_id', 'm2o');
    INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field) VALUES
      ('offerings', 'product_id', 'products', NULL);
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: an offering of a product that isn't a program has no program to go back to.
async function down() {}

module.exports = { up, down, SQL };
