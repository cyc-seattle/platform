import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { savedVersionsConfig } from "../stacks/backend/policies.ts";
import { installTriggers } from "../stacks/backend/saved-versions.cjs";

// The by-hand move of storage rent and bonuses into each draft's Operations Plan, in a real Postgres
// (PGlite) with the saved-versions hook's triggers, on tables made from the schemas.

const SQL = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/move-storage.sql"), "utf8");
const PREVIEW = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/move-storage-preview.sql"), "utf8");
const AREA_LINE = "Storage (dinghy float and dry storage, by area)";
const SHARED_LINE = "Self storage facility";

interface Field {
  collection: string;
  field: string;
  schema?: { data_type: string; is_primary_key: boolean };
}
const schemas = ["core", "directory", "planning"].map((name) => ({
  name,
  schema: yaml.load(fs.readFileSync(path.resolve(import.meta.dirname, `../schemas/${name}.yaml`), "utf8")) as {
    fields: Field[];
    relations: { collection: string; field: string; related_collection: string | null }[];
  },
}));

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  const fields = schemas.flatMap(({ schema }) => schema.fields).filter((field) => field.schema);
  for (const table of new Set(fields.map((field) => field.collection))) {
    const columns = fields
      .filter((field) => field.collection === table)
      .map(({ field, schema }) => `"${field}" ${schema!.data_type}${schema!.is_primary_key ? " PRIMARY KEY" : ""}`);
    await db.exec(`CREATE TABLE "${table}" (${columns.join(", ")})`);
  }
  const config = savedVersionsConfig(schemas, false, "1.0.0");
  await db.transaction((tx) =>
    installTriggers(config, {
      query: async (sql: string) => (await tx.query<Record<string, unknown>>(sql)).rows,
      exec: (sql: string) => tx.exec(sql),
    }),
  );
  return db;
}

