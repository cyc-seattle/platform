import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0026-person-logins.cjs";

// The move of a person's login from people.directus_user_id to directus_users.person_id, in a real
// Postgres (PGlite), with Directus's own tables cut down to the columns the migration touches.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_users (id uuid PRIMARY KEY, email varchar(128));
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64), special varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64),
      one_field varchar(64), one_deselect_action varchar(255) NOT NULL DEFAULT 'nullify'
    );
    CREATE TABLE people (
      id uuid PRIMARY KEY, first_name varchar(255),
      directus_user_id uuid UNIQUE CONSTRAINT people_directus_user_id_foreign REFERENCES directus_users (id) ON DELETE SET NULL
    );
    INSERT INTO directus_fields (collection, field, special) VALUES ('people', 'first_name', NULL), ('people', 'directus_user_id', 'm2o');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES ('people', 'directus_user_id', 'directus_users');
    INSERT INTO directus_users VALUES ('${id(1)}', 'alex@example.com'), ('${id(2)}', 'sam@example.com'), ('${id(3)}', 'nobody@example.com');
    INSERT INTO people VALUES ('${id(11)}', 'Alex', '${id(1)}'), ('${id(12)}', 'Sam', '${id(2)}'), ('${id(13)}', 'Kit', NULL);
  `);
  return db;
}

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the person logins migration", { timeout: 30_000 }, () => {
  it("copies each person's login to the login's person, then drops the old field", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect((await db.query("SELECT id, person_id FROM directus_users ORDER BY id")).rows).toEqual([
      { id: id(1), person_id: id(11) },
      { id: id(2), person_id: id(12) },
      { id: id(3), person_id: null },
    ]);
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'people' AND column_name = 'directus_user_id'",
    );
    expect(rows).toEqual([]);
    expect((await db.query("SELECT collection, field, special FROM directus_fields ORDER BY id")).rows).toEqual([
      { collection: "people", field: "first_name", special: null },
      { collection: "directus_users", field: "person_id", special: "m2o" },
    ]);
    expect(
      (await db.query("SELECT many_collection, many_field, one_collection, one_field FROM directus_relations")).rows,
    ).toEqual([
      { many_collection: "directus_users", many_field: "person_id", one_collection: "people", one_field: "logins" },
    ]);
  });

  it("lets a person have a second login, and empties their logins when they're deleted", async () => {
    const db = await database();
    await up(knex(db));
    await db.exec(`UPDATE directus_users SET person_id = '${id(11)}' WHERE id = '${id(3)}'`);
    await db.exec(`DELETE FROM people WHERE id = '${id(11)}'`);
    expect((await db.query("SELECT id, person_id FROM directus_users ORDER BY id")).rows).toEqual([
      { id: id(1), person_id: null },
      { id: id(2), person_id: id(12) },
      { id: id(3), person_id: null },
    ]);
  });

  it("changes nothing if a link doesn't copy", async () => {
    const db = await database();
    // A login already linked to someone else, which the copy would overwrite but not match.
    await db.exec(`
      ALTER TABLE directus_users ADD COLUMN person_id uuid;
      CREATE FUNCTION keep_person() RETURNS trigger AS $$ BEGIN NEW.person_id := OLD.person_id; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER keep_person BEFORE UPDATE ON directus_users FOR EACH ROW EXECUTE FUNCTION keep_person();
    `);
    await expect(up(knex(db))).rejects.toThrow(/copied 0 of 2 logins/);
    expect((await db.query("SELECT count(*)::int AS n FROM people WHERE directus_user_id IS NOT NULL")).rows).toEqual([
      { n: 2 },
    ]);
  });

  it("does nothing on a new database", async () => {
    await up(knex(await PGlite.create()));
  });
});
