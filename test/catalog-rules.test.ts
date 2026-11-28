import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { installCatalogRules } from "../stacks/backend/catalog-rules.cjs";

// The catalog's rules, which the catalog-rules hook installs once the schema apply has made the tables
// (cyc-seattle/platform#395), in a real Postgres (PGlite).

const install = (db: PGlite) =>
  db.transaction((tx) =>
    installCatalogRules({
      query: async (sql) => (await tx.query<Record<string, unknown>>(sql)).rows,
      exec: (sql) => tx.exec(sql),
    }),
  );

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE clubspot_classes (id varchar PRIMARY KEY);
    CREATE TABLE clubspot_sessions (id varchar PRIMARY KEY);
    CREATE TABLE offerings (id integer PRIMARY KEY,
      clubspot_class_id varchar REFERENCES clubspot_classes (id) ON DELETE SET NULL,
      clubspot_session_id varchar REFERENCES clubspot_sessions (id) ON DELETE SET NULL);
    INSERT INTO clubspot_classes VALUES ('guppies'), ('k-pod');
    INSERT INTO clubspot_sessions VALUES ('w1'), ('w2');
    INSERT INTO offerings VALUES (1, 'guppies', 'w1'), (2, 'k-pod', 'w2'), (3, NULL, NULL);
  `);
  return db;
}

const links = async (db: PGlite) =>
  (await db.query("SELECT id, clubspot_class_id, clubspot_session_id FROM offerings ORDER BY id")).rows;

describe("the catalog's rules", { timeout: 30_000 }, () => {
  it("wait for the tables, then install once", async () => {
    const empty = await PGlite.create();
    expect(await install(empty)).toEqual({
      missing: ["offerings", "clubspot_sessions", "clubspot_classes"],
      installed: [],
    });
    const db = await before();
    expect((await install(db)).installed).toEqual([
      "cyc_unlink_session_offerings",
      "cyc_unlink_class_offerings",
      "offerings_class_with_session",
      "offerings_clubspot_class_session_unique",
    ]);
    expect(await install(db)).toEqual({ missing: [], installed: [] });
  });

  it("keep an offering's class and session together, and one offering to each", async () => {
    const db = await before();
    await install(db);
    await expect(db.exec("UPDATE offerings SET clubspot_session_id = NULL WHERE id = 1")).rejects.toThrow(
      "offerings_class_with_session",
    );
    await expect(db.exec("INSERT INTO offerings VALUES (4, 'guppies', 'w1')")).rejects.toThrow(
      "offerings_clubspot_class_session_unique",
    );
  });

  it("unlink an offering from both when Clubspot deletes its class or its session", async () => {
    const db = await before();
    await install(db);
    await db.exec("DELETE FROM clubspot_classes WHERE id = 'guppies'");
    await db.exec("DELETE FROM clubspot_sessions WHERE id = 'w2'");
    expect(await links(db)).toEqual([
      { id: 1, clubspot_class_id: null, clubspot_session_id: null },
      { id: 2, clubspot_class_id: null, clubspot_session_id: null },
      { id: 3, clubspot_class_id: null, clubspot_session_id: null },
    ]);
  });
});