async function insert(db: PGlite, table: string, values: Record<string, unknown>): Promise<string> {
  const row = { id: randomUUID(), ...values };
  const columns = Object.keys(row);
  await db.query(
    `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  );
  return row.id;
}

/** A Financial Plan for `status`, with an Operations Plan and a program area's plan, each with storage and a bonus. */
async function financialPlan(db: PGlite, status: "draft" | "saved", accounts: { occupancy: string }) {
  const organization = await insert(db, "organizations", { name: "Club", kind: "own", fiscal_year_start_month: 1 });
  const area = await insert(db, "program_areas", { name: "Summer" });
  const product = await insert(db, "products", { name: "Camp", kind: "program", program_area_id: area });
  const plan = (kind: string, program_area_id: string | null) =>
    insert(db, "plans", { kind, program_area_id, organization_id: organization, fiscal_year: 2027 });
  const operations = await insert(db, "plan_versions", { plan_id: await plan("operations", null), status: "draft" });
  const program = await insert(db, "plan_versions", { plan_id: await plan("program_area", area), status: "draft" });
  const line = (version: string, name: string, extra: Record<string, unknown> = {}) =>
    insert(db, "plan_budget_lines", {
      version_id: version,
      key: randomUUID(),
      name,
      account_id: accounts.occupancy,
      amount_cents: 500_000,
      fiscal_year: 2027,
      excluded_from_mtdc: true,
      ...extra,
    });
  const areaLine = await line(program, AREA_LINE, { cost_center_type: "program_area", cost_center_key: area });
  const shared = await line(operations, SHARED_LINE, { cost_center_type: "pool" });
  const clubhouse = await line(operations, "Clubhouse usage fee", { cost_center_type: "pool" });
  // A bonus a Program Plan held before bonuses moved to the Operations Plan.
  await db.exec("ALTER TABLE plan_bonus_owners DISABLE TRIGGER USER");
  await db.exec("ALTER TABLE plan_bonus_owner_products DISABLE TRIGGER USER");
  const owner = await insert(db, "plan_bonus_owners", {
    version_id: program,
    key: randomUUID(),
    role_name: "Director",
  });
  await insert(db, "plan_bonus_owner_products", {
    version_id: program,
    key: randomUUID(),
    bonus_owner_id: owner,
    product_id: product,
  });
  await db.exec("ALTER TABLE plan_bonus_owners ENABLE TRIGGER USER");
  await db.exec("ALTER TABLE plan_bonus_owner_products ENABLE TRIGGER USER");
  const set = await insert(db, "version_sets", { organization_id: organization, fiscal_year: 2027, status: "draft" });
  await insert(db, "version_set_members", { version_set_id: set, version_id: operations });
  await insert(db, "version_set_members", { version_set_id: set, version_id: program });
  if (status === "saved")
    await db.query("UPDATE version_sets SET status = 'saved', platform_version = '1.0.0' WHERE id = $1", [set]);
  return { operations, program, areaLine, shared, clubhouse, area };
}

const rows = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows;

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the storage move", { timeout: 30_000 }, () => {
  async function prepared() {
    const db = await database();
    const occupancy = await insert(db, "accounts", {
      number: "7350",
      name: "Occupancy/Rent",
      type: "expense",
      retired: false,
    });
    const draft = await financialPlan(db, "draft", { occupancy });
    const saved = await financialPlan(db, "saved", { occupancy });
    return { db, occupancy, draft, saved };
  }

  it("moves a draft's area storage line and bonus into its Operations Plan, and books storage to Storage", async () => {
    const { db, occupancy, draft } = await prepared();
    const key = (await rows(db, "SELECT key FROM plan_budget_lines WHERE id = $1", [draft.areaLine]))[0]!["key"];
    await db.exec(SQL);
    await db.exec(SQL);
    const [storage] = await rows(db, "SELECT id, number, name, type, parent_id FROM accounts WHERE name = 'Storage'");
    expect(storage).toMatchObject({ number: "7351", type: "expense", parent_id: occupancy });
    expect(
      await rows(
        db,
        "SELECT version_id, key, account_id, cost_center_type, cost_center_key FROM plan_budget_lines WHERE name = $1 AND version_id IN ($2, $3)",
        [AREA_LINE, draft.operations, draft.program],
      ),
    ).toEqual([
      {
        version_id: draft.operations,
        key,
        account_id: storage!["id"],
        cost_center_type: "program_area",
        cost_center_key: draft.area,
      },
    ]);
    const account = async (id: string) =>
      (await rows(db, "SELECT account_id FROM plan_budget_lines WHERE id = $1", [id]))[0];
    expect(await account(draft.shared)).toEqual({ account_id: storage!["id"] });
    expect(await account(draft.clubhouse)).toEqual({ account_id: occupancy });
    expect(
      await rows(
        db,
        `SELECT o.version_id, (SELECT count(*)::int FROM plan_bonus_owner_products p WHERE p.bonus_owner_id = o.id AND p.version_id = o.version_id) AS products
          FROM plan_bonus_owners o WHERE o.version_id IN ($1, $2)`,
        [draft.operations, draft.program],
      ),
    ).toEqual([{ version_id: draft.operations, products: 1 }]);
  });

  it("leaves a saved Financial Plan as it was", async () => {
    const { db, occupancy, saved } = await prepared();
    await db.exec(SQL);
    expect(
      await rows(db, "SELECT version_id, account_id FROM plan_budget_lines WHERE id = $1", [saved.areaLine]),
    ).toEqual([{ version_id: saved.program, account_id: occupancy }]);
    expect(await rows(db, "SELECT account_id FROM plan_budget_lines WHERE id = $1", [saved.shared])).toEqual([
      { account_id: occupancy },
    ]);
    expect(
      await rows(db, "SELECT version_id FROM plan_bonus_owners WHERE version_id = $1", [saved.program]),
    ).toHaveLength(1);
  });

  it("previews without changing anything", async () => {
    const { db } = await prepared();
    const before = await rows(db, "SELECT id, version_id, account_id FROM plan_budget_lines ORDER BY id");
    await db.exec(PREVIEW);
    expect(await rows(db, "SELECT id, version_id, account_id FROM plan_budget_lines ORDER BY id")).toEqual(before);
  });

  it("stops, changing nothing, without an account 7350", async () => {
    const db = await database();
    await expect(db.exec(SQL)).rejects.toThrow("There is no account 7350");
  });
});
