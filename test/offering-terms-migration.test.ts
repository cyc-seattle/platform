import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { SEED, up } from "../stacks/backend/migrations/cyc0014-offering-terms.cjs";

// The move from an offering's free-text season to a term in the Operations Plan, in a real Postgres
// (PGlite): a draft Financial Plan and a saved one, each with an Operations Plan and a program area's plan.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE plans (id uuid PRIMARY KEY, kind varchar(255));
    CREATE TABLE version_sets (id uuid PRIMARY KEY, status varchar(255));
    CREATE TABLE version_set_members (id uuid PRIMARY KEY, version_set_id uuid, plan_id uuid, version_id uuid);
    CREATE TABLE plan_offerings (id uuid PRIMARY KEY, version_id uuid, name varchar(255), season_term varchar(255));
    INSERT INTO directus_fields (collection, field) VALUES ('plan_offerings', 'name'), ('plan_offerings', 'season_term');
    INSERT INTO plans VALUES ('${id(1)}', 'operations'), ('${id(2)}', 'program_area');
  `);
  for (const [n, status] of [
    [10, "draft"],
    [20, "saved"],
  ] as const) {
    const set = id(n);
    const [operations, program] = [id(n + 1), id(n + 2)];
    await db.exec(`
      INSERT INTO version_sets VALUES ('${set}', '${status}');
      INSERT INTO version_set_members VALUES ('${id(n + 3)}', '${set}', '${id(1)}', '${operations}'),
        ('${id(n + 4)}', '${set}', '${id(2)}', '${program}');
      INSERT INTO plan_offerings VALUES ('${id(n + 5)}', '${program}', 'Guppies week 1', ' Summer 2026 '),
        ('${id(n + 6)}', '${program}', 'Adult LTS', NULL), ('${id(n + 7)}', '${program}', 'Fall', '');
    `);
  }
  return db;
}

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the offering terms migration", { timeout: 30_000 }, () => {
  it("lists each draft offering's text with its Operations Plan copy, then drops the text", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect((await db.query(`SELECT offering_id, operations_version_id, name FROM ${SEED}`)).rows).toEqual([
      { offering_id: id(15), operations_version_id: id(11), name: "Summer 2026" },
    ]);
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'plan_offerings' AND column_name = 'season_term'",
    );
    expect(rows).toEqual([]);
    expect((await db.query("SELECT field FROM directus_fields")).rows).toEqual([{ field: "name" }]);
  });

  it("leaves no list when no draft offering has text", async () => {
    const db = await database();
    await db.exec("UPDATE plan_offerings SET season_term = NULL");
    await up(knex(db));
    expect((await db.query(`SELECT to_regclass('${SEED}') AS seed`)).rows).toEqual([{ seed: null }]);
  });

  it("does nothing on a new database", async () => {
    await up(knex(await PGlite.create()));
  });
});
