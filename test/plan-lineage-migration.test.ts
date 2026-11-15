import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { FALL, ORIGINAL, RESOLVED, RESULTS, up } from "../stacks/backend/migrations/cyc0022-plan-lineage.cjs";
import { frozenPlansConfig } from "../stacks/backend/policies.ts";
import { database, schemas } from "./planning-database.ts";

// The one-off fix to prod's 2026 Financial Plans, in a real Postgres (PGlite) on tables made from
// the schemas, with the frozen-plans triggers on: their parents as they were in prod, all frozen.

const config = frozenPlansConfig(schemas, false, "1.0.0+engine.abc");
const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });
const OLD_DRAFT = randomUUID();

/** Adds a Financial Plan with an Operations Plan, and freezes it unless it's archived. */
async function add(db: PGlite, id: string, organization: string, parent: string | null, frozen = true) {
  await db.query(
    "INSERT INTO financial_plans (id, organization_id, fiscal_year, name, status, parent_id) VALUES ($1, $2, 2026, $3, 'draft', $4)",
    [id, organization, id, parent],
  );
  await db.query("INSERT INTO plans (id, financial_plan_id, kind) VALUES ($1, $2, 'operations')", [randomUUID(), id]);
  if (frozen) {
    await db.query(
      "UPDATE financial_plans SET status = 'frozen', platform_version = '1.4.0', frozen_by = $2 WHERE id = $1",
      [id, randomUUID()],
    );
  } else await db.query("UPDATE financial_plans SET archived_at = now() WHERE id = $1", [id]);
}

/** Writes a Financial Plan's results, as the hook does. */
async function results(db: PGlite, set: string) {
  await db.transaction(async (tx) => {
    await tx.exec("SET LOCAL cyc.writing_results = 'on'");
    await tx.query("INSERT INTO plan_result_lines (id, financial_plan_id) VALUES ($1, $2)", [randomUUID(), set]);
    await tx.query("INSERT INTO plan_results (id, financial_plan_id) VALUES ($1, $2)", [randomUUID(), set]);
  });
}

async function prod(): Promise<PGlite> {
  const db = await database(config);
  const organization = randomUUID();
  await db.query("INSERT INTO organizations (id, name, kind) VALUES ($1, 'CSC', 'own')", [organization]);
  await add(db, OLD_DRAFT, organization, null, false);
  await add(db, FALL, organization, OLD_DRAFT);
  await add(db, ORIGINAL, organization, FALL);
  await add(db, RESOLVED, organization, ORIGINAL);
  for (const set of [ORIGINAL, FALL, RESOLVED]) await results(db, set);
  return db;
}

const sets = async (db: PGlite) =>
  Object.fromEntries(
    (
      await db.query<{ id: string }>(
        "SELECT id, parent_id, status, frozen_by, frozen_at, platform_version, archived_at FROM financial_plans",
      )
    ).rows.map(({ id, ...set }) => [id, set]),
  );

const resultCount = async (db: PGlite, set: string) =>
  (
    await db.query<{ n: number }>("SELECT count(*)::int AS n FROM plan_result_lines WHERE financial_plan_id = $1", [
      set,
    ])
  ).rows[0]!.n +
  (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM plan_results WHERE financial_plan_id = $1", [set]))
    .rows[0]!.n;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the plan lineage migration", { timeout: 30_000 }, () => {
  it("lists every table of a Financial Plan's results", () => {
    expect([...RESULTS].sort()).toEqual([...config.results].sort());
  });

  it("starts each plan from the one before, and makes the last a draft again", async () => {
    const db = await prod();
    const before = await sets(db);
    await up(knex(db));
    const after = await sets(db);
    expect(after[ORIGINAL]).toEqual({ ...before[ORIGINAL], parent_id: null });
    expect(after[FALL]).toEqual({ ...before[FALL], parent_id: ORIGINAL });
    expect(after[RESOLVED]).toEqual({
      ...before[RESOLVED],
      parent_id: FALL,
      status: "draft",
      frozen_by: null,
      frozen_at: null,
      platform_version: null,
    });
    expect(after[OLD_DRAFT]).toEqual(before[OLD_DRAFT]);
  });

  it("clears the draft's results, for the hook to work out again, and keeps the frozen ones'", async () => {
    const db = await prod();
    await up(knex(db));
    expect(await resultCount(db, RESOLVED)).toBe(0);
    expect(await resultCount(db, ORIGINAL)).toBe(2);
    expect(await resultCount(db, FALL)).toBe(2);
  });

  it("leaves the triggers on", async () => {
    const db = await prod();
    await up(knex(db));
    expect(
      (
        await db.query<{ off: number }>(
          "SELECT count(*)::int AS off FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'",
        )
      ).rows,
    ).toEqual([{ off: 0 }]);
    const refused = await db
      .query("UPDATE financial_plans SET parent_id = NULL WHERE id = $1", [FALL])
      .catch((error: Error) => error);
    expect(refused).toBeInstanceOf(Error);
  });

  it("changes nothing when run again", async () => {
    const db = await prod();
    await up(knex(db));
    const once = await sets(db);
    await up(knex(db));
    expect(await sets(db)).toEqual(once);
  });

  it("does nothing without all three", async () => {
    const db = await database(config);
    const organization = randomUUID();
    await db.query("INSERT INTO organizations (id, name, kind) VALUES ($1, 'CSC', 'own')", [organization]);
    await add(db, FALL, organization, null);
    await add(db, RESOLVED, organization, FALL);
    const before = await sets(db);
    await up(knex(db));
    expect(await sets(db)).toEqual(before);
  });

  it("does nothing on a new database", async () => {
    await up(knex(await PGlite.create()));
  });
});
