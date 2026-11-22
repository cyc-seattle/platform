import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0029-drop-website-profiles.cjs";

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

async function tables(db: PGlite) {
  const { rows } = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
  );
  return rows.map(({ table_name }) => table_name);
}

/** Directus's records, the website's categories, its old bios, and Crew, with or without someone on the website. */
async function withBios(onWebsite: boolean) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64));
    CREATE TABLE directus_relations (
      id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64), one_collection varchar(64)
    );
    CREATE TABLE directus_permissions (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE website_categories (id uuid PRIMARY KEY);
    CREATE TABLE website_profiles (id uuid PRIMARY KEY, name varchar(255));
    CREATE TABLE website_categories_profiles (
      id uuid PRIMARY KEY, category_id uuid REFERENCES website_categories (id) ON DELETE CASCADE,
      profile_id uuid REFERENCES website_profiles (id) ON DELETE CASCADE
    );
    CREATE TABLE crew_members (id uuid PRIMARY KEY, on_website boolean NOT NULL DEFAULT false);
    INSERT INTO website_categories VALUES ('00000000-0000-4000-8000-000000000001');
    INSERT INTO website_profiles VALUES ('00000000-0000-4000-8000-000000000002', 'Casey');
    INSERT INTO website_categories_profiles VALUES
      ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
    INSERT INTO crew_members VALUES ('00000000-0000-4000-8000-000000000004', ${onWebsite});
    INSERT INTO directus_collections VALUES ('website_categories'), ('website_profiles'), ('website_categories_profiles');
    INSERT INTO directus_fields (collection, field) VALUES
      ('website_profiles', 'name'), ('website_categories', 'profiles'), ('website_categories', 'title');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES
      ('website_categories_profiles', 'profile_id', 'website_profiles'),
      ('website_categories_profiles', 'category_id', 'website_categories');
    INSERT INTO directus_permissions (collection) VALUES ('website_profiles'), ('website_categories');
    INSERT INTO directus_presets (collection) VALUES ('website_profiles');
  `);
  return db;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the drop website profiles migration", { timeout: 30_000 }, () => {
  it("drops the bios, the category lists that named them, and Directus's records of them", async () => {
    const db = await withBios(true);
    await migrate(db);
    await migrate(db);
    expect(await tables(db)).not.toContain("website_profiles");
    expect(await tables(db)).not.toContain("website_categories_profiles");
    const left = async (sql: string) => (await db.query(sql)).rows;
    expect(await left("SELECT collection FROM directus_collections")).toEqual([{ collection: "website_categories" }]);
    expect(await left("SELECT collection, field FROM directus_fields")).toEqual([
      { collection: "website_categories", field: "title" },
    ]);
    expect(await left("SELECT * FROM directus_relations")).toEqual([]);
    expect(await left("SELECT collection FROM directus_permissions")).toEqual([{ collection: "website_categories" }]);
    expect(await left("SELECT * FROM directus_presets")).toEqual([]);
  });

  it("refuses, changing nothing, when there are bios but no crew member is on the website", async () => {
    const db = await withBios(false);
    await expect(migrate(db)).rejects.toThrow(/no crew member is on the website/);
    expect(await tables(db)).toContain("website_profiles");
    expect(await tables(db)).toContain("website_categories_profiles");
  });

  it("drops empty bios even with no one on the website, and does nothing on a new database", async () => {
    const db = await withBios(false);
    await db.exec("DELETE FROM website_categories_profiles; DELETE FROM website_profiles;");
    await migrate(db);
    expect(await tables(db)).not.toContain("website_profiles");

    const fresh = await PGlite.create();
    await migrate(fresh);
    expect(await tables(fresh)).toEqual([]);
  });
});
