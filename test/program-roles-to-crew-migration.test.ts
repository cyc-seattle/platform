import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0028-program-roles-to-crew.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const PERSON = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PROGRAM = "00000000-0000-4000-8000-000000000010";
const AREA = "00000000-0000-4000-8000-000000000020";
const COORDINATOR = "00000000-0000-4000-8000-000000000030";
const DIRECTOR = "00000000-0000-4000-8000-000000000031";
const COACH_POSITION = "00000000-0000-4000-8000-000000000040";

async function tables(db: PGlite) {
  const { rows } = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
  );
  return rows.map(({ table_name }) => table_name);
}

/** Directus's records, Crew's tables as PR 1 made them, and the program roles. */
const DIRECTUS_AND_CREW = `
  CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
  CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
  CREATE TABLE directus_relations (
    id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64)
  );
  CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64));
  CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64));
  CREATE TABLE people (id uuid PRIMARY KEY);
  CREATE TABLE programs (id uuid PRIMARY KEY);
  CREATE TABLE program_areas (id uuid PRIMARY KEY);
  CREATE TABLE crew_members (
    id uuid PRIMARY KEY, person_id uuid NOT NULL UNIQUE REFERENCES people (id),
    on_website boolean NOT NULL DEFAULT false
  );
  CREATE TABLE crew_positions (id uuid PRIMARY KEY, name varchar(255) NOT NULL, description text);
  CREATE TABLE crew_terms (
    id uuid PRIMARY KEY, crew_member_id uuid NOT NULL REFERENCES crew_members (id),
    position_id uuid NOT NULL REFERENCES crew_positions (id), program_id uuid REFERENCES programs (id),
    program_area_id uuid REFERENCES program_areas (id), starts_on date, ends_on date,
    profit_share boolean NOT NULL DEFAULT false
  );
`;

async function withProgramRoles() {
  const db = await PGlite.create();
  await db.exec(`
    ${DIRECTUS_AND_CREW}
    CREATE TABLE program_roles (id uuid PRIMARY KEY, name varchar(255), description text);
    CREATE TABLE program_role_assignments (
      id uuid PRIMARY KEY, person_id uuid NOT NULL REFERENCES people (id),
      program_id uuid NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
      program_role_id uuid NOT NULL REFERENCES program_roles (id) ON DELETE CASCADE,
      starts_on date, ends_on date
    );
    CREATE TABLE program_area_role_assignments (
      id uuid PRIMARY KEY, person_id uuid NOT NULL REFERENCES people (id),
      program_area_id uuid NOT NULL REFERENCES program_areas (id) ON DELETE CASCADE,
      program_role_id uuid NOT NULL REFERENCES program_roles (id) ON DELETE CASCADE,
      starts_on date, ends_on date
    );
    INSERT INTO people VALUES ('${PERSON}'), ('${OTHER}');
    INSERT INTO programs VALUES ('${PROGRAM}');
    INSERT INTO program_areas VALUES ('${AREA}');
    INSERT INTO program_roles VALUES
      ('${COORDINATOR}', 'Parent Coordinator', 'Helps the team''s families.'),
      ('${DIRECTOR}', 'Director', null);
    -- The other person is on Crew already, as Head Coach, so they keep their crew member.
    INSERT INTO crew_positions VALUES ('${COACH_POSITION}', 'Head Coach', null);
    INSERT INTO crew_members (id, person_id) VALUES ('00000000-0000-4000-8000-000000000050', '${OTHER}');
    INSERT INTO program_role_assignments VALUES
      ('00000000-0000-4000-8000-000000000100', '${PERSON}', '${PROGRAM}', '${COORDINATOR}', null, null),
      ('00000000-0000-4000-8000-000000000101', '${OTHER}', '${PROGRAM}', '${COORDINATOR}', '2025-09-01', '2026-06-30');
    INSERT INTO program_area_role_assignments VALUES
      ('00000000-0000-4000-8000-000000000200', '${PERSON}', '${AREA}', '${DIRECTOR}', '2026-01-01', null);
    INSERT INTO directus_collections VALUES ('program_roles'), ('program_role_assignments'),
      ('program_area_role_assignments'), ('programs'), ('crew_terms');
    INSERT INTO directus_fields (collection, field) VALUES
      ('program_role_assignments', 'person_id'), ('programs', 'role_assignments'),
      ('program_areas', 'role_assignments'), ('programs', 'name');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('program_role_assignments', 'program_id', 'programs'), ('crew_terms', 'program_id', 'programs');
    INSERT INTO directus_permissions (collection) VALUES ('program_role_assignments'), ('programs');
    INSERT INTO directus_presets (collection) VALUES ('program_roles');
  `);
  return db;
}

