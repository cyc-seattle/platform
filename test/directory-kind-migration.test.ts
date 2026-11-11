import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0008-directory-kind.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function kinds(db: PGlite) {
  const { rows } = await db.query<{ name: string; kind: string | null }>(
    "SELECT name, kind FROM organizations ORDER BY name",
  );
  return rows;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the directory kind migration", { timeout: 30_000 }, () => {
  it("marks every organization from before the directory as our own, however often it runs", async () => {
    const db = await PGlite.create();
    await db.exec("CREATE TABLE organizations (id uuid PRIMARY KEY, name varchar(255) NOT NULL)");
    await db.exec("INSERT INTO organizations VALUES (gen_random_uuid(), 'Test club')");
    await migrate(db);
    await migrate(db);
    expect(await kinds(db)).toEqual([{ name: "Test club", kind: "own" }]);
  });

  it("leaves a kind already set alone", async () => {
    const db = await PGlite.create();
    await db.exec("CREATE TABLE organizations (id uuid PRIMARY KEY, name varchar(255) NOT NULL, kind varchar(255))");
    await db.exec("INSERT INTO organizations VALUES (gen_random_uuid(), 'Other club', 'yacht_club')");
    await migrate(db);
    expect(await kinds(db)).toEqual([{ name: "Other club", kind: "yacht_club" }]);
  });

  it("does nothing on a new database", async () => {
    const db = await PGlite.create();
    await expect(migrate(db)).resolves.toBeUndefined();
  });
});
