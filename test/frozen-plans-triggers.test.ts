import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import * as yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { frozenPlansConfig, type FrozenPlansConfig } from "../stacks/backend/policies.ts";
import {
  ACTIVE_STAYS,
  ARCHIVED_NOT_ACTIVE,
  BONUS_IN_OPERATIONS,
  copyOrder,
  copyParent,
  draftsChangedBy,
  fingerprint,
  IN_FORCE_NOT_ARCHIVED,
  installTriggers,
  NEEDS_OPERATIONS,
  ONE_PER_AREA,
  ONE_PER_DATE,
  PLAN_STAYS,
  PLANS_FIXED,
  REFUSED,
  RESULTS_BY_HOOK,
  SET_STAYS,
  SHORT_NOTES,
  triggerStatements,
  triggerStatus,
  writeDraftResults,
  writeSetResults,
} from "../stacks/backend/frozen-plans.cjs";
import { computePlan } from "../src/planning/index.ts";

// The frozen-plans hook's triggers, in a real Postgres (PGlite), on tables made from the schemas:
// the only guard on a path that skips Directus's filters, such as a flow's data steps.

interface Field {
  collection: string;
  field: string;
  schema?: { data_type: string; is_primary_key: boolean };
}
interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  schema?: { on_delete?: string } | null;
}

const schemas = ["core", "directory", "planning"].map((name) => ({
  name,
  schema: yaml.load(fs.readFileSync(path.resolve(import.meta.dirname, `../schemas/${name}.yaml`), "utf8")) as {
    fields: Field[];
    relations: Relation[];
  },
}));

/** The tables, keys, and foreign keys the schemas declare. Only a primary key is required. */
function tables(): string[] {
  const fields = schemas.flatMap(({ schema }) => schema.fields).filter((field) => field.schema);
  const names = [...new Set(fields.map((field) => field.collection))];
  const create = names.map((table) => {
    const columns = fields
      .filter((field) => field.collection === table)
      .map(({ field, schema }) => `"${field}" ${schema!.data_type}${schema!.is_primary_key ? " PRIMARY KEY" : ""}`);
    return `CREATE TABLE "${table}" (${columns.join(", ")})`;
  });
  const keys = schemas
    .flatMap(({ schema }) => schema.relations)
    .filter(({ related_collection: related }) => related !== null && names.includes(related))
    .map(
      ({ collection, field, related_collection: related, schema }) =>
        `ALTER TABLE "${collection}" ADD FOREIGN KEY ("${field}") REFERENCES "${related}" (id) ON DELETE ${schema?.on_delete ?? "RESTRICT"}`,
    );
  return [...create, ...keys];
}

async function database(config: FrozenPlansConfig): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pageinspect } });
  await db.exec("CREATE EXTENSION pageinspect");
  for (const statement of tables()) await db.exec(statement);
  const { missing } = await db.transaction((tx) => installTriggers(config, connect(tx)));
  expect(missing).toEqual([]);
  return db;
}

const connect = (tx: Transaction) => ({
  query: async (sql: string) => (await tx.query<Record<string, unknown>>(sql)).rows,
  exec: (sql: string) => tx.exec(sql),
});

const config = (deletable: boolean) => frozenPlansConfig(schemas, deletable, "1.0.0+engine.abc");

type Values = Record<string, unknown>;

/** Writes through one database, returning its error, if any. */
function writer(db: PGlite) {
  const run = async (sql: string, params: unknown[] = []) => {
    try {
      await db.query(sql, params);
      return undefined;
    } catch (error) {
      return error as { code?: string; message: string };
    }
  };
  const insert = async (table: string, values: Values) => {
    const id = (values["id"] as string | undefined) ?? randomUUID();
    const row = { id, ...values };
    const columns = Object.keys(row);
    const error = await run(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row),
    );
    if (error) throw error;
    return id;
  };
  return {
    insert,
    /** An insert that should fail; resolves to its error. */
    refusedInsert: async (table: string, values: Values) => {
      try {
        await insert(table, values);
      } catch (error) {
        return error as { code?: string; message: string };
      }
      return undefined;
    },
    update: (table: string, id: string, values: Values) => {
      const columns = Object.keys(values);
      return run(`UPDATE "${table}" SET ${columns.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`, [
        id,
        ...Object.values(values),
      ]);
    },
    remove: (table: string, id: string) => run(`DELETE FROM "${table}" WHERE id = $1`, [id]),
    read: async (table: string, id: string) =>
      (await db.query<Values>(`SELECT * FROM "${table}" WHERE id = $1`, [id])).rows[0],
  };
}

const NEEDS_PLATFORM = "Freezing a Financial Plan needs the @cyc-seattle/platform version that calculated it.";
const ROW_STAYS = "A plan row can't move to another plan. Copy it into that plan instead.";
const SAME_PLAN = "A plan row can only link to rows in its own plan.";
const AREA_NAMED = "A program area's plan names its program area, and an Operations Plan names none.";

const refusal = (message: string) => expect.objectContaining({ code: "CY001", message });

/**
 * An organization's year: a frozen Financial Plan holding the Operations Plan and a program area's
 * plan, and a draft Financial Plan started from it, holding a program area's plan of its own.
 */