async function terms(db: PGlite) {
  const { rows } = await db.query(`
    SELECT term.id, person_id, position.name AS position, program_id, program_area_id,
      starts_on::text, ends_on::text
    FROM crew_terms term
    JOIN crew_members member ON member.id = term.crew_member_id
    JOIN crew_positions position ON position.id = term.position_id
    ORDER BY term.id`);
  return rows;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the program roles to Crew migration", { timeout: 30_000 }, () => {
  it("copies each assignment into a term, in its program or area, with its dates", async () => {
    const db = await withProgramRoles();
    await migrate(db);
    expect(await terms(db)).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000100",
        person_id: PERSON,
        position: "Parent Coordinator",
        program_id: PROGRAM,
        program_area_id: null,
        starts_on: null,
        ends_on: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000101",
        person_id: OTHER,
        position: "Parent Coordinator",
        program_id: PROGRAM,
        program_area_id: null,
        starts_on: "2025-09-01",
        ends_on: "2026-06-30",
      },
      {
        id: "00000000-0000-4000-8000-000000000200",
        person_id: PERSON,
        position: "Director",
        program_id: null,
        program_area_id: AREA,
        starts_on: "2026-01-01",
        ends_on: null,
      },
    ]);
  });

  it("makes one general position per role, with its description, and keeps one already named the same", async () => {
    const db = await withProgramRoles();
    await db.exec(`INSERT INTO crew_positions VALUES (gen_random_uuid(), 'parent coordinator', 'Ours.')`);
    await migrate(db);
    const { rows } = await db.query("SELECT name, description FROM crew_positions ORDER BY name");
    expect(rows).toEqual([
      { name: "Director", description: null },
      { name: "Head Coach", description: null },
      { name: "parent coordinator", description: "Ours." },
    ]);
  });

  it("makes each person a crew member once, off the website, and keeps an existing one", async () => {
    const db = await withProgramRoles();
    await migrate(db);
    const { rows } = await db.query("SELECT id, person_id, on_website FROM crew_members ORDER BY person_id");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ id: "00000000-0000-4000-8000-000000000050", person_id: OTHER, on_website: false });
    expect(rows[0]).toMatchObject({ person_id: PERSON, on_website: false });
  });

  it("drops the program roles and Directus's records of them, and nothing else", async () => {
    const db = await withProgramRoles();
    await migrate(db);
    await migrate(db);
    const remaining = await tables(db);
    for (const table of ["program_roles", "program_role_assignments", "program_area_role_assignments"]) {
      expect(remaining).not.toContain(table);
    }
    const left = async (sql: string) => (await db.query(sql)).rows;
    expect(await left("SELECT collection FROM directus_collections ORDER BY collection")).toEqual([
      { collection: "crew_terms" },
      { collection: "programs" },
    ]);
    expect(await left("SELECT collection, field FROM directus_fields")).toEqual([
      { collection: "programs", field: "name" },
    ]);
    expect(await left("SELECT many_collection FROM directus_relations")).toEqual([{ many_collection: "crew_terms" }]);
    expect(await left("SELECT collection FROM directus_permissions")).toEqual([{ collection: "programs" }]);
    expect(await left("SELECT collection FROM directus_presets")).toEqual([]);
  });

  it("treats program roles named the same, whatever their case, as one position", async () => {
    const db = await withProgramRoles();
    await db.exec(`
      INSERT INTO program_roles VALUES ('00000000-0000-4000-8000-000000000032', 'PARENT COORDINATOR', null);
      INSERT INTO program_role_assignments VALUES
        ('00000000-0000-4000-8000-000000000102', '${PERSON}', '${PROGRAM}', '00000000-0000-4000-8000-000000000032', null, null);
    `);
    await migrate(db);
    const { rows } = await db.query<{ name: string }>("SELECT name FROM crew_positions ORDER BY name");
    expect(rows.map(({ name }) => name)).toEqual(["Director", "Head Coach", "Parent Coordinator"]);
    const positions = await db.query("SELECT DISTINCT position_id FROM crew_terms WHERE program_id IS NOT NULL");
    expect(positions.rows).toHaveLength(1);
  });

  it("refuses, changing nothing, when there are assignments to copy but Crew's tables don't exist", async () => {
    const db = await PGlite.create();
    await db.exec(`
      CREATE TABLE people (id uuid PRIMARY KEY);
      CREATE TABLE program_roles (id uuid PRIMARY KEY, name varchar(255), description text);
      CREATE TABLE program_role_assignments (
        id uuid PRIMARY KEY, person_id uuid, program_id uuid, program_role_id uuid, starts_on date, ends_on date
      );
      CREATE TABLE program_area_role_assignments (id uuid PRIMARY KEY);
      INSERT INTO program_role_assignments VALUES ('00000000-0000-4000-8000-000000000100', '${PERSON}', null, null, null, null);
    `);
    await expect(migrate(db)).rejects.toThrow(/Crew's tables don't exist yet/);
    expect(await tables(db)).toEqual([
      "people",
      "program_area_role_assignments",
      "program_role_assignments",
      "program_roles",
    ]);
  });

  it("drops empty program roles even before Crew exists, and does nothing on a new database", async () => {
    const before = await PGlite.create();
    await before.exec(`
      CREATE TABLE program_roles (id uuid PRIMARY KEY, name varchar(255), description text);
      CREATE TABLE program_role_assignments (id uuid PRIMARY KEY);
      CREATE TABLE program_area_role_assignments (id uuid PRIMARY KEY);
    `);
    await migrate(before);
    expect(await tables(before)).toEqual([]);

    const fresh = await PGlite.create();
    await migrate(fresh);
    expect(await tables(fresh)).toEqual([]);
  });
});
