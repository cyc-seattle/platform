// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// One kind of offering, in the catalog (cyc-seattle/platform#332). The CRM's `offerings`, which
// clubspot-sync made from each Clubspot class and session, become the catalog's: the table keeps its
// name and its rows' IDs, so registrations still point at the same rows. Each gets a name and a
// registration form, one for each Clubspot camp, and `catalog_offerings`, which nothing used, goes.
//
// The schema apply runs after this and refuses a column it didn't make without Directus's record of
// it, so this makes only the columns it fills, with their records, and the apply adds the rest.
// Deleting a Clubspot class or session now clears an offering's link instead of deleting it, and an
// offering with registrations can't be deleted.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once
// `catalog_offerings` is gone, or on a new database.

const SQL = `
DO $migration$
DECLARE
  unsorted integer;
BEGIN
  IF to_regclass('catalog_offerings') IS NULL OR to_regclass('offerings') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE registration_forms (
    id uuid PRIMARY KEY,
    name varchar(255) NOT NULL,
    clubspot_camp_id varchar(255)
      CONSTRAINT registration_forms_clubspot_camp_id_foreign REFERENCES clubspot_camps (id) ON DELETE SET NULL
  );
  ALTER TABLE offerings ADD COLUMN name varchar(255);
  ALTER TABLE offerings ADD COLUMN registration_form_id uuid
    CONSTRAINT offerings_registration_form_id_foreign REFERENCES registration_forms (id) ON DELETE RESTRICT;

  INSERT INTO registration_forms (id, name, clubspot_camp_id)
    SELECT gen_random_uuid(), camp.name, camp.id FROM clubspot_camps camp
    WHERE EXISTS (
      SELECT 1 FROM offerings JOIN clubspot_classes class ON class.id = offerings.clubspot_class_id
      WHERE class.camp_id = camp.id
    );
  UPDATE offerings SET
    registration_form_id = (
      SELECT form.id FROM clubspot_classes class JOIN registration_forms form ON form.clubspot_camp_id = class.camp_id
      WHERE class.id = offerings.clubspot_class_id
    ),
    name = COALESCE(
      (SELECT session.name FROM clubspot_sessions session WHERE session.id = offerings.clubspot_session_id),
      (SELECT class.name FROM clubspot_classes class WHERE class.id = offerings.clubspot_class_id)
    );
  SELECT count(*) INTO unsorted FROM offerings WHERE clubspot_class_id IS NOT NULL AND registration_form_id IS NULL;
  IF unsorted > 0 THEN
    RAISE EXCEPTION 'cyc0028: % offerings found no registration form', unsorted;
  END IF;

  INSERT INTO offerings (id, program_id, name) SELECT id, program_id, name FROM catalog_offerings;
  RAISE NOTICE 'cyc0028: % offerings, % registration forms', (SELECT count(*) FROM offerings),
    (SELECT count(*) FROM registration_forms);

  ALTER TABLE offerings DROP CONSTRAINT IF EXISTS offerings_clubspot_class_id_foreign;
  ALTER TABLE offerings ADD CONSTRAINT offerings_clubspot_class_id_foreign
    FOREIGN KEY (clubspot_class_id) REFERENCES clubspot_classes (id) ON DELETE SET NULL;
  ALTER TABLE offerings DROP CONSTRAINT IF EXISTS offerings_clubspot_session_id_foreign;
  ALTER TABLE offerings ADD CONSTRAINT offerings_clubspot_session_id_foreign
    FOREIGN KEY (clubspot_session_id) REFERENCES clubspot_sessions (id) ON DELETE SET NULL;
  ALTER TABLE offerings DROP CONSTRAINT IF EXISTS offerings_program_id_foreign;
  ALTER TABLE offerings ADD CONSTRAINT offerings_program_id_foreign
    FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE RESTRICT;
  ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_offering_id_foreign;
  ALTER TABLE registrations ADD CONSTRAINT registrations_offering_id_foreign
    FOREIGN KEY (offering_id) REFERENCES offerings (id) ON DELETE RESTRICT;
  -- A Clubspot registration entry finds one offering by its class and session.
  CREATE UNIQUE INDEX offerings_clubspot_class_session_unique
    ON offerings (clubspot_class_id, COALESCE(clubspot_session_id, ''))
    WHERE clubspot_class_id IS NOT NULL;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    INSERT INTO directus_collections (collection) VALUES ('registration_forms');
    INSERT INTO directus_fields (collection, field, special) VALUES
      ('registration_forms', 'id', 'uuid'),
      ('registration_forms', 'name', NULL),
      ('registration_forms', 'clubspot_camp_id', 'm2o'),
      ('offerings', 'name', NULL),
      ('offerings', 'registration_form_id', 'm2o');
    INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field) VALUES
      ('offerings', 'registration_form_id', 'registration_forms', 'offerings'),
      ('registration_forms', 'clubspot_camp_id', 'clubspot_camps', NULL);
    DELETE FROM directus_relations WHERE many_collection = 'catalog_offerings' OR one_collection = 'catalog_offerings';
    DELETE FROM directus_fields WHERE collection = 'catalog_offerings';
    DELETE FROM directus_permissions WHERE collection = 'catalog_offerings';
    DELETE FROM directus_presets WHERE collection = 'catalog_offerings';
    DELETE FROM directus_collections WHERE collection = 'catalog_offerings';
  END IF;
  DROP TABLE catalog_offerings;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: offerings made in the catalog since have no Clubspot class to go back to.
async function down() {}

module.exports = { up, down, SQL };
