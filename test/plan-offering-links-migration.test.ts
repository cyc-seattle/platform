import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { REVIEWED, up } from "../stacks/backend/migrations/cyc0033-plan-offering-links.cjs";

// A plan offering links to its catalog offering (cyc-seattle/platform#395), in a real Postgres (PGlite), with a
// trigger like the frozen-plans hook's that refuses every write.

const migrate = (db: PGlite) => up({ raw: (sql: string) => db.exec(sql) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// The first reviewed pair: a plan offering, and the catalog offering the maintainer matched it to.
const [REVIEWED_PLAN, REVIEWED_CATALOG] = REVIEWED[0]!;
const [OLD, LATEST, NEXT] = [id(1), id(2), id(3)];
const [P_OLD, P_LATEST, P_NEXT] = [id(11), id(12), id(13)];
const [GUPPIES, CHARTERS] = [id(21), id(22)];

async function before() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64), special varchar(64));
    CREATE TABLE directus_relations (id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64),
      one_collection varchar(64), one_field varchar(64));
    CREATE TABLE financial_plans (id uuid PRIMARY KEY, fiscal_year integer NOT NULL, effective_from date);
    CREATE TABLE plans (id uuid PRIMARY KEY, financial_plan_id uuid NOT NULL);
    CREATE TABLE offerings (id uuid PRIMARY KEY, product_id uuid NOT NULL, name varchar, starts_on date, ends_on date,
      price_cents integer, capacity integer, confirmed_count integer NOT NULL DEFAULT 0);
    CREATE TABLE plan_offerings (id uuid PRIMARY KEY, plan_id uuid NOT NULL, product_id uuid NOT NULL, name varchar NOT NULL,
      starts_on date NOT NULL, ends_on date NOT NULL, price_cents integer, capacity integer);

    INSERT INTO financial_plans VALUES ('${OLD}', 2026, '2026-01-01'), ('${LATEST}', 2026, '2026-09-03'), ('${NEXT}', 2027, NULL);
    INSERT INTO plans VALUES ('${P_OLD}', '${OLD}'), ('${P_LATEST}', '${LATEST}'), ('${P_NEXT}', '${NEXT}');
    INSERT INTO offerings (id, product_id, name) VALUES ('${REVIEWED_CATALOG}', '${GUPPIES}', 'June 22 - June 26');
    INSERT INTO plan_offerings VALUES
      ('${REVIEWED_PLAN}', '${P_LATEST}', '${GUPPIES}', 'Week 1', '2026-06-22', '2026-06-26', 39500, 12),
      -- The same charters in two of 2026's Financial Plans, at another price in the later one, and in 2027's.
      ('${id(31)}', '${P_OLD}', '${CHARTERS}', 'Sep', '2026-09-01', '2026-09-30', 10000, 4),
      ('${id(32)}', '${P_LATEST}', '${CHARTERS}', 'Sep', '2026-09-01', '2026-09-30', 12000, 5),
      ('${id(33)}', '${P_NEXT}', '${CHARTERS}', 'Sep', '2026-09-01', '2026-09-30', 12000, 5);
    INSERT INTO directus_fields (collection, field) VALUES ('plan_offerings', 'product_id'), ('plan_offerings', 'name'),
      ('plan_offerings', 'starts_on');
    INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES ('plan_offerings', 'product_id', 'products');

    CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'frozen'; END $$;
    CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON plan_offerings FOR EACH ROW EXECUTE FUNCTION refuse();
  `);
  return db;
}

const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the plan offering links migration", { timeout: 30_000 }, () => {
  it("links a reviewed plan offering to the catalog offering the review names", async () => {
    const db = await before();
    await migrate(db);
    expect(await rows(db, `SELECT offering_id FROM plan_offerings WHERE id = '${REVIEWED_PLAN}'`)).toEqual([
      { offering_id: REVIEWED_CATALOG },
    ]);
  });

  it("makes one catalog offering for each year's plan offerings that share a product, name and dates", async () => {
    const db = await before();
    await migrate(db);
    const made = await rows(
      db,
      `SELECT o.product_id, o.name, o.starts_on::text, o.price_cents, o.capacity, array_agg(p.id ORDER BY p.id) AS plans
        FROM offerings o JOIN plan_offerings p ON p.offering_id = o.id
        WHERE o.product_id = '${CHARTERS}' GROUP BY o.id ORDER BY 6`,
    );
    expect(made).toEqual([
      // From the later Financial Plan's, which is in force.
      {
        product_id: CHARTERS,
        name: "Sep",
        starts_on: "2026-09-01",
        price_cents: 12000,
        capacity: 5,
        plans: [id(31), id(32)],
      },
      { product_id: CHARTERS, name: "Sep", starts_on: "2026-09-01", price_cents: 12000, capacity: 5, plans: [id(33)] },
    ]);
  });

  it("drops the plan offering's product and name, with Directus's records, and turns the triggers back on", async () => {
    const db = await before();
    await migrate(db);
    expect(
      await rows(
        db,
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'plan_offerings'
          AND column_name IN ('product_id', 'name', 'offering_id')`,
      ),
    ).toEqual([{ column_name: "offering_id" }]);
    expect(await rows(db, "SELECT collection, field FROM directus_fields ORDER BY id")).toEqual([
      { collection: "plan_offerings", field: "starts_on" },
      { collection: "plan_offerings", field: "offering_id" },
    ]);
    expect(await rows(db, "SELECT many_field, one_collection FROM directus_relations")).toEqual([
      { many_field: "offering_id", one_collection: "offerings" },
    ]);
    await expect(db.exec(`UPDATE plan_offerings SET capacity = 1`)).rejects.toThrow("frozen");
    await expect(db.exec(`DELETE FROM offerings WHERE id = '${REVIEWED_CATALOG}'`)).rejects.toThrow(
      "plan_offerings_offering_id_foreign",
    );
  });

  it("does nothing when run again, or on a new database", async () => {
    const db = await before();
    await migrate(db);
    await migrate(db);
    expect(await rows(db, "SELECT count(*)::int AS n FROM offerings")).toEqual([{ n: 3 }]);
    await migrate(await PGlite.create());
  });
});
