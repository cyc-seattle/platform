import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0028-one-offerings.cjs";

// The CRM's offerings becoming the catalog's, in a real Postgres (PGlite), with Directus's own tables cut
// down to the columns the migration touches.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64), special varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64),
      one_field varchar(64)
    );
    CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE programs (id uuid PRIMARY KEY);
    CREATE TABLE people (id uuid PRIMARY KEY);
    CREATE TABLE clubspot_camps (id varchar(255) PRIMARY KEY, name varchar(255));
    CREATE TABLE clubspot_classes (id varchar(255) PRIMARY KEY, camp_id varchar(255) REFERENCES clubspot_camps (id), name varchar(255));
    CREATE TABLE clubspot_sessions (id varchar(255) PRIMARY KEY, camp_id varchar(255) REFERENCES clubspot_camps (id), name varchar(255));
    CREATE TABLE offerings (
      id uuid PRIMARY KEY,
      program_id uuid NOT NULL CONSTRAINT offerings_program_id_foreign REFERENCES programs (id) ON DELETE CASCADE,
      starts_on date, ends_on date, capacity integer,
      clubspot_class_id varchar(255) NOT NULL CONSTRAINT offerings_clubspot_class_id_foreign REFERENCES clubspot_classes (id) ON DELETE CASCADE,
      clubspot_session_id varchar(255) CONSTRAINT offerings_clubspot_session_id_foreign REFERENCES clubspot_sessions (id) ON DELETE CASCADE
    );
    CREATE TABLE registrations (
      id uuid PRIMARY KEY, person_id uuid REFERENCES people (id),
      offering_id uuid NOT NULL CONSTRAINT registrations_offering_id_foreign REFERENCES offerings (id) ON DELETE CASCADE
    );
    CREATE TABLE catalog_offerings (
      id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES programs (id), name varchar(255)
    );
    INSERT INTO directus_collections VALUES ('offerings'), ('registrations'), ('catalog_offerings');
    INSERT INTO directus_fields (collection, field) VALUES ('catalog_offerings', 'id'), ('catalog_offerings', 'name');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('catalog_offerings', 'program_id', 'programs'), ('registrations', 'offering_id', 'offerings');
    INSERT INTO directus_permissions (collection) VALUES ('catalog_offerings'), ('offerings');
    INSERT INTO directus_presets (collection) VALUES ('catalog_offerings');

    INSERT INTO programs VALUES ('${id(1)}'), ('${id(2)}');
    INSERT INTO people VALUES ('${id(3)}');
    INSERT INTO clubspot_camps VALUES ('summer', '2026 Summer Sailing Camps'), ('fall', '2026 Fall Doublehanded Race Team'),
      ('empty', 'A camp with no offerings');
    INSERT INTO clubspot_classes VALUES ('guppies', 'summer', 'Guppies Sailing'), ('jpod', 'fall', 'J Pod (Advanced)');
    INSERT INTO clubspot_sessions VALUES ('week1', 'summer', 'Week 1'), ('week2', 'summer', 'Week 2'), ('fall', 'fall', 'Fall');
    INSERT INTO offerings VALUES
      ('${id(11)}', '${id(1)}', '2026-06-22', '2026-06-26', 12, 'guppies', 'week1'),
      ('${id(12)}', '${id(1)}', '2026-06-29', '2026-07-03', 12, 'guppies', 'week2'),
      ('${id(13)}', '${id(2)}', '2026-09-08', '2026-11-01', 15, 'jpod', NULL);
    INSERT INTO registrations VALUES ('${id(21)}', '${id(3)}', '${id(11)}');
    INSERT INTO catalog_offerings VALUES ('${id(31)}', '${id(2)}', 'fall practices');
  `);
  return db;
}

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the one offerings migration", { timeout: 30_000 }, () => {
  it("keeps every offering under its ID, with a name and its camp's registration form", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect(
      await rows(
        db,
        `SELECT o.id, o.name, f.name AS form, f.clubspot_camp_id AS camp
           FROM offerings o LEFT JOIN registration_forms f ON f.id = o.registration_form_id ORDER BY o.id`,
      ),
    ).toEqual([
      { id: id(11), name: "Week 1", form: "2026 Summer Sailing Camps", camp: "summer" },
      { id: id(12), name: "Week 2", form: "2026 Summer Sailing Camps", camp: "summer" },
      { id: id(13), name: "J Pod (Advanced)", form: "2026 Fall Doublehanded Race Team", camp: "fall" },
      { id: id(31), name: "fall practices", form: null, camp: null },
    ]);
    expect(await rows(db, "SELECT name FROM registration_forms ORDER BY name")).toEqual([
      { name: "2026 Fall Doublehanded Race Team" },
      { name: "2026 Summer Sailing Camps" },
    ]);
    expect(await rows(db, "SELECT offering_id FROM registrations")).toEqual([{ offering_id: id(11) }]);
  });

  it("drops catalog_offerings and everything Directus recorded of it, and records the new fields", async () => {
    const db = await database();
    await up(knex(db));
    expect(await rows(db, "SELECT to_regclass('catalog_offerings') AS t")).toEqual([{ t: null }]);
    expect(await rows(db, "SELECT collection FROM directus_collections ORDER BY collection")).toEqual([
      { collection: "offerings" },
      { collection: "registration_forms" },
      { collection: "registrations" },
    ]);
    expect(await rows(db, "SELECT collection, field, special FROM directus_fields ORDER BY id")).toEqual([
      { collection: "registration_forms", field: "id", special: "uuid" },
      { collection: "registration_forms", field: "name", special: null },
      { collection: "registration_forms", field: "clubspot_camp_id", special: "m2o" },
      { collection: "offerings", field: "name", special: null },
      { collection: "offerings", field: "registration_form_id", special: "m2o" },
    ]);
    expect(
      await rows(
        db,
        "SELECT many_collection, many_field, one_collection, one_field FROM directus_relations ORDER BY id",
      ),
    ).toEqual([
      { many_collection: "registrations", many_field: "offering_id", one_collection: "offerings", one_field: null },
      {
        many_collection: "offerings",
        many_field: "registration_form_id",
        one_collection: "registration_forms",
        one_field: "offerings",
      },
      {
        many_collection: "registration_forms",
        many_field: "clubspot_camp_id",
        one_collection: "clubspot_camps",
        one_field: null,
      },
    ]);
    expect(await rows(db, "SELECT collection FROM directus_permissions")).toEqual([{ collection: "offerings" }]);
    expect(await rows(db, "SELECT collection FROM directus_presets")).toEqual([]);
  });

  it("unlinks an offering whose Clubspot session or class is deleted, so a week never reads as the whole class", async () => {
    const db = await database();
    await up(knex(db));
    await db.exec("DELETE FROM clubspot_sessions WHERE id = 'week2'");
    expect(
      await rows(db, `SELECT clubspot_class_id, clubspot_session_id FROM offerings WHERE id = '${id(12)}'`),
    ).toEqual([{ clubspot_class_id: null, clubspot_session_id: null }]);
    await db.exec("DELETE FROM clubspot_sessions WHERE id = 'week1'");
    await db.exec("DELETE FROM clubspot_classes WHERE id = 'jpod'");
    expect(await rows(db, "SELECT id, clubspot_class_id, clubspot_session_id FROM offerings ORDER BY id")).toEqual([
      { id: id(11), clubspot_class_id: null, clubspot_session_id: null },
      { id: id(12), clubspot_class_id: null, clubspot_session_id: null },
      { id: id(13), clubspot_class_id: null, clubspot_session_id: null },
      { id: id(31), clubspot_class_id: null, clubspot_session_id: null },
    ]);
  });

  it("lets staff make an offering not linked to Clubspot yet", async () => {
    const db = await database();
    await up(knex(db));
    await db.exec(`INSERT INTO offerings (id, program_id, name) VALUES ('${id(41)}', '${id(1)}', 'Week 1')`);
    expect(await rows(db, `SELECT clubspot_class_id FROM offerings WHERE id = '${id(41)}'`)).toEqual([
      { clubspot_class_id: null },
    ]);
  });

  it("won't delete an offering with registrations, or link two offerings to one class and session", async () => {
    const db = await database();
    await up(knex(db));
    await expect(db.exec(`DELETE FROM offerings WHERE id = '${id(11)}'`)).rejects.toThrow(/foreign key/);
    await expect(
      db.exec(
        `UPDATE offerings SET clubspot_class_id = 'guppies', clubspot_session_id = 'week1' WHERE id = '${id(12)}'`,
      ),
    ).rejects.toThrow(/offerings_clubspot_class_session_unique/);
  });

  it("does nothing on a new database", async () => {
    await up(knex(await PGlite.create()));
  });
});
