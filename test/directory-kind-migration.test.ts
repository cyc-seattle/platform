import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0009-directory-kind-orphan.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function columns(db: PGlite) {
  const { rows } = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations' ORDER BY column_name",
  );
  return rows.map(({ column_name }) => column_name);
}

async function withOrganizations(kind: boolean) {
  const db = await PGlite.create();
  await db.exec("CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64))");
  await db.exec(
    `CREATE TABLE organizations (id uuid PRIMARY KEY, name varchar(255) NOT NULL${kind ? ", kind varchar(255)" : ""})`,
  );
  await db.exec("INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test club')");
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the directory kind orphan migration", { timeout: 30_000 }, () => {
  it("drops a kind column Directus has no field for, so the apply can create it", async () => {
    const db = await withOrganizations(true);
    await migrate(db);
    await migrate(db);
    expect(await columns(db)).toEqual(["id", "name"]);
  });

  it("leaves kind alone once the apply has made the field", async () => {
    const db = await withOrganizations(true);
    await db.exec("INSERT INTO directus_fields (collection, field) VALUES ('organizations', 'kind')");
    await migrate(db);
    expect(await columns(db)).toEqual(["id", "kind", "name"]);
  });

  it("does nothing before the directory, or on a new database", async () => {
    const db = await withOrganizations(false);
    await migrate(db);
    expect(await columns(db)).toEqual(["id", "name"]);
    await expect(migrate(await PGlite.create())).resolves.toBeUndefined();
  });
});
