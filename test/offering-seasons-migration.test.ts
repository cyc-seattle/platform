import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0014-offering-seasons.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

/** A draft copy and a saved one, each with an offering for each kind of season text. */
async function withOfferings() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE plan_versions (id text PRIMARY KEY, status varchar(255) NOT NULL);
    CREATE TABLE plan_offerings (
      id serial PRIMARY KEY, version_id text REFERENCES plan_versions (id), name varchar(255), season_term varchar(255)
    );
    INSERT INTO plan_versions VALUES ('draft', 'draft'), ('saved', 'saved');
  `);
  for (const version of ["draft", "saved"]) {
    await db.query(
      `INSERT INTO plan_offerings (version_id, name, season_term) SELECT $1, t, t FROM unnest($2::text[]) t`,
      [version, ["Summer 2026", "FALL", "fall", "Spring/Summer", "Term 2"]],
    );
    await db.query(`INSERT INTO plan_offerings (version_id, name, season_term) VALUES ($1, 'Adult LTS', NULL)`, [
      version,
    ]);
  }
  return db;
}

async function seasons(db: PGlite, version: string) {
  const { rows } = await db.query<{ name: string; season_term: string | null }>(
    "SELECT name, season_term FROM plan_offerings WHERE version_id = $1 ORDER BY id",
    [version],
  );
  return Object.fromEntries(rows.map(({ name, season_term }) => [name, season_term]));
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the offering seasons migration", { timeout: 30_000 }, () => {
  it("gives each draft offering the one season its text names, or none", async () => {
    const db = await withOfferings();
    await migrate(db);
    await migrate(db);
    expect(await seasons(db, "draft")).toEqual({
      "Summer 2026": "summer",
      FALL: "fall",
      fall: "fall",
      "Spring/Summer": null,
      "Term 2": null,
      "Adult LTS": null,
    });
  });

  it("leaves a saved copy's offerings as they were", async () => {
    const db = await withOfferings();
    await migrate(db);
    expect(await seasons(db, "saved")).toEqual({
      "Summer 2026": "Summer 2026",
      FALL: "FALL",
      fall: "fall",
      "Spring/Summer": "Spring/Summer",
      "Term 2": "Term 2",
      "Adult LTS": null,
    });
  });

  it("does nothing on a new database", async () => {
    await migrate(await PGlite.create());
  });
});
