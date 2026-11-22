// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Program roles become Crew (cyc-seattle/platform#263). Each program role becomes a position, or
// joins the position already named the same. Each person with an assignment becomes a crew member,
// off the website, unless they're one already. Each assignment becomes a term with its own id, in
// its program or program area, with its dates. Then it drops the three collections and Directus's
// records of them, since the schema apply never deletes. It fails, changing nothing, if any
// assignment didn't copy.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once the assignments
// are gone, or before Crew exists, or on a new database.

const SQL = `
DO $migration$
DECLARE
  dropped text[] := ARRAY['program_role_assignments', 'program_area_role_assignments', 'program_roles'];
  assigned integer;
  copied integer;
BEGIN
  IF to_regclass('program_role_assignments') IS NULL OR to_regclass('crew_terms') IS NULL THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE role_positions ON COMMIT DROP AS
    SELECT role.id AS role_id, role.name, role.description,
      COALESCE(
        (SELECT position.id FROM crew_positions position
          WHERE lower(position.name) = lower(role.name) ORDER BY position.id LIMIT 1),
        gen_random_uuid()
      ) AS position_id
    FROM program_roles role;
  INSERT INTO crew_positions (id, name, description)
    SELECT position_id, name, description FROM role_positions
    WHERE NOT EXISTS (SELECT 1 FROM crew_positions position WHERE position.id = role_positions.position_id);

  INSERT INTO crew_members (id, person_id, on_website)
    SELECT gen_random_uuid(), person_id, false FROM (
      SELECT person_id FROM program_role_assignments
      UNION SELECT person_id FROM program_area_role_assignments
    ) assigned_people
    WHERE NOT EXISTS (SELECT 1 FROM crew_members member WHERE member.person_id = assigned_people.person_id);

  INSERT INTO crew_terms (id, crew_member_id, position_id, program_id, starts_on, ends_on)
    SELECT assignment.id, member.id, role.position_id, assignment.program_id, assignment.starts_on, assignment.ends_on
    FROM program_role_assignments assignment
    JOIN crew_members member ON member.person_id = assignment.person_id
    JOIN role_positions role ON role.role_id = assignment.program_role_id
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO crew_terms (id, crew_member_id, position_id, program_area_id, starts_on, ends_on)
    SELECT assignment.id, member.id, role.position_id, assignment.program_area_id, assignment.starts_on, assignment.ends_on
    FROM program_area_role_assignments assignment
    JOIN crew_members member ON member.person_id = assignment.person_id
    JOIN role_positions role ON role.role_id = assignment.program_role_id
    ON CONFLICT (id) DO NOTHING;

  SELECT (SELECT count(*) FROM program_role_assignments) + (SELECT count(*) FROM program_area_role_assignments)
    INTO assigned;
  SELECT count(*) INTO copied FROM crew_terms
    WHERE id IN (SELECT id FROM program_role_assignments UNION SELECT id FROM program_area_role_assignments);
  IF copied <> assigned THEN
    RAISE EXCEPTION 'cyc0028: copied % of % program role assignments to Crew', copied, assigned;
  END IF;
  RAISE NOTICE 'cyc0028: copied % program role assignments to Crew', copied;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
  IF to_regclass('directus_relations') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE many_collection = ANY (dropped) OR one_collection = ANY (dropped);
    DELETE FROM directus_fields WHERE collection = ANY (dropped)
      OR (collection IN ('programs', 'program_areas') AND field = 'role_assignments');
    DELETE FROM directus_permissions WHERE collection = ANY (dropped);
    DELETE FROM directus_presets WHERE collection = ANY (dropped);
    DELETE FROM directus_collections WHERE collection = ANY (dropped);
  END IF;
  DROP TABLE program_role_assignments, program_area_role_assignments, program_roles;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: Crew's terms are edited from here on, and the old collections are gone from the schema.
async function down() {}

module.exports = { up, down, SQL };
