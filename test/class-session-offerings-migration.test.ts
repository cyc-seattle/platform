import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0032-class-session-offerings.cjs";

// An offering is one Clubspot class in one session (cyc-seattle/platform#395), in a real Postgres (PGlite).

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PRODUCT, FORM, GUPPIES, GONE, WEEKLY] = [1, 2, 3, 4, 5].map(id);

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE clubspot_sessions (id varchar PRIMARY KEY, name varchar, start_date date, end_date date, archived boolean NOT NULL);
    CREATE TABLE clubspot_session_classes (id varchar PRIMARY KEY, session_id varchar NOT NULL, class_id varchar NOT NULL);
    CREATE TABLE clubspot_entry_caps (id varchar PRIMARY KEY, class_id varchar NOT NULL, session_id varchar, cap integer NOT NULL);
    CREATE TABLE clubspot_registration_entries (id varchar PRIMARY KEY, session_id varchar NOT NULL, class_id varchar NOT NULL);
    CREATE TABLE offerings (id uuid PRIMARY KEY, product_id uuid NOT NULL, name varchar, registration_form_id uuid,
      starts_on date, ends_on date, price_cents integer, capacity integer, archived_at timestamp,
      clubspot_class_id varchar, clubspot_session_id varchar, confirmed_count integer NOT NULL DEFAULT 0);
    CREATE TABLE offering_schedule (id uuid PRIMARY KEY, offering_id uuid NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
      weekday integer NOT NULL, start_time time NOT NULL, end_time time NOT NULL);
    CREATE TABLE activities (id uuid PRIMARY KEY, offering_id uuid NOT NULL REFERENCES offerings (id) ON DELETE RESTRICT,
      date date NOT NULL);
    CREATE TABLE registrations (id uuid PRIMARY KEY, offering_id uuid NOT NULL REFERENCES offerings (id) ON DELETE RESTRICT,
      status varchar NOT NULL, clubspot_entry_id varchar NOT NULL);

    -- Guppies is offered in weeks 1 and 2; week 3 is archived, but a sailor signed up for it before.
    INSERT INTO clubspot_sessions VALUES ('w1', 'June 22 - June 26', '2026-06-22', '2026-06-26', false),
      ('w2', 'June 29 - July 3', '2026-06-29', '2026-07-03', false), ('w3', 'July 6 - July 10', '2026-07-06', '2026-07-10', true),
      ('old', 'Old', '2026-05-01', '2026-05-02', true);
    INSERT INTO clubspot_session_classes VALUES ('w1:guppies', 'w1', 'guppies'), ('w2:guppies', 'w2', 'guppies'),
      ('w3:guppies', 'w3', 'guppies'), ('old:gone', 'old', 'gone'), ('w1:weekly', 'w1', 'weekly');
    INSERT INTO clubspot_entry_caps VALUES ('c0', 'guppies', NULL, 10), ('c1', 'guppies', 'w1', 12), ('c2', 'guppies', 'w2', 11);
    INSERT INTO clubspot_registration_entries VALUES ('e1', 'w1', 'guppies'), ('e2', 'w1', 'guppies'), ('e3', 'w3', 'guppies'),
      ('e4', 'w1', 'weekly');
    INSERT INTO offerings (id, product_id, name, registration_form_id, starts_on, ends_on, price_cents, capacity,
        clubspot_class_id, clubspot_session_id, confirmed_count) VALUES
      ('${GUPPIES}', '${PRODUCT}', 'Guppies Sailing', '${FORM}', '2026-06-22', '2026-07-10', 39500, 10, 'guppies', NULL, 3),
      ('${GONE}', '${PRODUCT}', 'Gold Fleet', '${FORM}', '2026-05-01', '2026-05-02', 100, NULL, 'gone', NULL, 0),
      ('${WEEKLY}', '${PRODUCT}', 'June 22 - June 26', '${FORM}', '2026-06-22', '2026-06-26', 200, 8, 'weekly', 'w1', 1);
    INSERT INTO offering_schedule VALUES ('${id(10)}', '${GUPPIES}', 1, '09:00', '15:00');
    INSERT INTO activities VALUES ('${id(20)}', '${GUPPIES}', '2026-06-30');
    INSERT INTO registrations VALUES ('${id(30)}', '${GUPPIES}', 'confirmed', 'e1'), ('${id(31)}', '${GUPPIES}', 'cancelled', 'e2'),
      ('${id(32)}', '${GUPPIES}', 'confirmed', 'e3'), ('${id(33)}', '${WEEKLY}', 'confirmed', 'e4');
  `);
  return db;
}

const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the class-session offerings migration", { timeout: 30_000 }, () => {
  it("makes a whole class's offering one for each session it's offered in or a sailor signed up for", async () => {
    const db = await before();
    await migrate(db);
    expect(
      await rows(
        db,
        `SELECT name, starts_on::text, ends_on::text, price_cents, capacity, registration_form_id, clubspot_session_id, confirmed_count
          FROM offerings WHERE clubspot_class_id = 'guppies' ORDER BY starts_on`,
      ),
    ).toEqual([
      {
        name: "June 22 - June 26",
        starts_on: "2026-06-22",
        ends_on: "2026-06-26",
        price_cents: 39500,
        capacity: 12,
        registration_form_id: FORM,
        clubspot_session_id: "w1",
        confirmed_count: 1,
      },
      {
        name: "June 29 - July 3",
        starts_on: "2026-06-29",
        ends_on: "2026-07-03",
        price_cents: 39500,
        capacity: 11,
        registration_form_id: FORM,
        clubspot_session_id: "w2",
        confirmed_count: 0,
      },
      {
        name: "July 6 - July 10",
        starts_on: "2026-07-06",
        ends_on: "2026-07-10",
        price_cents: 39500,
        capacity: null,
        registration_form_id: FORM,
        clubspot_session_id: "w3",
        confirmed_count: 1,
      },
    ]);
  });

  it("moves each registration to its session's offering, and each activity and schedule with it", async () => {
    const db = await before();
    await migrate(db);
    const sessionOf = `(SELECT clubspot_session_id FROM offerings o WHERE o.id = x.offering_id)`;
    expect(
      await rows(db, `SELECT clubspot_entry_id, ${sessionOf} AS session FROM registrations x ORDER BY id`),
    ).toEqual([
      { clubspot_entry_id: "e1", session: "w1" },
      { clubspot_entry_id: "e2", session: "w1" },
      { clubspot_entry_id: "e3", session: "w3" },
      { clubspot_entry_id: "e4", session: "w1" },
    ]);
    expect(await rows(db, `SELECT ${sessionOf} AS session FROM activities x`)).toEqual([{ session: "w2" }]);
    expect(await rows(db, `SELECT ${sessionOf} AS session, weekday FROM offering_schedule x ORDER BY 1`)).toEqual([
      { session: "w1", weekday: 1 },
      { session: "w2", weekday: 1 },
      { session: "w3", weekday: 1 },
    ]);
  });

  it("drops the whole-class offerings, one with no session left too, and leaves a session's offering alone", async () => {
    const db = await before();
    await migrate(db);
    expect(await rows(db, `SELECT id FROM offerings WHERE id IN ('${GUPPIES}', '${GONE}', '${WEEKLY}')`)).toEqual([
      { id: WEEKLY },
    ]);
    await expect(db.exec(`UPDATE offerings SET clubspot_session_id = NULL WHERE id = '${WEEKLY}'`)).rejects.toThrow(
      "offerings_class_with_session",
    );
  });

  it("stops when a registration names a session it can't take", async () => {
    const db = await before();
    await db.exec(`
      INSERT INTO clubspot_registration_entries VALUES ('e9', 'missing', 'guppies');
      INSERT INTO registrations VALUES ('${id(39)}', '${GUPPIES}', 'confirmed', 'e9');
    `);
    await expect(migrate(db)).rejects.toThrow(`cyc0032: offering ${GUPPIES} keeps registrations`);
  });

  it("does nothing when run again, or on a new database", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    expect(await rows(db, "SELECT count(*)::int AS n FROM offerings")).toEqual([{ n: 4 }]);
    await migrate(await PGlite.create());
  });
});
