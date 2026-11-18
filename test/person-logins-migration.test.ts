import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0026-person-logins.cjs";

// The copy of each person's login from people.directus_user_id to directus_users.person_id, in a real
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
  it("copies each person's login to the login's person, and keeps the old field for now", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect((await db.query("SELECT id, person_id FROM directus_users ORDER BY id")).rows).toEqual([
      { id: id(1), person_id: id(11) },
      { id: id(2), person_id: id(12) },
      { id: id(3), person_id: null },
    ]);
    expect((await db.query("SELECT id, directus_user_id FROM people ORDER BY id")).rows).toEqual([
      { id: id(11), directus_user_id: id(1) },
      { id: id(12), directus_user_id: id(2) },
      { id: id(13), directus_user_id: null },
    ]);
    expect((await db.query("SELECT collection, field, special FROM directus_fields ORDER BY id")).rows).toEqual([
      { collection: "people", field: "first_name", special: null },
      { collection: "people", field: "directus_user_id", special: "m2o" },
      { collection: "directus_users", field: "person_id", special: "m2o" },
    ]);
    expect(
      (
        await db.query(
          "SELECT many_collection, many_field, one_collection, one_field FROM directus_relations ORDER BY id",
        )
      ).rows,
    ).toEqual([
      { many_collection: "people", many_field: "directus_user_id", one_collection: "directus_users", one_field: null },
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
    // Something that stops the copy, which the check must catch.
    await db.exec(`
      CREATE FUNCTION drop_person() RETURNS trigger AS $$ BEGIN NEW.person_id := NULL; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER drop_person BEFORE UPDATE ON directus_users FOR EACH ROW EXECUTE FUNCTION drop_person();
    `);
    await expect(up(knex(db))).rejects.toThrow(/copied 0 of 2 logins/);
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'directus_users' AND column_name = 'person_id'",
    );
    expect(rows).toEqual([]);
  });

  it("does nothing on a new database", async () => {
    await up(knex(await PGlite.create()));
  });
});
