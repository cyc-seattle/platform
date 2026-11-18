// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// A person can have more than one login (cyc-seattle/platform#329): the link moves from
// people.directus_user_id to directus_users.person_id. The schema apply runs after this and can't
// make a column it would then fill, so this makes the column, its foreign key, and Directus's record
// of both, for the apply to finish. Then it copies each link, and fails, changing nothing, if any
// didn't copy. The old field stays until a later release, since the rules that read it change only
// after Directus starts.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once person_id
// exists, or on a new database.

const SQL = `
DO $migration$
DECLARE
  linked integer;
  copied integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'people' AND column_name = 'directus_user_id'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'directus_users' AND column_name = 'person_id'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE directus_users ADD COLUMN person_id uuid;
  ALTER TABLE directus_users ADD CONSTRAINT directus_users_person_id_foreign
    FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE SET NULL;

  UPDATE directus_users login SET person_id = person.id
    FROM people person WHERE person.directus_user_id = login.id;
  SELECT count(*) INTO linked FROM people WHERE directus_user_id IS NOT NULL;
  SELECT count(*) INTO copied FROM people person
    JOIN directus_users login ON login.id = person.directus_user_id AND login.person_id = person.id;
  IF copied <> linked THEN
    RAISE EXCEPTION 'cyc0026: copied % of % logins to their people', copied, linked;
  END IF;
  RAISE NOTICE 'cyc0026: copied % logins to their people', copied;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    INSERT INTO directus_fields (collection, field, special) VALUES ('directus_users', 'person_id', 'm2o');
  END IF;
  IF to_regclass('directus_relations') IS NOT NULL THEN
    INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_deselect_action)
      VALUES ('directus_users', 'person_id', 'people', 'logins', 'nullify');
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: a person may have several logins by then, which the old field can't hold.
async function down() {}

module.exports = { up, down, SQL };
