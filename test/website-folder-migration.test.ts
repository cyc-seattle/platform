import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { WEBSITE_FOLDER, up } from "../stacks/backend/migrations/cyc0005-website-folder.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function folders(db: PGlite) {
  const { rows } = await db.query<{ id: string; name: string }>("SELECT id, name FROM directus_folders");
  return rows;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the Website folder migration", { timeout: 30_000 }, () => {
  it("makes the folder once, however often it runs", async () => {
    const db = await PGlite.create();
    await db.exec("CREATE TABLE directus_folders (id uuid PRIMARY KEY, name varchar(255) NOT NULL, parent uuid)");
    await migrate(db);
    await migrate(db);
    expect(await folders(db)).toEqual([{ id: WEBSITE_FOLDER, name: "Website" }]);
  });

  it("leaves a renamed folder alone", async () => {
    const db = await PGlite.create();
    await db.exec("CREATE TABLE directus_folders (id uuid PRIMARY KEY, name varchar(255) NOT NULL, parent uuid)");
    await db.query("INSERT INTO directus_folders (id, name) VALUES ($1, 'Site images')", [WEBSITE_FOLDER]);
    await migrate(db);
    expect(await folders(db)).toEqual([{ id: WEBSITE_FOLDER, name: "Site images" }]);
  });

  it("does nothing before Directus has a folders table", async () => {
    const db = await PGlite.create();
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it("is the folder the website's image fields upload into", () => {
    const yaml = fs.readFileSync(path.resolve(import.meta.dirname, "../schemas/website.yaml"), "utf8");
    const named = new Set([...yaml.matchAll(/folder: (\S+)/g)].map(([, id]) => id));
    expect([...named]).toEqual([WEBSITE_FOLDER]);
  });
});