async function plans(db: PGlite, year = 2027) {
  const w = writer(db);
  const organization = await w.insert("organizations", { name: "Test club", kind: "own", fiscal_year_start_month: 10 });
  const area = await w.insert("program_areas", { name: "Test area" });
  const product = await w.insert("products", { name: "Test product", kind: "program", program_area_id: area });
  const set = await w.insert("financial_plans", {
    organization_id: organization,
    fiscal_year: year,
    name: "Budget",
    status: "draft",
  });
  const operations = await w.insert("plans", { financial_plan_id: set, kind: "operations" });
  await w.insert("plan_rates", { plan_id: operations, key: randomUUID() });
  const frozen = await w.insert("plans", { financial_plan_id: set, kind: "program_area", program_area_id: area });
  const offering = async (plan: string) =>
    w.insert("plan_offerings", { plan_id: plan, key: randomUUID(), product_id: product, name: "Offering" });
  const frozenOffering = await offering(frozen);
  const block = await w.insert("plan_activity_blocks", {
    plan_id: frozen,
    key: randomUUID(),
    date: `${year}-06-06`,
    name: "Saturday morning",
  });
  await w.insert("plan_activities", {
    plan_id: frozen,
    key: randomUUID(),
    offering_id: frozenOffering,
    date: `${year}-06-06`,
    block_id: block,
  });
  await w.insert("plan_revenue_charges", {
    plan_id: operations,
    key: randomUUID(),
    name: "Card fees",
    rate: 0,
    product_kinds: JSON.stringify(["program", "charter"]),
  });
  expect(await w.update("financial_plans", set, { status: "frozen", platform_version: "1.4.0" })).toBeUndefined();

  const draftSet = await w.insert("financial_plans", {
    organization_id: organization,
    fiscal_year: year,
    name: "Next",
    status: "draft",
    parent_id: set,
  });
  const draft = await w.insert("plans", { financial_plan_id: draftSet, kind: "program_area", program_area_id: area });
  const draftOffering = await offering(draft);
  return { organization, area, product, set, operations, frozen, draftSet, draft, frozenOffering, draftOffering };
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the frozen-plans triggers", { timeout: 30_000 }, () => {
  let db: PGlite;
  let w: ReturnType<typeof writer>;
  beforeAll(async () => {
    db = await database(config(false));
    w = writer(db);
  }, 30_000);

  describe("on a Financial Plan's results", () => {
    /** Writes a warning and then the totals for `set`, as the hook does; returns the error, if any. */
    const hookWrites = async (set: string, plan: string | null = null) => {
      try {
        await db.transaction(async (tx) => {
          await tx.exec("SET LOCAL cyc.writing_results = 'on'");
          await tx.query(
            `INSERT INTO plan_result_warnings (id, financial_plan_id, plan_id, code, message) VALUES ($1, $2, $3, 'x', 'y')`,
            [randomUUID(), set, plan],
          );
          await tx.query(`INSERT INTO plan_results (id, financial_plan_id, total_cents) VALUES ($1, $2, 0)`, [
            randomUUID(),
            set,
          ]);
        });
        return undefined;
      } catch (error) {
        return error as { code?: string; message: string };
      }
    };

    it("let only the hook write a frozen Financial Plan's results, once", async () => {
      const { set } = await plans(db, 2201);
      expect(
        await w.refusedInsert("plan_result_warnings", { financial_plan_id: set, code: "x", message: "y" }),
      ).toEqual(refusal(RESULTS_BY_HOOK));
      expect(await hookWrites(set)).toBeUndefined();
      expect(await hookWrites(set)).toEqual(refusal(RESULTS_BY_HOOK));
    });

    it("let only the hook write or clear a draft's results", async () => {
      const { draftSet } = await plans(db, 2202);
      expect(await w.refusedInsert("plan_results", { financial_plan_id: draftSet, total_cents: 0 })).toEqual(
        refusal(RESULTS_BY_HOOK),
      );
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(await hookWrites(draftSet)).toEqual(refusal(RESULTS_BY_HOOK));
      const [{ id }] = (
        await db.query<{ id: string }>(`SELECT id FROM plan_results WHERE financial_plan_id = $1`, [draftSet])
      ).rows as [{ id: string }];
      expect(await w.update("plan_results", id, { total_cents: 1 })).toEqual(refusal(RESULTS_BY_HOOK));
      expect(await w.remove("plan_results", id)).toEqual(refusal(RESULTS_BY_HOOK));
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL cyc.writing_results = 'on'");
        await tx.query(`DELETE FROM plan_result_warnings WHERE financial_plan_id = $1`, [draftSet]);
        await tx.query(`DELETE FROM plan_results WHERE financial_plan_id = $1`, [draftSet]);
      });
      expect(await hookWrites(draftSet)).toBeUndefined();
    });

    it("clear a draft's results when it's frozen, for the hook to write again", async () => {
      const { draftSet } = await plans(db, 2204);
      await w.insert("plans", { financial_plan_id: draftSet, kind: "operations" });
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(
        await w.update("financial_plans", draftSet, { status: "frozen", platform_version: "1.4.0" }),
      ).toBeUndefined();
      for (const table of ["plan_results", "plan_result_warnings"]) {
        const { rows } = await db.query(`SELECT 1 FROM "${table}" WHERE financial_plan_id = $1`, [draftSet]);
        expect(rows, table).toEqual([]);
      }
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(await hookWrites(draftSet)).toEqual(refusal(RESULTS_BY_HOOK));
    });

    it("let a draft with results be deleted, or a plan be taken out of it, with their results", async () => {
      const { draftSet, draft } = await plans(db, 2205);
      expect(await hookWrites(draftSet, draft)).toBeUndefined();
      await db.query(`DELETE FROM plan_offerings WHERE plan_id = $1`, [draft]);
      expect(await w.remove("plans", draft)).toBeUndefined();
      expect(
        (await db.query(`SELECT 1 FROM plan_result_warnings WHERE financial_plan_id = $1`, [draftSet])).rows,
      ).toEqual([]);
      expect(await w.remove("financial_plans", draftSet)).toBeUndefined();
      expect((await db.query(`SELECT 1 FROM plan_results WHERE financial_plan_id = $1`, [draftSet])).rows).toEqual([]);
    });

    it("refuse to change or delete them", async () => {
      const { set } = await plans(db, 2203);
      await hookWrites(set);
      const [{ id }] = (
        await db.query<{ id: string }>(`SELECT id FROM plan_results WHERE financial_plan_id = $1`, [set])
      ).rows as [{ id: string }];
      expect(await w.update("plan_results", id, { total_cents: 1 })).toEqual(refusal(RESULTS_BY_HOOK));
      expect(await w.remove("plan_results", id)).toEqual(refusal(RESULTS_BY_HOOK));
    });
  });

  describe("on a frozen plan's rows", () => {
    it("refuse to add, change, or delete one", async () => {
      const { frozen, frozenOffering, product } = await plans(db, 2101);
      expect(
        await w.refusedInsert("plan_offerings", { plan_id: frozen, key: randomUUID(), product_id: product }),
      ).toEqual(refusal(REFUSED));
      expect(await w.update("plan_offerings", frozenOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
      expect(await w.remove("plan_offerings", frozenOffering)).toEqual(refusal(REFUSED));
      expect((await w.read("plan_offerings", frozenOffering))?.["name"]).toBe("Offering");
    });

    it("lock the Financial Plan inside the write's transaction, so freezing it waits for the write", async () => {
      const { draft, draftSet, product } = await plans(db, 2102);
      // A row lock lives in the Financial Plan's tuple: its xmax, and these bits of its infomask.
      const LOCK_ONLY = 0x0080;
      const SHARE = 0x0050;
      await db.transaction(async (tx) => {
        await tx.query(`INSERT INTO plan_offerings (id, plan_id, key, product_id) VALUES ($1, $2, $3, $4)`, [
          randomUUID(),
          draft,
          randomUUID(),
          product,
        ]);
        const [tuple] = (
          await tx.query<{ t_infomask: number; t_xmax: string; xid: string }>(
            `SELECT h.t_infomask, h.t_xmax::text, pg_current_xact_id()::text AS xid
               FROM financial_plans s, heap_page_items(get_raw_page('financial_plans', (s.ctid::text::point)[0]::int)) h
              WHERE s.id = $1 AND h.t_ctid = s.ctid`,
            [draftSet],
          )
        ).rows;
        expect(tuple, "the draft's tuple is locked").toBeDefined();
        expect(tuple!.t_xmax).toBe(tuple!.xid);
        // A share lock, not just the foreign key's key-share, which wouldn't stop a freeze.
        expect(tuple!.t_infomask & LOCK_ONLY).toBe(LOCK_ONLY);
        expect(tuple!.t_infomask & SHARE).toBe(SHARE);
        await tx.rollback();
      });
    });

    it("refuse to move a row to another plan", async () => {
      const { draftOffering, frozen, draftSet } = await plans(db, 2103);
      const other = await w.insert("plans", { financial_plan_id: draftSet, kind: "operations" });
      expect(await w.update("plan_offerings", draftOffering, { plan_id: frozen })).toEqual(refusal(ROW_STAYS));
      expect(await w.update("plan_offerings", draftOffering, { plan_id: other })).toEqual(refusal(ROW_STAYS));
    });
  });

  describe("on a draft plan's rows", () => {
    it("let them be added, changed, and deleted", async () => {
      const { draft, draftOffering, product } = await plans(db, 2104);
      const added = await w.insert("plan_offerings", { plan_id: draft, key: randomUUID(), product_id: product });
      expect(await w.update("plan_offerings", draftOffering, { name: "Changed" })).toBeUndefined();
      expect(await w.remove("plan_offerings", added)).toBeUndefined();
    });

    it("refuse a link to a row in another plan, for every link", async () => {
      const { draft: programDraft, frozen, draftSet } = await plans(db, 2105);
      const operationsDraft = await w.insert("plans", { financial_plan_id: draftSet, kind: "operations" });
      const { links } = config(false);
      // A row in the frozen plan for each table a link points at. Made after the freeze would
      // need them in a draft, so they go straight into the table with the triggers off.
      for (const [table, fields] of Object.entries(links)) {
        // Only an Operations Plan holds a bonus.
        const draft = table.startsWith("plan_bonus_") ? operationsDraft : programDraft;
        for (const [field, target] of Object.entries(fields)) {
          const elsewhere = randomUUID();
          await db.exec(`ALTER TABLE "${target}" DISABLE TRIGGER cyc_frozen_plans`);
          await db.query(`INSERT INTO "${target}" (id, plan_id, key) VALUES ($1, $2, $3)`, [
            elsewhere,
            frozen,
            randomUUID(),
          ]);
          await db.exec(`ALTER TABLE "${target}" ENABLE TRIGGER cyc_frozen_plans`);
          const here = randomUUID();
          await db.query(`INSERT INTO "${target}" (id, plan_id, key) VALUES ($1, $2, $3)`, [here, draft, randomUUID()]);
          expect(
            await w.refusedInsert(table, { plan_id: draft, key: randomUUID(), [field]: elsewhere }),
            `${table}.${field}`,
          ).toEqual(refusal(SAME_PLAN));
          const row = await w.insert(table, { plan_id: draft, key: randomUUID(), [field]: here });
          expect(await w.update(table, row, { [field]: elsewhere }), `${table}.${field}`).toEqual(refusal(SAME_PLAN));
        }
      }
    });
  });

  describe("on a plan", () => {
    it("refuse to add, change, or take one out of a frozen Financial Plan", async () => {
      const { set, frozen, operations } = await plans(db, 2106);
      const other = await w.insert("program_areas", { name: "Another area" });
      expect(
        await w.refusedInsert("plans", { financial_plan_id: set, kind: "program_area", program_area_id: other }),
      ).toEqual(refusal(PLANS_FIXED));
      expect(await w.update("plans", frozen, { notes: JSON.stringify(["Changed"]) })).toEqual(refusal(PLANS_FIXED));
      expect(await w.remove("plans", operations)).toEqual(refusal(PLANS_FIXED));
    });

    it("refuse to move one to another Financial Plan", async () => {
      const { draft, set, organization } = await plans(db, 2112);
      const option = await w.insert("financial_plans", {
        organization_id: organization,
        fiscal_year: 2112,
        status: "draft",
      });
      expect(await w.update("plans", draft, { financial_plan_id: set })).toEqual(refusal(PLAN_STAYS));
      expect(await w.update("plans", draft, { financial_plan_id: option })).toEqual(refusal(PLAN_STAYS));
    });

    it("refuse a program area's plan without its program area, or an Operations Plan with one", async () => {
      const { draftSet, area } = await plans(db, 2125);
      expect(await w.refusedInsert("plans", { financial_plan_id: draftSet, kind: "program_area" })).toEqual(
        refusal(AREA_NAMED),
      );
      expect(
        await w.refusedInsert("plans", { financial_plan_id: draftSet, kind: "operations", program_area_id: area }),
      ).toEqual(refusal(AREA_NAMED));
      const operations = await w.insert("plans", { financial_plan_id: draftSet, kind: "operations" });
      expect(await w.update("plans", operations, { program_area_id: area })).toEqual(refusal(AREA_NAMED));
    });

    it("hold one Operations Plan, and at most one Program Plan for each program area", async () => {
      const { draftSet, draft, area } = await plans(db, 2402);
      const error = await w.refusedInsert("plans", {
        financial_plan_id: draftSet,
        kind: "program_area",
        program_area_id: area,
      });
      expect(error).toEqual(refusal(ONE_PER_AREA));
      expect(error).toMatchObject({ detail: "It already has Test area." });
      await w.insert("plans", { financial_plan_id: draftSet, kind: "operations" });
      expect(await w.refusedInsert("plans", { financial_plan_id: draftSet, kind: "operations" })).toEqual(
        refusal(ONE_PER_AREA),
      );
      // Nor by changing a plan into one the Financial Plan already has.
      const other = await w.insert("program_areas", { name: "Another area" });
      const second = await w.insert("plans", {
        financial_plan_id: draftSet,
        kind: "program_area",
        program_area_id: other,
      });
      expect(await w.update("plans", second, { program_area_id: area })).toEqual(refusal(ONE_PER_AREA));
      expect(await w.update("plans", draft, { notes: JSON.stringify(["Mondays"]) })).toBeUndefined();
    });

    it("take notes only as a list of short ones, each one line", async () => {
      const { draft, draftOffering, product } = await plans(db, 2126);
      for (const notes of [["x".repeat(281)], ["Two\nlines"], [1], { a: "b" }, "Mondays"]) {
        expect(await w.update("plans", draft, { notes: JSON.stringify(notes) }), JSON.stringify(notes)).toEqual(
          refusal(SHORT_NOTES),
        );
      }
      for (const notes of [["x".repeat(280), "**Mondays**"], [], null]) {
        expect(await w.update("plans", draft, { notes: notes && JSON.stringify(notes) })).toBeUndefined();
      }
      expect(
        await w.refusedInsert("plan_programs", {
          plan_id: draft,
          key: randomUUID(),
          product_id: product,
          notes: JSON.stringify(["x".repeat(281)]),
        }),
      ).toEqual(refusal(SHORT_NOTES));
      await w.insert("plan_programs", {
        plan_id: draft,
        key: randomUUID(),
        product_id: product,
        notes: JSON.stringify(["Up to 8 sailors"]),
      });
      expect(draftOffering).toBeDefined();
    });
  });

  describe("on a Financial Plan", () => {
    it("freeze it, and stamp when", async () => {
      const { set } = await plans(db, 2301);
      expect(await w.read("financial_plans", set)).toMatchObject({ status: "frozen", frozen_at: expect.any(Date) });
    });

    it("refuse to freeze one without an Operations Plan", async () => {
      const { draftSet } = await plans(db, 2302);
      expect(await w.update("financial_plans", draftSet, { status: "frozen", platform_version: "1.4.0" })).toEqual(
        refusal(NEEDS_OPERATIONS),
      );
      expect(await w.read("financial_plans", draftSet)).toMatchObject({ status: "draft" });
    });

    it("refuse to freeze one without a platform version", async () => {
      const { draftSet } = await plans(db, 2303);
      for (const platform of [null, "", " "]) {
        expect(await w.update("financial_plans", draftSet, { status: "frozen", platform_version: platform })).toEqual(
          refusal(NEEDS_PLATFORM),
        );
      }
    });

    it("refuse a new one that isn't a draft", async () => {
      const { organization } = await plans(db, 2304);
      expect(
        await w.refusedInsert("financial_plans", {
          organization_id: organization,
          fiscal_year: 2304,
          status: "frozen",
        }),
      ).toEqual(refusal("A new Financial Plan starts as a draft."));
    });

    it("let a frozen one's name and note change, and nothing else", async () => {
      const { set } = await plans(db, 2305);
      expect(await w.update("financial_plans", set, { note: "Reviewed with the board" })).toBeUndefined();
      expect(await w.update("financial_plans", set, { name: "Board budget" })).toBeUndefined();
      for (const change of [
        { platform_version: "9.9.9" },
        { status: "draft" },
        { note: "Adopted", platform_version: "9.9.9" },
      ]) {
        expect(await w.update("financial_plans", set, change), JSON.stringify(change)).toEqual(refusal(SET_STAYS));
      }
      expect(await w.remove("financial_plans", set)).toEqual(refusal(SET_STAYS));
      expect(await w.read("financial_plans", set)).toMatchObject({
        note: "Reviewed with the board",
        name: "Board budget",
        platform_version: "1.4.0",
      });
    });

    it("refuse to change a draft's organization, year, or parent", async () => {
      const { draftSet } = await plans(db, 2306);
      const other = await plans(db, 2307);
      for (const change of [{ organization_id: other.organization }, { fiscal_year: 2308 }, { parent_id: null }]) {
        expect(await w.update("financial_plans", draftSet, change), JSON.stringify(change)).toEqual(
          refusal("A Financial Plan's organization, year, and parent can't change."),
        );
      }
      expect(await w.update("financial_plans", draftSet, { name: "Three coaches" })).toBeUndefined();
    });

    it("start only from one for the same organization and year", async () => {
      const { organization, set } = await plans(db, 2309);
      expect(
        await w.refusedInsert("financial_plans", {
          organization_id: organization,
          fiscal_year: 2310,
          status: "draft",
          parent_id: set,
        }),
      ).toEqual(refusal("A Financial Plan can only start from one for the same organization and year."));
    });

    it("allow several drafts for one year", async () => {
      const { organization, set } = await plans(db, 2311);
      const another = { organization_id: organization, fiscal_year: 2311, status: "draft", parent_id: set };
      expect(await w.insert("financial_plans", { ...another, name: "Two coaches" })).toEqual(expect.any(String));
      expect(await w.insert("financial_plans", { ...another, name: "Three coaches" })).toEqual(expect.any(String));
    });

    it("let a draft be deleted, with its plans and every row in them", async () => {
      const { draftSet, draft, product } = await plans(db, 2312);
      // Rows that link to each other, which a cascade deletes together.
      const offering = await w.insert("plan_offerings", { plan_id: draft, key: randomUUID(), product_id: product });
      const block = await w.insert("plan_activity_blocks", { plan_id: draft, key: randomUUID(), date: "2312-06-06" });
      await w.insert("plan_activities", {
        plan_id: draft,
        key: randomUUID(),
        offering_id: offering,
        block_id: block,
        date: "2312-06-06",
      });
      await w.insert("plan_block_staff", { plan_id: draft, key: randomUUID(), block_id: block, count: 1 });
      expect(await w.remove("financial_plans", draftSet)).toBeUndefined();
      expect(await w.read("plans", draft)).toBeUndefined();
      for (const table of ["plan_offerings", "plan_activities", "plan_activity_blocks", "plan_block_staff"]) {
        expect((await db.query(`SELECT 1 FROM "${table}" WHERE plan_id = $1`, [draft])).rows, table).toEqual([]);
      }
    });
  });

  describe("on the date a Financial Plan is active from", () => {
    /** The day `days` from the database's today, as `YYYY-MM-DD`. */
    const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it("take a date on a draft or a frozen one, and a change to it", async () => {
      const { set, draftSet } = await plans(db, 2501);
      expect(await w.update("financial_plans", set, { effective_from: "2500-07-01", note: "Adopted" })).toBeUndefined();
      expect(await w.update("financial_plans", draftSet, { effective_from: "2500-09-01" })).toBeUndefined();
      expect(await w.update("financial_plans", set, { effective_from: "2500-08-01" })).toBeUndefined();
      expect(await w.update("financial_plans", draftSet, { effective_from: null })).toBeUndefined();
      expect(await w.read("financial_plans", set)).toMatchObject({ status: "frozen", note: "Adopted" });
    });

    it("refuse two Financial Plans for a year active from the same date, but not in another year", async () => {
      const { set, draftSet } = await plans(db, 2502);
      const otherYear = await plans(db, 2503);
      expect(await w.update("financial_plans", set, { effective_from: "2501-10-01" })).toBeUndefined();
      expect(await w.update("financial_plans", draftSet, { effective_from: "2501-10-01" })).toEqual(
        refusal(ONE_PER_DATE),
      );
      expect(await w.update("financial_plans", otherYear.set, { effective_from: "2501-10-01" })).toBeUndefined();
    });

    it("keep one Financial Plan for a year active from each date, even past the trigger", async () => {
      const { set, draftSet } = await plans(db, 2504);
      expect(await w.update("financial_plans", set, { effective_from: "2503-10-01" })).toBeUndefined();
      await db.exec("ALTER TABLE financial_plans DISABLE TRIGGER USER");
      const error = await w.update("financial_plans", draftSet, { effective_from: "2503-10-01" });
      await db.exec("ALTER TABLE financial_plans ENABLE TRIGGER USER");
      expect(error).toMatchObject({ code: "23505" });
    });

    it("refuse archiving the plan in force, or one active from a later date, but not one another took over from", async () => {
      const { set, draftSet } = await plans(db, 2505);
      const archived = { archived_at: new Date().toISOString() };
      expect(await w.update("financial_plans", set, { effective_from: day(-30) })).toBeUndefined();
      expect(await w.update("financial_plans", set, archived)).toEqual(refusal(IN_FORCE_NOT_ARCHIVED));
      expect(await w.update("financial_plans", draftSet, { effective_from: day(30) })).toBeUndefined();
      expect(await w.update("financial_plans", draftSet, archived)).toEqual(refusal(IN_FORCE_NOT_ARCHIVED));
      expect(await w.update("financial_plans", draftSet, { effective_from: day(-1) })).toBeUndefined();
      expect(await w.update("financial_plans", set, archived)).toBeUndefined();
      expect(await w.update("financial_plans", draftSet, archived)).toEqual(refusal(IN_FORCE_NOT_ARCHIVED));
    });

    it("refuse a date on an archived Financial Plan", async () => {
      const { draftSet } = await plans(db, 2506);
      expect(await w.update("financial_plans", draftSet, { archived_at: new Date().toISOString() })).toBeUndefined();
      expect(await w.update("financial_plans", draftSet, { effective_from: "2505-07-01" })).toEqual(
        refusal(ARCHIVED_NOT_ACTIVE),
      );
      expect(
        await w.update("financial_plans", draftSet, { effective_from: "2505-07-01", archived_at: null }),
      ).toBeUndefined();
    });

    it("refuse deleting an active draft until its date is cleared", async () => {
      const { draftSet } = await plans(db, 2507);
      expect(await w.update("financial_plans", draftSet, { effective_from: "2506-07-01" })).toBeUndefined();
      expect(await w.remove("financial_plans", draftSet)).toEqual(refusal(ACTIVE_STAYS));
      expect(await w.update("financial_plans", draftSet, { effective_from: null })).toBeUndefined();
      expect(await w.remove("financial_plans", draftSet)).toBeUndefined();
    });

    it("keep a frozen one frozen, whatever its date", async () => {
      const { set } = await plans(db, 2508);
      expect(await w.update("financial_plans", set, { effective_from: "2507-07-01" })).toBeUndefined();
      expect(await w.update("financial_plans", set, { status: "draft" })).toEqual(refusal(SET_STAYS));
      expect(await w.update("financial_plans", set, { platform_version: "9.9.9" })).toEqual(refusal(SET_STAYS));
      expect(await w.update("financial_plans", set, { name: "Adopted" })).toBeUndefined();
      expect(await w.remove("financial_plans", set)).toEqual(refusal(SET_STAYS));
    });
  });

  describe("on a bonus", () => {
    it("refuse one in a Program Plan, and take one in an Operations Plan", async () => {
      const { draft, draftSet } = await plans(db, 2509);
      const operations = await w.insert("plans", { financial_plan_id: draftSet, kind: "operations" });
      expect(await w.refusedInsert("plan_bonus_owners", { plan_id: draft, key: randomUUID() })).toEqual(
        refusal(BONUS_IN_OPERATIONS),
      );
      const owner = await w.insert("plan_bonus_owners", { plan_id: operations, key: randomUUID() });
      expect(await w.refusedInsert("plan_bonus_owner_products", { plan_id: draft, key: randomUUID() })).toEqual(
        refusal(BONUS_IN_OPERATIONS),
      );
      await w.insert("plan_bonus_owner_products", { plan_id: operations, key: randomUUID(), bonus_owner_id: owner });
    });
  });

  it("stay in place when a schema apply changes a table", async () => {
    const { frozenOffering } = await plans(db, 2124);
    await db.exec(`ALTER TABLE plan_offerings ADD COLUMN extra integer`);
    await db.exec(`ALTER TABLE plan_offerings ALTER COLUMN name TYPE text`);
    await db.exec(`ALTER TABLE plan_offerings ALTER COLUMN capacity SET NOT NULL`).catch(() => undefined);
    expect(await w.update("plan_offerings", frozenOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
  });

  it("install again in place, without a second trigger", async () => {
    await db.exec(`DROP TRIGGER cyc_frozen_plans ON plan_trips`);
    await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_trigger WHERE tgname = 'cyc_frozen_plans' AND tgrelid = 'plan_offerings'::regclass`,
    );
    expect(rows[0]!.count).toBe(1);
  });
});

describe("installing the frozen-plans triggers", { timeout: 30_000 }, () => {
  it("waits until every planning table has the columns they read", async () => {
    const db = await PGlite.create();
    for (const statement of tables()) await db.exec(statement);
    await db.exec(`ALTER TABLE plans DROP COLUMN notes`);
    const { missing } = await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect(missing).toEqual(["plans"]);
    const { rows } = await db.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'cyc_frozen_plans'`);
    expect(rows).toEqual([]);
  });

  it("skips the install when the triggers it would install are already there", async () => {
    const db = await database(config(false));
    const again = () => db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect(await again()).toEqual({ missing: [], installed: false });
    // A table a schema apply made again has lost its trigger.
    await db.exec(`DROP TRIGGER cyc_frozen_plans ON plan_trips`);
    expect(await again()).toEqual({ missing: [], installed: true });
    // So has a config that changed, such as dev's flag.
    expect(await db.transaction((tx) => installTriggers(config(true), connect(tx)))).toEqual({
      missing: [],
      installed: true,
    });
  });

  it("gives up after a few seconds waiting for a lock, instead of holding up Directus's start", async () => {
    const db = await database(config(false));
    const timeout = await db.transaction(async (tx) => {
      await installTriggers(config(false), connect(tx));
      return (await tx.query<{ lock_timeout: string }>(`SHOW lock_timeout`)).rows[0]!.lock_timeout;
    });
    expect(timeout).toBe("5s");
    expect((await db.query<{ lock_timeout: string }>(`SHOW lock_timeout`)).rows[0]!.lock_timeout).toBe("0");
  });

  it("reports a table that lacks its trigger", async () => {
    const db = await database(config(false));
    await db.exec(`DROP TRIGGER cyc_frozen_plans ON plan_trips`);
    const status = await db.transaction((tx) => triggerStatus(config(false), connect(tx)));
    expect(status.tables).toMatchObject({
      plan_trips: false,
      plan_offerings: true,
      plans: true,
      financial_plans: true,
    });
    expect(status.fingerprint).toBe(fingerprint(config(false)));
    expect(fingerprint(config(true))).not.toBe(fingerprint(config(false)));
  });

  // knex reads a ? as a binding, even in a statement with none.
  it("writes no ? into its SQL", () => {
    expect(triggerStatements(config(true)).join("\n")).not.toContain("?");
  });
});

describe("the frozen-plans triggers with dev's flag", { timeout: 30_000 }, () => {
  it("let an active frozen Financial Plan be deleted, with its plans and rows, but not changed", async () => {
    const db = await database(config(true));
    const w = writer(db);
    const { set, frozen, draftSet, frozenOffering } = await plans(db);
    expect(await w.update("financial_plans", set, { effective_from: "2026-07-01" })).toBeUndefined();
    expect(await w.update("financial_plans", set, { platform_version: "9.9.9" })).toEqual(refusal(SET_STAYS));
    expect(await w.update("plan_offerings", frozenOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
    expect(await w.update("plans", frozen, { notes: JSON.stringify(["Changed"]) })).toEqual(refusal(PLANS_FIXED));
    // The draft started from it goes first, since it points at it.
    expect(await w.remove("financial_plans", draftSet)).toBeUndefined();
    expect(await w.remove("financial_plans", set)).toBeUndefined();
    expect(await w.read("plans", frozen)).toBeUndefined();
    expect(await w.read("plan_offerings", frozenOffering)).toBeUndefined();
  });
});

/**
 * Just enough of knex, over PGlite, for `copyParent` and the results: a builder that runs when
 * awaited, with `where`, `whereIn`, `select`, `first`, `forShare`, `insert`, `update`, and `delete`,
 * and `raw` and `transaction` on the root.
 */
function knexOver(db: PGlite | Transaction): unknown {
  const query = async (sql: string, params: unknown[]) => (await db.query<Values>(sql, params)).rows;
  const builder = (table: string) => {
    const where: [string, unknown[]][] = [];
    let columns = "*";
    let lock = "";
    let one = false;
    const clause = (offset = 0) => {
      const params: unknown[] = [];
      const parts = where.map(([column, values]) => {
        const marks = values.map((value) => {
          params.push(value);
          return `$${offset + params.length}`;
        });
        return `"${column}" IN (${marks.join(", ") || "NULL"})`;
      });
      return { sql: parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "", params };
    };
    const run = async () => {
      const { sql, params } = clause();
      const rows = await query(`SELECT ${columns} FROM "${table}"${sql}${lock}`, params);
      return one ? rows[0] : rows;
    };
    const self = {
      where: (column: string, value: unknown) => (where.push([column, [value]]), self),
      whereIn: (column: string, values: unknown[]) => (where.push([column, values]), self),
      select: (...list: string[]) => {
        columns = list.length === 0 || list.includes("*") ? "*" : list.map((c) => `"${c}"`).join(", ");
        return self;
      },
      first: () => ((one = true), self),
      forShare: () => ((lock = " FOR SHARE"), self),
      then: <T>(resolve: (rows: unknown) => T, reject: (error: unknown) => T) => run().then(resolve, reject),
      insert: async (rows: Values | Values[]) => {
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const names = Object.keys(row);
          await query(
            `INSERT INTO "${table}" (${names.map((c) => `"${c}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
            Object.values(row),
          );
        }
      },
      update: async (values: Values) => {
        const names = Object.keys(values);
        const { sql, params } = clause(names.length);
        await query(`UPDATE "${table}" SET ${names.map((c, i) => `"${c}" = $${i + 1}`).join(", ")}${sql}`, [
          ...Object.values(values),
          ...params,
        ]);
      },
      delete: async () => {
        const { sql, params } = clause();
        await query(`DELETE FROM "${table}"${sql}`, params);
      },
    };
    return self;
  };
  return Object.assign(builder, {
    raw: (sql: string, bindings: unknown[] = []) => {
      let n = 0;
      return query(
        sql.replace(/\?/g, () => `$${++n}`),
        bindings,
      );
    },
    transaction: <T>(fn: (trx: unknown) => Promise<T>) =>
      "transaction" in db ? db.transaction((tx) => fn(knexOver(tx))) : fn(knexOver(db)),
  });
}

describe("starting a Financial Plan from another", { timeout: 30_000 }, () => {
  it("copies each plan in the parent into a draft, with every row, its key, and its links", async () => {
    const db = await database(config(false));
    const w = writer(db);
    const { organization, set, frozen, operations, frozenOffering } = await plans(db, 2601);
    await db.exec("ALTER TABLE plans DISABLE TRIGGER USER");
    await db.query("UPDATE plans SET notes = $2 WHERE id = $1", [frozen, JSON.stringify(["Mondays"])]);
    await db.exec("ALTER TABLE plans ENABLE TRIGGER USER");
    const original = (await w.read("plan_offerings", frozenOffering))!;
    const child = await w.insert("financial_plans", {
      organization_id: organization,
      fiscal_year: 2601,
      name: "Three coaches",
      status: "draft",
      parent_id: set,
    });
    expect(await copyParent(config(false), knexOver(db), child)).toBe(true);
    const copies = (await db.query<Values>(`SELECT * FROM plans WHERE financial_plan_id = $1`, [child])).rows;
    expect(copies.map((p) => p["kind"]).sort()).toEqual(["operations", "program_area"]);
    expect(copies.some((p) => p["id"] === frozen || p["id"] === operations)).toBe(false);
    const copy = copies.find((p) => p["kind"] === "program_area")!;
    expect(copy).toMatchObject({ notes: ["Mondays"] });
    const [offering] = (await db.query<Values>(`SELECT * FROM plan_offerings WHERE plan_id = $1`, [copy["id"]])).rows;
    expect(offering).toMatchObject({ key: original["key"], name: "Offering" });
    expect(offering!["id"]).not.toBe(frozenOffering);
    const [activity] = (await db.query<Values>(`SELECT * FROM plan_activities WHERE plan_id = $1`, [copy["id"]])).rows;
    const [block] = (await db.query<Values>(`SELECT * FROM plan_activity_blocks WHERE plan_id = $1`, [copy["id"]]))
      .rows;
    expect(activity).toMatchObject({ offering_id: offering!["id"], block_id: block!["id"] });
    const operationsCopy = copies.find((p) => p["kind"] === "operations")!;
    const [charge] = (
      await db.query<Values>(`SELECT * FROM plan_revenue_charges WHERE plan_id = $1`, [operationsCopy["id"]])
    ).rows;
    expect(charge).toMatchObject({ product_kinds: ["program", "charter"] });
    // The copy is a draft, so it can change, and the parent stays as it was.
    expect(await w.update("plan_offerings", offering!["id"] as string, { name: "Changed" })).toBeUndefined();
    expect((await w.read("plan_offerings", frozenOffering))!["name"]).toBe("Offering");
    // A second try copies nothing more.
    expect(await copyParent(config(false), knexOver(db), child)).toBe(false);
  });

  it("does nothing for a Financial Plan with no parent", async () => {
    const db = await database(config(false));
    const { organization } = await plans(db, 2602);
    const w = writer(db);
    const fresh = await w.insert("financial_plans", {
      organization_id: organization,
      fiscal_year: 2602,
      status: "draft",
    });
    expect(await copyParent(config(false), knexOver(db), fresh)).toBe(false);
  });

  it("copies a table only after every table it links to", () => {
    const order = copyOrder(config(false));
    for (const [table, links] of Object.entries(config(false).links)) {
      for (const linked of Object.values(links)) {
        if (linked !== table) expect(order.indexOf(linked), `${table} → ${linked}`).toBeLessThan(order.indexOf(table));
      }
    }
  });
});

describe("working out a Financial Plan's results", { timeout: 30_000 }, () => {
  const engine = { computePlan };
  const count = async (db: PGlite, table: string, set: string) =>
    (await db.query(`SELECT 1 FROM "${table}" WHERE financial_plan_id = $1`, [set])).rows.length;
  const totals = async (db: PGlite, set: string) =>
    (await db.query<Values>(`SELECT * FROM plan_results WHERE financial_plan_id = $1`, [set])).rows;

  /** A draft holding an Operations Plan and the program area's plan. */
  async function draft(db: PGlite, year: number) {
    const w = writer(db);
    const made = await plans(db, year);
    const operations = await w.insert("plans", { financial_plan_id: made.draftSet, kind: "operations" });
    return { ...made, w, draftOperations: operations };
  }

  it("works out a draft's results again in place of the ones it had", async () => {
    const db = await database(config(false));
    const { draftSet, draftOffering, w } = await draft(db, 2801);
    expect(await writeDraftResults(config(false), knexOver(db), draftSet, engine)).toBe(true);
    const [first] = await totals(db, draftSet);
    expect(first).toBeDefined();
    expect(await w.update("plan_offerings", draftOffering, { name: "Renamed" })).toBeUndefined();
    expect(await writeDraftResults(config(false), knexOver(db), draftSet, engine)).toBe(true);
    const again = await totals(db, draftSet);
    expect(again).toHaveLength(1);
    expect(again[0]!["id"]).not.toBe(first!["id"]);
  });

  it("clears a draft's results when the engine fails, and says why", async () => {
    const db = await database(config(false));
    const { draftSet } = await draft(db, 2802);
    await writeDraftResults(config(false), knexOver(db), draftSet, engine);
    const broken = {
      computePlan: () => {
        throw new Error("No rates");
      },
    };
    await expect(writeDraftResults(config(false), knexOver(db), draftSet, broken)).rejects.toThrow("No rates");
    expect(await count(db, "plan_results", draftSet)).toBe(0);
  });

  it("clears a draft's results when writing them fails in the database", async () => {
    const db = await database(config(false));
    const { draftSet } = await draft(db, 2806);
    await writeDraftResults(config(false), knexOver(db), draftSet, engine);
    // A line booked to an account that doesn't exist, which the foreign key refuses.
    const unbookable = {
      computePlan: (data: Parameters<typeof computePlan>[0]) => {
        const out = computePlan(data);
        const line = {
          cost_center_type: "organization",
          cost_center_key: null,
          account_id: randomUUID(),
          function: "program",
          amount_cents: 1,
          line_key: "x",
          line_name: "X",
          explanation: null,
        };
        return { ...out, lines: [...out.lines, line] };
      },
    };
    await expect(writeDraftResults(config(false), knexOver(db), draftSet, unbookable)).rejects.toThrow();
    expect(await count(db, "plan_results", draftSet)).toBe(0);
  });

  it("names the plan and the date each warning is about", async () => {
    const db = await database(config(false));
    const { draftSet, draft: plan, draftOffering, w } = await draft(db, 2807);
    expect(
      await w.update("plan_offerings", draftOffering, { starts_on: "2807-06-01", ends_on: "2807-06-30" }),
    ).toBeUndefined();
    await w.insert("plan_activities", {
      plan_id: plan,
      key: randomUUID(),
      offering_id: draftOffering,
      date: "2807-06-06",
      kind: "practice",
    });
    expect(await writeDraftResults(config(false), knexOver(db), draftSet, engine)).toBe(true);
    const { rows } = await db.query<Values>(
      `SELECT plan_id, to_char(date, 'YYYY-MM-DD') AS date, category FROM plan_result_warnings
        WHERE financial_plan_id = $1 AND code = 'unallocated_activity'`,
      [draftSet],
    );
    expect(rows).toEqual([{ plan_id: plan, date: "2807-06-06", category: "allocation" }]);
  });

  it("leaves a frozen Financial Plan's results to its freeze", async () => {
    const db = await database(config(false));
    const { set } = await plans(db, 2803);
    expect(await writeDraftResults(config(false), knexOver(db), set, engine)).toBe(false);
    expect(await writeSetResults(config(false), knexOver(db), set, engine)).toBe(true);
    expect(await writeDraftResults(config(false), knexOver(db), set, engine)).toBe(false);
    expect(await writeSetResults(config(false), knexOver(db), set, engine)).toBe(false);
    expect(await count(db, "plan_results", set)).toBe(1);
  });

  it("finds the drafts a change to a plan's rows, its plan, or the catalog changes", async () => {
    const db = await database(config(false));
    const { draftSet, draft: plan, draftOffering, frozenOffering, frozen, product } = await draft(db, 2804);
    const other = await draft(db, 2805);
    const knex = knexOver(db);
    const changes = (collection: string, keys: string[]) => draftsChangedBy(config(false), knex, collection, keys);
    expect(await changes("plan_offerings", [draftOffering])).toEqual([draftSet]);
    // A frozen Financial Plan's results never change.
    expect(await changes("plan_offerings", [frozenOffering])).toEqual([]);
    expect(await changes("plans", [frozen])).toEqual([]);
    expect(await changes("plans", [plan])).toEqual([draftSet]);
    expect((await changes("products", [product])).sort()).toEqual(
      expect.arrayContaining([draftSet, other.draftSet].sort()),
    );
    expect(await changes("directus_users", [randomUUID()])).toEqual([]);
  });
});
