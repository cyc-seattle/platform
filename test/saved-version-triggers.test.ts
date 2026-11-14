import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import * as yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { savedVersionsConfig, type SavedVersionsConfig } from "../stacks/backend/policies.ts";
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
  MEMBERS_FIXED,
  NEEDS_OPERATIONS,
  ONE_PER_AREA,
  ONE_PER_DATE,
  REFUSED,
  RESULTS_BY_SAVE,
  SAVED_WITH_SET,
  SET_STAYS,
  triggerStatements,
  triggerStatus,
  writeDraftResults,
  writeSetResults,
} from "../stacks/backend/saved-versions.cjs";
import { computePlan } from "../src/planning/index.ts";

// The saved-versions hook's triggers, in a real Postgres (PGlite), on tables made from the schemas:
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

async function database(config: SavedVersionsConfig): Promise<PGlite> {
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

const config = (deletable: boolean) => savedVersionsConfig(schemas, deletable, "1.0.0+engine.abc");

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

const NEEDS_PLATFORM = "Saving a Financial Plan needs the @cyc-seattle/platform version that calculated it.";

const refusal = (message: string) => expect.objectContaining({ code: "CY001", message });

/**
 * An organization's year: a saved Financial Plan holding the Operations Plan and a program area's
 * plan, and a draft Financial Plan started from it, holding a draft copy of the program area's plan.
 */
async function plans(db: PGlite, year = 2027) {
  const w = writer(db);
  const organization = await w.insert("organizations", { name: "Test club", kind: "own", fiscal_year_start_month: 10 });
  const area = await w.insert("program_areas", { name: "Test area" });
  const product = await w.insert("products", { name: "Test product", kind: "program", program_area_id: area });
  const kind = await w.insert("resource_kinds", { name: "Safety boat" });
  const operationsPlan = await w.insert("plans", {
    kind: "operations",
    organization_id: organization,
    fiscal_year: year,
    name: "Operations",
  });
  const plan = await w.insert("plans", {
    kind: "program_area",
    program_area_id: area,
    organization_id: organization,
    fiscal_year: year,
    name: "Program area",
  });
  const set = await w.insert("version_sets", {
    organization_id: organization,
    fiscal_year: year,
    name: "Budget",
    status: "draft",
  });
  const operations = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
  await w.insert("plan_rates", { version_id: operations, key: randomUUID(), rib_resource_kind_id: kind });
  const saved = await w.insert("plan_versions", { plan_id: plan, status: "draft" });
  const offering = async (version: string) =>
    w.insert("plan_offerings", { version_id: version, key: randomUUID(), product_id: product, name: "Offering" });
  const savedOffering = await offering(saved);
  const block = await w.insert("plan_activity_blocks", {
    version_id: saved,
    key: randomUUID(),
    date: `${year}-06-06`,
    name: "Saturday morning",
  });
  await w.insert("plan_activities", {
    version_id: saved,
    key: randomUUID(),
    offering_id: savedOffering,
    date: `${year}-06-06`,
    block_id: block,
  });
  await w.insert("plan_revenue_charges", {
    version_id: operations,
    key: randomUUID(),
    name: "Card fees",
    rate: 0,
    product_kinds: JSON.stringify(["program", "charter"]),
  });
  await w.insert("version_set_members", { version_set_id: set, version_id: operations });
  await w.insert("version_set_members", { version_set_id: set, version_id: saved });
  expect(await w.update("version_sets", set, { status: "saved", platform_version: "1.4.0" })).toBeUndefined();

  const draftSet = await w.insert("version_sets", {
    organization_id: organization,
    fiscal_year: year,
    name: "Next",
    status: "draft",
    parent_id: set,
  });
  const draft = await w.insert("plan_versions", { plan_id: plan, status: "draft", parent_version_id: saved });
  const draftOffering = await offering(draft);
  await w.insert("version_set_members", { version_set_id: draftSet, version_id: draft });
  return {
    organization,
    area,
    product,
    operationsPlan,
    operations,
    plan,
    set,
    saved,
    draftSet,
    draft,
    savedOffering,
    draftOffering,
  };
}

/** The id of a Financial Plan's member that holds `version`. */
async function memberOf(db: PGlite, version: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM version_set_members WHERE version_id = $1`, [
    version,
  ]);
  return rows[0]!.id;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the saved-versions triggers", { timeout: 30_000 }, () => {
  let db: PGlite;
  let w: ReturnType<typeof writer>;
  beforeAll(async () => {
    db = await database(config(false));
    w = writer(db);
  }, 30_000);

  describe("on a Financial Plan's results", () => {
    /** Writes a warning and then the totals for `set`, as the hook does; returns the error, if any. */
    const hookWrites = async (set: string) => {
      try {
        await db.transaction(async (tx) => {
          await tx.exec("SET LOCAL cyc.writing_results = 'on'");
          await tx.query(
            `INSERT INTO plan_result_warnings (id, version_set_id, code, message) VALUES ($1, $2, 'x', 'y')`,
            [randomUUID(), set],
          );
          await tx.query(`INSERT INTO plan_results (id, version_set_id, total_cents) VALUES ($1, $2, 0)`, [
            randomUUID(),
            set,
          ]);
        });
        return undefined;
      } catch (error) {
        return error as { code?: string; message: string };
      }
    };

    it("let only the hook write a saved Financial Plan's results, once", async () => {
      const { set } = await plans(db, 2201);
      expect(await w.refusedInsert("plan_result_warnings", { version_set_id: set, code: "x", message: "y" })).toEqual(
        refusal(RESULTS_BY_SAVE),
      );
      expect(await hookWrites(set)).toBeUndefined();
      expect(await hookWrites(set)).toEqual(refusal(RESULTS_BY_SAVE));
    });

    it("let only the hook write or clear a draft's results", async () => {
      const { draftSet } = await plans(db, 2202);
      expect(await w.refusedInsert("plan_results", { version_set_id: draftSet, total_cents: 0 })).toEqual(
        refusal(RESULTS_BY_SAVE),
      );
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(await hookWrites(draftSet)).toEqual(refusal(RESULTS_BY_SAVE));
      const [{ id }] = (
        await db.query<{ id: string }>(`SELECT id FROM plan_results WHERE version_set_id = $1`, [draftSet])
      ).rows as [{ id: string }];
      expect(await w.update("plan_results", id, { total_cents: 1 })).toEqual(refusal(RESULTS_BY_SAVE));
      expect(await w.remove("plan_results", id)).toEqual(refusal(RESULTS_BY_SAVE));
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL cyc.writing_results = 'on'");
        await tx.query(`DELETE FROM plan_result_warnings WHERE version_set_id = $1`, [draftSet]);
        await tx.query(`DELETE FROM plan_results WHERE version_set_id = $1`, [draftSet]);
      });
      expect(await hookWrites(draftSet)).toBeUndefined();
    });

    it("clear a draft's results when it's saved, for the hook to write again", async () => {
      const { draftSet, operationsPlan } = await plans(db, 2204);
      const operations = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      await w.insert("version_set_members", { version_set_id: draftSet, version_id: operations });
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(await w.update("version_sets", draftSet, { status: "saved", platform_version: "1.4.0" })).toBeUndefined();
      for (const table of ["plan_results", "plan_result_warnings"]) {
        const { rows } = await db.query(`SELECT 1 FROM "${table}" WHERE version_set_id = $1`, [draftSet]);
        expect(rows, table).toEqual([]);
      }
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(await hookWrites(draftSet)).toEqual(refusal(RESULTS_BY_SAVE));
    });

    it("let a draft with results be deleted, or a plan be taken out of it", async () => {
      const { draftSet, draft } = await plans(db, 2205);
      const member = await memberOf(db, draft);
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL cyc.writing_results = 'on'");
        await tx.query(
          `INSERT INTO plan_result_pnl (id, version_set_id, version_set_member_id, level) VALUES ($1, $2, $3, 'offering')`,
          [randomUUID(), draftSet, member],
        );
      });
      expect(await w.remove("version_set_members", member)).toBeUndefined();
      expect(await hookWrites(draftSet)).toBeUndefined();
      expect(await w.remove("version_sets", draftSet)).toBeUndefined();
    });

    it("refuse to change or delete them", async () => {
      const { set } = await plans(db, 2203);
      await hookWrites(set);
      const [{ id }] = (await db.query<{ id: string }>(`SELECT id FROM plan_results WHERE version_set_id = $1`, [set]))
        .rows as [{ id: string }];
      expect(await w.update("plan_results", id, { total_cents: 1 })).toEqual(refusal(RESULTS_BY_SAVE));
      expect(await w.remove("plan_results", id)).toEqual(refusal(RESULTS_BY_SAVE));
    });
  });

  describe("on a saved plan's rows", () => {
    it("refuse to add, change, or delete one", async () => {
      const { saved, savedOffering, product } = await plans(db, 2101);
      expect(
        await w.refusedInsert("plan_offerings", { version_id: saved, key: randomUUID(), product_id: product }),
      ).toEqual(refusal(REFUSED));
      expect(await w.update("plan_offerings", savedOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
      expect(await w.remove("plan_offerings", savedOffering)).toEqual(refusal(REFUSED));
      expect((await w.read("plan_offerings", savedOffering))?.["name"]).toBe("Offering");
    });

    it("lock the version inside the write's transaction, so a save waits for the write", async () => {
      const { draft, product } = await plans(db, 2102);
      // A row lock lives in the version's tuple: its xmax, and these bits of its infomask.
      const LOCK_ONLY = 0x0080;
      const SHARE = 0x0050;
      await db.transaction(async (tx) => {
        await tx.query(`INSERT INTO plan_offerings (id, version_id, key, product_id) VALUES ($1, $2, $3, $4)`, [
          randomUUID(),
          draft,
          randomUUID(),
          product,
        ]);
        const [tuple] = (
          await tx.query<{ t_infomask: number; t_xmax: string; xid: string }>(
            `SELECT h.t_infomask, h.t_xmax::text, pg_current_xact_id()::text AS xid
               FROM plan_versions v, heap_page_items(get_raw_page('plan_versions', (v.ctid::text::point)[0]::int)) h
              WHERE v.id = $1 AND h.t_ctid = v.ctid`,
            [draft],
          )
        ).rows;
        expect(tuple, "the draft's tuple is locked").toBeDefined();
        expect(tuple!.t_xmax).toBe(tuple!.xid);
        // A share lock, not just the foreign key's key-share, which wouldn't stop a save.
        expect(tuple!.t_infomask & LOCK_ONLY).toBe(LOCK_ONLY);
        expect(tuple!.t_infomask & SHARE).toBe(SHARE);
        await tx.rollback();
      });
    });

    it("refuse to move a row to another version", async () => {
      const { draftOffering, saved, plan } = await plans(db, 2103);
      const otherDraft = await w.insert("plan_versions", { plan_id: plan, status: "draft" });
      const message = "A plan row can't move to another version. Copy it into that version instead.";
      expect(await w.update("plan_offerings", draftOffering, { version_id: saved })).toEqual(refusal(message));
      expect(await w.update("plan_offerings", draftOffering, { version_id: otherDraft })).toEqual(refusal(message));
    });
  });

  describe("on a draft plan's rows", () => {
    it("let them be added, changed, and deleted", async () => {
      const { draft, draftOffering, product } = await plans(db, 2104);
      const added = await w.insert("plan_offerings", { version_id: draft, key: randomUUID(), product_id: product });
      expect(await w.update("plan_offerings", draftOffering, { name: "Changed" })).toBeUndefined();
      expect(await w.remove("plan_offerings", added)).toBeUndefined();
    });

    it("refuse a link to a row in another version, for every link", async () => {
      const { draft: programDraft, saved, operationsPlan } = await plans(db, 2105);
      const operationsDraft = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      const { links } = config(false);
      // A row in the saved version for each table a link points at. Made after the save would
      // need them in a draft, so they go straight into the table with the triggers off.
      for (const [table, fields] of Object.entries(links)) {
        // Only an Operations Plan holds a bonus.
        const draft = table.startsWith("plan_bonus_") ? operationsDraft : programDraft;
        for (const [field, target] of Object.entries(fields)) {
          const elsewhere = randomUUID();
          await db.exec(`ALTER TABLE "${target}" DISABLE TRIGGER cyc_saved_versions`);
          await db.query(`INSERT INTO "${target}" (id, version_id, key) VALUES ($1, $2, $3)`, [
            elsewhere,
            saved,
            randomUUID(),
          ]);
          await db.exec(`ALTER TABLE "${target}" ENABLE TRIGGER cyc_saved_versions`);
          const here = randomUUID();
          await db.query(`INSERT INTO "${target}" (id, version_id, key) VALUES ($1, $2, $3)`, [
            here,
            draft,
            randomUUID(),
          ]);

          const message = "A plan row can only link to rows in its own version.";
          expect(
            await w.refusedInsert(table, { version_id: draft, key: randomUUID(), [field]: elsewhere }),
            `${table}.${field}`,
          ).toEqual(refusal(message));
          const row = await w.insert(table, { version_id: draft, key: randomUUID(), [field]: here });
          expect(await w.update(table, row, { [field]: elsewhere }), `${table}.${field}`).toEqual(refusal(message));
        }
      }
    });
  });

  describe("on a plan copy", () => {
    it("refuse to change a saved one, turn it back into a draft, or delete it", async () => {
      const { saved } = await plans(db, 2106);
      expect(await w.update("plan_versions", saved, { message: "Changed" })).toEqual(refusal(REFUSED));
      expect(await w.update("plan_versions", saved, { status: "draft" })).toEqual(refusal(REFUSED));
      expect(await w.remove("plan_versions", saved)).toEqual(refusal(REFUSED));
    });

    it("refuse a new copy that isn't a draft", async () => {
      const { plan } = await plans(db, 2107);
      expect(
        await w.refusedInsert("plan_versions", { plan_id: plan, status: "saved", platform_version: "1.4.0" }),
      ).toEqual(refusal("A new plan copy starts as a draft."));
    });

    it("refuse to save one on its own", async () => {
      const { draft } = await plans(db, 2108);
      expect(await w.update("plan_versions", draft, { status: "saved", platform_version: "1.4.0" })).toEqual(
        refusal(SAVED_WITH_SET),
      );
    });

    it("refuse a save from a session that sets the Financial Plan's flag itself", async () => {
      const { draft } = await plans(db, 2132);
      const error = await db
        .transaction(async (tx) => {
          await tx.exec("SET LOCAL cyc.saving_set = 'on'");
          await tx.query(`UPDATE plan_versions SET status = 'saved', platform_version = '1.4.0' WHERE id = $1`, [
            draft,
          ]);
        })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(error).toEqual(refusal(SAVED_WITH_SET));
      expect(await w.read("plan_versions", draft)).toMatchObject({ status: "draft" });
    });

    it("refuse to move a copy to another plan", async () => {
      const { draft, operationsPlan } = await plans(db, 2112);
      expect(await w.update("plan_versions", draft, { plan_id: operationsPlan })).toEqual(
        refusal("A plan copy can't move to another plan."),
      );
    });
  });

  describe("on a plan", () => {
    it("refuse to change its kind, program area, organization, or year once it has a saved version", async () => {
      const { plan, operationsPlan } = await plans(db, 2113);
      const other = await plans(db, 2114);
      const message =
        "A plan's kind, program area, organization, and year can't change once it's in a Financial Plan or has a saved copy.";
      for (const change of [
        { kind: "operations", program_area_id: null },
        { program_area_id: other.area },
        { organization_id: other.organization },
        { fiscal_year: 2115 },
      ]) {
        expect(await w.update("plans", plan, change), JSON.stringify(change)).toEqual(refusal(message));
      }
      expect(await w.update("plans", plan, { name: "Renamed" })).toBeUndefined();
      expect(await w.update("plans", operationsPlan, { fiscal_year: 2115 })).toEqual(refusal(message));
    });

    it("refuse a program area's plan without its program area, or an Operations Plan with one", async () => {
      const { organization, area } = await plans(db, 2125);
      const message = "A program area's plan names its program area, and an Operations Plan names none.";
      const plan2 = { organization_id: organization, fiscal_year: 2126 };
      expect(await w.refusedInsert("plans", { ...plan2, kind: "program_area" })).toEqual(refusal(message));
      expect(await w.refusedInsert("plans", { ...plan2, kind: "operations", program_area_id: area })).toEqual(
        refusal(message),
      );
      const draftOnly = await w.insert("plans", { ...plan2, kind: "program_area", program_area_id: area });
      expect(await w.update("plans", draftOnly, { program_area_id: null })).toEqual(refusal(message));
      expect(await w.update("plans", draftOnly, { kind: "operations" })).toEqual(refusal(message));
      expect(await w.update("plans", draftOnly, { kind: "operations", program_area_id: null })).toBeUndefined();
    });

    it("refuse to change a plan whose draft copy is in a draft Financial Plan", async () => {
      const { organization, area, draftSet } = await plans(db, 2130);
      const plan = await w.insert("plans", {
        kind: "program_area",
        program_area_id: (await w.insert("program_areas", { name: "Another area" })) as string,
        organization_id: organization,
        fiscal_year: 2130,
      });
      const copy = await w.insert("plan_versions", { plan_id: plan, status: "draft" });
      await w.insert("version_set_members", { version_set_id: draftSet, version_id: copy });
      const message =
        "A plan's kind, program area, organization, and year can't change once it's in a Financial Plan or has a saved copy.";
      // Moving it into the area another plan in the Financial Plan already has, or out of its year.
      for (const change of [
        { program_area_id: area },
        { fiscal_year: 2131 },
        { kind: "operations", program_area_id: null },
      ]) {
        expect(await w.update("plans", plan, change), JSON.stringify(change)).toEqual(refusal(message));
      }
      expect(await w.update("plans", plan, { name: "Renamed" })).toBeUndefined();
    });

    it("let a plan with only drafts change", async () => {
      const { organization, area } = await plans(db, 2116);
      const plan = await w.insert("plans", {
        kind: "program_area",
        program_area_id: area,
        organization_id: organization,
        fiscal_year: 2117,
      });
      await w.insert("plan_versions", { plan_id: plan, status: "draft" });
      expect(await w.update("plans", plan, { fiscal_year: 2118 })).toBeUndefined();
    });
  });

  describe("on a Financial Plan", () => {
    it("save every plan in it when it's saved, together", async () => {
      const { set, operations, saved } = await plans(db, 2301);
      for (const version of [operations, saved]) {
        expect(await w.read("plan_versions", version)).toMatchObject({
          status: "saved",
          platform_version: "1.4.0",
          saved_at: expect.any(Date),
        });
      }
      expect(await w.read("version_sets", set)).toMatchObject({ status: "saved", saved_at: expect.any(Date) });
    });

    it("refuse to save one without an Operations Plan, and save none of its plans", async () => {
      const { draftSet, draft } = await plans(db, 2302);
      expect(await w.update("version_sets", draftSet, { status: "saved", platform_version: "1.4.0" })).toEqual(
        refusal(NEEDS_OPERATIONS),
      );
      expect(await w.read("version_sets", draftSet)).toMatchObject({ status: "draft" });
      expect(await w.read("plan_versions", draft)).toMatchObject({ status: "draft" });
    });

    it("refuse to save one without a platform version", async () => {
      const { draftSet } = await plans(db, 2303);
      for (const platform of [null, "", " "]) {
        expect(await w.update("version_sets", draftSet, { status: "saved", platform_version: platform })).toEqual(
          refusal(NEEDS_PLATFORM),
        );
      }
    });

    it("refuse a new one that isn't a draft", async () => {
      const { organization } = await plans(db, 2304);
      expect(
        await w.refusedInsert("version_sets", { organization_id: organization, fiscal_year: 2304, status: "saved" }),
      ).toEqual(refusal("A new Financial Plan starts as a draft."));
    });

    it("let a saved one's name and note change, and nothing else", async () => {
      const { set } = await plans(db, 2305);
      expect(await w.update("version_sets", set, { message: "Reviewed with the board" })).toBeUndefined();
      expect(await w.update("version_sets", set, { name: "Board budget" })).toBeUndefined();
      for (const change of [
        { platform_version: "9.9.9" },
        { status: "draft" },
        { message: "Adopted", platform_version: "9.9.9" },
      ]) {
        expect(await w.update("version_sets", set, change), JSON.stringify(change)).toEqual(refusal(SET_STAYS));
      }
      expect(await w.remove("version_sets", set)).toEqual(refusal(SET_STAYS));
      expect(await w.read("version_sets", set)).toMatchObject({
        message: "Reviewed with the board",
        name: "Board budget",
        platform_version: "1.4.0",
      });
    });

    it("refuse to change a draft's organization, year, or parent", async () => {
      const { draftSet, organization } = await plans(db, 2306);
      const other = await plans(db, 2307);
      for (const change of [{ organization_id: other.organization }, { fiscal_year: 2308 }, { parent_id: null }]) {
        expect(await w.update("version_sets", draftSet, change), JSON.stringify(change)).toEqual(
          refusal("A Financial Plan's organization, year, and parent can't change."),
        );
      }
      expect(await w.update("version_sets", draftSet, { name: "Three coaches" })).toBeUndefined();
      expect(organization).toBeDefined();
    });

    it("start only from one for the same organization and year", async () => {
      const { organization, set } = await plans(db, 2309);
      expect(
        await w.refusedInsert("version_sets", {
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
      expect(await w.insert("version_sets", { ...another, name: "Two coaches" })).toEqual(expect.any(String));
      expect(await w.insert("version_sets", { ...another, name: "Three coaches" })).toEqual(expect.any(String));
    });

    it("let a draft be deleted, with its plans taken out of it", async () => {
      const { draftSet, draft } = await plans(db, 2312);
      expect(await w.remove("version_sets", draftSet)).toBeUndefined();
      expect(await w.read("plan_versions", draft)).toMatchObject({ status: "draft" });
    });
  });

  describe("on a Financial Plan's plans", () => {
    it("fill in each one's plan from its copy", async () => {
      const { draft, plan } = await plans(db, 2401);
      expect(await w.read("version_set_members", await memberOf(db, draft))).toMatchObject({ plan_id: plan });
    });

    it("hold one Operations Plan, and at most one Program Plan for each program area", async () => {
      const { draftSet, plan, operationsPlan } = await plans(db, 2402);
      const second = await w.insert("plan_versions", { plan_id: plan, status: "draft" });
      const error = await w.refusedInsert("version_set_members", { version_set_id: draftSet, version_id: second });
      expect(error).toEqual(refusal(ONE_PER_AREA));
      expect(error).toMatchObject({ detail: "It already has Test area." });
      const operations = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      const another = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      expect(await w.insert("version_set_members", { version_set_id: draftSet, version_id: operations })).toEqual(
        expect.any(String),
      );
      expect(await w.refusedInsert("version_set_members", { version_set_id: draftSet, version_id: another })).toEqual(
        refusal(ONE_PER_AREA),
      );
    });

    it("take only a draft copy, for the same organization and year, in no other Financial Plan", async () => {
      const { organization, draftSet, saved, draft, plan } = await plans(db, 2403);
      expect(await w.refusedInsert("version_set_members", { version_set_id: draftSet, version_id: saved })).toEqual(
        refusal("Only a draft plan can be added to a Financial Plan."),
      );
      const other = await plans(db, 2404);
      const elsewhere = await w.insert("plan_versions", { plan_id: other.operationsPlan, status: "draft" });
      expect(await w.refusedInsert("version_set_members", { version_set_id: draftSet, version_id: elsewhere })).toEqual(
        refusal("A plan in a Financial Plan must be for the same organization and year."),
      );
      const option = await w.insert("version_sets", {
        organization_id: organization,
        fiscal_year: 2403,
        status: "draft",
      });
      expect(await w.refusedInsert("version_set_members", { version_set_id: option, version_id: draft })).toEqual(
        refusal("A plan copy is in only one Financial Plan."),
      );
      expect(plan).toBeDefined();
    });

    it("let a draft's plans be taken out, and refuse any change to a saved one's", async () => {
      const { draft, saved, operations, set } = await plans(db, 2405);
      const member = await memberOf(db, saved);
      expect(await w.update("version_set_members", member, { version_id: operations })).toEqual(refusal(MEMBERS_FIXED));
      expect(await w.remove("version_set_members", member)).toEqual(refusal(MEMBERS_FIXED));
      const extra = await w.insert("plan_versions", {
        plan_id: (await w.read("plan_versions", draft))!["plan_id"],
        status: "draft",
      });
      expect(await w.refusedInsert("version_set_members", { version_set_id: set, version_id: extra })).toEqual(
        refusal(MEMBERS_FIXED),
      );
      expect(await w.remove("version_set_members", await memberOf(db, draft))).toBeUndefined();
    });
  });

  describe("on the date a Financial Plan is active from", () => {
    /** The day `days` from the database's today, as `YYYY-MM-DD`. */
    const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it("take a date on a draft or a saved one, and a change to it", async () => {
      const { set, draftSet } = await plans(db, 2501);
      expect(await w.update("version_sets", set, { effective_from: "2500-07-01", message: "Adopted" })).toBeUndefined();
      expect(await w.update("version_sets", draftSet, { effective_from: "2500-09-01" })).toBeUndefined();
      expect(await w.update("version_sets", set, { effective_from: "2500-08-01" })).toBeUndefined();
      expect(await w.update("version_sets", draftSet, { effective_from: null })).toBeUndefined();
      expect(await w.read("version_sets", set)).toMatchObject({ status: "saved", message: "Adopted" });
    });

    it("refuse two Financial Plans for a year active from the same date, but not in another year", async () => {
      const { set, draftSet } = await plans(db, 2502);
      const otherYear = await plans(db, 2503);
      expect(await w.update("version_sets", set, { effective_from: "2501-10-01" })).toBeUndefined();
      expect(await w.update("version_sets", draftSet, { effective_from: "2501-10-01" })).toEqual(refusal(ONE_PER_DATE));
      expect(await w.update("version_sets", otherYear.set, { effective_from: "2501-10-01" })).toBeUndefined();
    });

    it("keep one Financial Plan for a year active from each date, even past the trigger", async () => {
      const { set, draftSet } = await plans(db, 2504);
      expect(await w.update("version_sets", set, { effective_from: "2503-10-01" })).toBeUndefined();
      await db.exec("ALTER TABLE version_sets DISABLE TRIGGER USER");
      const error = await w.update("version_sets", draftSet, { effective_from: "2503-10-01" });
      await db.exec("ALTER TABLE version_sets ENABLE TRIGGER USER");
      expect(error).toMatchObject({ code: "23505" });
    });

    it("refuse archiving the plan in force, or one active from a later date, but not one another took over from", async () => {
      const { set, draftSet } = await plans(db, 2505);
      const archived = { archived_at: new Date().toISOString() };
      expect(await w.update("version_sets", set, { effective_from: day(-30) })).toBeUndefined();
      expect(await w.update("version_sets", set, archived)).toEqual(refusal(IN_FORCE_NOT_ARCHIVED));
      expect(await w.update("version_sets", draftSet, { effective_from: day(30) })).toBeUndefined();
      expect(await w.update("version_sets", draftSet, archived)).toEqual(refusal(IN_FORCE_NOT_ARCHIVED));
      expect(await w.update("version_sets", draftSet, { effective_from: day(-1) })).toBeUndefined();
      expect(await w.update("version_sets", set, archived)).toBeUndefined();
      expect(await w.update("version_sets", draftSet, archived)).toEqual(refusal(IN_FORCE_NOT_ARCHIVED));
    });

    it("refuse a date on an archived Financial Plan", async () => {
      const { draftSet } = await plans(db, 2506);
      expect(await w.update("version_sets", draftSet, { archived_at: new Date().toISOString() })).toBeUndefined();
      expect(await w.update("version_sets", draftSet, { effective_from: "2505-07-01" })).toEqual(
        refusal(ARCHIVED_NOT_ACTIVE),
      );
      expect(
        await w.update("version_sets", draftSet, { effective_from: "2505-07-01", archived_at: null }),
      ).toBeUndefined();
    });

    it("refuse deleting an active draft until its date is cleared", async () => {
      const { draftSet, draft } = await plans(db, 2507);
      expect(await w.update("version_sets", draftSet, { effective_from: "2506-07-01" })).toBeUndefined();
      expect(await w.remove("version_sets", draftSet)).toEqual(refusal(ACTIVE_STAYS));
      expect(await w.update("version_sets", draftSet, { effective_from: null })).toBeUndefined();
      await db.query("DELETE FROM version_set_members WHERE version_id = $1", [draft]);
      expect(await w.remove("version_sets", draftSet)).toBeUndefined();
    });

    it("keep a saved one saved, whatever its date", async () => {
      const { set } = await plans(db, 2508);
      expect(await w.update("version_sets", set, { effective_from: "2507-07-01" })).toBeUndefined();
      expect(await w.update("version_sets", set, { status: "draft" })).toEqual(refusal(SET_STAYS));
      expect(await w.update("version_sets", set, { platform_version: "9.9.9" })).toEqual(refusal(SET_STAYS));
      expect(await w.update("version_sets", set, { name: "Adopted" })).toBeUndefined();
      expect(await w.remove("version_sets", set)).toEqual(refusal(SET_STAYS));
    });
  });

  describe("on a bonus", () => {
    it("refuse one in a Program Plan, and take one in an Operations Plan", async () => {
      const { draft, operationsPlan } = await plans(db, 2509);
      const operations = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      expect(await w.refusedInsert("plan_bonus_owners", { version_id: draft, key: randomUUID() })).toEqual(
        refusal(BONUS_IN_OPERATIONS),
      );
      const owner = await w.insert("plan_bonus_owners", { version_id: operations, key: randomUUID() });
      expect(await w.refusedInsert("plan_bonus_owner_products", { version_id: draft, key: randomUUID() })).toEqual(
        refusal(BONUS_IN_OPERATIONS),
      );
      await w.insert("plan_bonus_owner_products", { version_id: operations, key: randomUUID(), bonus_owner_id: owner });
    });
  });

  it("stay in place when a schema apply changes a table", async () => {
    const { savedOffering } = await plans(db, 2124);
    await db.exec(`ALTER TABLE plan_offerings ADD COLUMN extra integer`);
    await db.exec(`ALTER TABLE plan_offerings ALTER COLUMN name TYPE text`);
    await db.exec(`ALTER TABLE plan_offerings ALTER COLUMN capacity SET NOT NULL`).catch(() => undefined);
    expect(await w.update("plan_offerings", savedOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
  });

  it("install again in place, without a second trigger", async () => {
    await db.exec(`DROP TRIGGER cyc_saved_versions ON plan_trips`);
    await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_trigger WHERE tgname = 'cyc_saved_versions' AND tgrelid = 'plan_offerings'::regclass`,
    );
    expect(rows[0]!.count).toBe(1);
  });
});

describe("installing the saved-versions triggers", { timeout: 30_000 }, () => {
  it("waits until every planning table has the columns they read", async () => {
    const db = await PGlite.create();
    for (const statement of tables()) await db.exec(statement);
    await db.exec(`ALTER TABLE plans DROP COLUMN fiscal_year`);
    const { missing } = await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect(missing).toEqual(["plans"]);
    const { rows } = await db.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'cyc_saved_versions'`);
    expect(rows).toEqual([]);
  });

  it("skips the install when the triggers it would install are already there", async () => {
    const db = await database(config(false));
    const again = () => db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect(await again()).toEqual({ missing: [], installed: false });
    // A table a schema apply made again has lost its trigger.
    await db.exec(`DROP TRIGGER cyc_saved_versions ON plan_trips`);
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

  it("marks saved each club plan the migration listed, without saving its plans again, and drops the list", async () => {
    const db = await database(config(false));
    const { organization, set } = await plans(db, 2702);
    // A club plan the schema apply has just given a status column, as a draft.
    await db.exec("ALTER TABLE version_sets DISABLE TRIGGER USER");
    await db.query("UPDATE version_sets SET status = 'draft' WHERE id = $1", [set]);
    await db.exec("ALTER TABLE version_sets ENABLE TRIGGER USER");
    await db.exec("CREATE TABLE cyc_seed_saved_sets (version_set_id uuid PRIMARY KEY)");
    await db.query("INSERT INTO cyc_seed_saved_sets VALUES ($1)", [set]);
    await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect((await db.query("SELECT status FROM version_sets WHERE id = $1", [set])).rows).toEqual([
      { status: "saved" },
    ]);
    expect((await db.query("SELECT to_regclass('cyc_seed_saved_sets') AS seed")).rows).toEqual([{ seed: null }]);
    // Its triggers are back on.
    expect(await writer(db).update("version_sets", set, { platform_version: "9.9.9" })).toEqual(refusal(SET_STAYS));
    expect(organization).toBeDefined();
  });

  it("sets the date each Financial Plan the migration listed is active from, and drops the list", async () => {
    const db = await database(config(false));
    const { set, draftSet } = await plans(db, 2701);
    await db.exec(
      "CREATE TABLE cyc_seed_effective_sets (version_set_id uuid PRIMARY KEY, effective_from date NOT NULL)",
    );
    await db.query("INSERT INTO cyc_seed_effective_sets VALUES ($1, '2700-10-01')", [set]);
    await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    const dated = async (id: string) =>
      (await db.query("SELECT effective_from::text AS effective_from FROM version_sets WHERE id = $1", [id])).rows;
    expect(await dated(set)).toEqual([{ effective_from: "2700-10-01" }]);
    expect(await dated(draftSet)).toEqual([{ effective_from: null }]);
    expect((await db.query("SELECT to_regclass('cyc_seed_effective_sets') AS seed")).rows).toEqual([{ seed: null }]);
    // Its triggers are back on.
    expect(await writer(db).update("version_sets", set, { platform_version: "9.9.9" })).toEqual(refusal(SET_STAYS));
  });

  it("drops the index that kept one Financial Plan active for a year", async () => {
    const db = await PGlite.create();
    for (const statement of tables()) await db.exec(statement);
    await db.exec(
      "CREATE UNIQUE INDEX cyc_one_active_set ON version_sets (organization_id, fiscal_year) WHERE status = 'active'",
    );
    await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    const { rows } = await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'cyc_one_active_set'");
    expect(rows).toEqual([]);
  });

  it("drops the unique indexes plans once had", async () => {
    const db = await PGlite.create();
    for (const statement of tables()) await db.exec(statement);
    await db.exec("CREATE UNIQUE INDEX cyc_one_operations_plan ON plans (organization_id, fiscal_year)");
    const { missing } = await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect(missing).toEqual([]);
    const { rows } = await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'cyc_one_operations_plan'");
    expect(rows).toEqual([]);
  });

  it("reports a table that lacks its trigger", async () => {
    const db = await database(config(false));
    await db.exec(`DROP TRIGGER cyc_saved_versions ON plan_trips`);
    const status = await db.transaction((tx) => triggerStatus(config(false), connect(tx)));
    expect(status.tables).toMatchObject({ plan_trips: false, plan_offerings: true, plans: true });
    expect(status.fingerprint).toBe(fingerprint(config(false)));
    expect(fingerprint(config(true))).not.toBe(fingerprint(config(false)));
  });

  // knex reads a ? as a binding, even in a statement with none.
  it("writes no ? into its SQL", () => {
    expect(triggerStatements(config(true)).join("\n")).not.toContain("?");
  });
});

describe("the saved-versions triggers with dev's flag", { timeout: 30_000 }, () => {
  it("let an active saved Financial Plan, its plans, and their rows be deleted, but not changed", async () => {
    const db = await database(config(true));
    const w = writer(db);
    const { set, operations, saved, draftSet, draft, savedOffering, draftOffering } = await plans(db);
    expect(await w.update("version_sets", set, { effective_from: "2026-07-01" })).toBeUndefined();
    expect(await w.update("version_sets", set, { platform_version: "9.9.9" })).toEqual(refusal(SET_STAYS));
    expect(await w.update("plan_offerings", savedOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
    expect(await w.update("plan_versions", saved, { message: "Changed" })).toEqual(refusal(REFUSED));
    // The draft started from it goes first, since it points at it.
    expect(await w.remove("version_sets", draftSet)).toBeUndefined();
    expect(await w.remove("plan_offerings", draftOffering)).toBeUndefined();
    expect(await w.remove("plan_versions", draft)).toBeUndefined();
    expect(await w.remove("version_sets", set)).toBeUndefined();
    await db.query(`DELETE FROM plan_activities WHERE version_id = $1`, [saved]);
    await db.query(`DELETE FROM plan_activity_blocks WHERE version_id = $1`, [saved]);
    await db.query(`DELETE FROM plan_revenue_charges WHERE version_id = $1`, [operations]);
    expect(await w.remove("plan_offerings", savedOffering)).toBeUndefined();
    expect(await w.remove("plan_versions", saved)).toBeUndefined();
    expect(
      await w.remove(
        "plan_rates",
        (await db.query<{ id: string }>(`SELECT id FROM plan_rates WHERE version_id = $1`, [operations])).rows[0]!.id,
      ),
    ).toBeUndefined();
    expect(await w.remove("plan_versions", operations)).toBeUndefined();
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
    const { organization, set, saved, operations, savedOffering } = await plans(db, 2601);
    const original = (await w.read("plan_offerings", savedOffering))!;
    const child = await w.insert("version_sets", {
      organization_id: organization,
      fiscal_year: 2601,
      name: "Three coaches",
      status: "draft",
      parent_id: set,
    });
    expect(await copyParent(config(false), knexOver(db), child)).toBe(true);
    const members = (
      await db.query<{ version_id: string }>(`SELECT version_id FROM version_set_members WHERE version_set_id = $1`, [
        child,
      ])
    ).rows;
    expect(members).toHaveLength(2);
    const copies = (
      await db.query<Values>(`SELECT * FROM plan_versions WHERE id = ANY($1::uuid[])`, [
        members.map((m) => m.version_id),
      ])
    ).rows;
    expect(copies.map((v) => v["parent_version_id"]).sort()).toEqual([operations, saved].sort());
    expect(copies.every((v) => v["status"] === "draft")).toBe(true);
    const copy = copies.find((v) => v["parent_version_id"] === saved)!;
    const [offering] = (await db.query<Values>(`SELECT * FROM plan_offerings WHERE version_id = $1`, [copy["id"]]))
      .rows;
    expect(offering).toMatchObject({ key: original["key"], name: "Offering" });
    expect(offering!["id"]).not.toBe(savedOffering);
    const [activity] = (await db.query<Values>(`SELECT * FROM plan_activities WHERE version_id = $1`, [copy["id"]]))
      .rows;
    const [block] = (await db.query<Values>(`SELECT * FROM plan_activity_blocks WHERE version_id = $1`, [copy["id"]]))
      .rows;
    expect(activity).toMatchObject({ offering_id: offering!["id"], block_id: block!["id"] });
    const operationsCopy = copies.find((v) => v["parent_version_id"] === operations)!;
    const [charge] = (
      await db.query<Values>(`SELECT * FROM plan_revenue_charges WHERE version_id = $1`, [operationsCopy["id"]])
    ).rows;
    expect(charge).toMatchObject({ product_kinds: ["program", "charter"] });
    // The copy is a draft, so it can change, and the parent stays as it was.
    expect(await w.update("plan_offerings", offering!["id"] as string, { name: "Changed" })).toBeUndefined();
    expect((await w.read("plan_offerings", savedOffering))!["name"]).toBe("Offering");
    // A second try copies nothing more.
    expect(await copyParent(config(false), knexOver(db), child)).toBe(false);
  });

  it("moves a bonus a Program Plan held into the copy of the Operations Plan", async () => {
    const db = await database(config(false));
    const w = writer(db);
    const { organization, set, saved } = await plans(db, 2603);
    // A plan saved before bonuses moved to the Operations Plan.
    await db.exec("ALTER TABLE plan_bonus_owners DISABLE TRIGGER USER");
    await db.exec("ALTER TABLE plan_bonus_owner_products DISABLE TRIGGER USER");
    const owner = await w.insert("plan_bonus_owners", { version_id: saved, key: randomUUID(), role_name: "Director" });
    await w.insert("plan_bonus_owner_products", { version_id: saved, key: randomUUID(), bonus_owner_id: owner });
    await db.exec("ALTER TABLE plan_bonus_owners ENABLE TRIGGER USER");
    await db.exec("ALTER TABLE plan_bonus_owner_products ENABLE TRIGGER USER");
    const child = await w.insert("version_sets", {
      organization_id: organization,
      fiscal_year: 2603,
      status: "draft",
      parent_id: set,
    });
    expect(await copyParent(config(false), knexOver(db), child)).toBe(true);
    const { rows } = await db.query<Values>(
      `SELECT p.kind, o.role_name, (SELECT count(*)::int FROM plan_bonus_owner_products b WHERE b.bonus_owner_id = o.id AND b.version_id = o.version_id) AS products
        FROM plan_bonus_owners o JOIN plan_versions v ON v.id = o.version_id JOIN plans p ON p.id = v.plan_id
        JOIN version_set_members m ON m.version_id = v.id WHERE m.version_set_id = $1`,
      [child],
    );
    expect(rows).toEqual([{ kind: "operations", role_name: "Director", products: 1 }]);
  });

  it("does nothing for a Financial Plan with no parent", async () => {
    const db = await database(config(false));
    const { organization } = await plans(db, 2602);
    const w = writer(db);
    const fresh = await w.insert("version_sets", { organization_id: organization, fiscal_year: 2602, status: "draft" });
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
    (await db.query(`SELECT 1 FROM "${table}" WHERE version_set_id = $1`, [set])).rows.length;
  const totals = async (db: PGlite, set: string) =>
    (await db.query<Values>(`SELECT * FROM plan_results WHERE version_set_id = $1`, [set])).rows;

  /** A draft holding an Operations Plan copy and the program area's draft copy. */
  async function draft(db: PGlite, year: number) {
    const w = writer(db);
    const made = await plans(db, year);
    const operations = await w.insert("plan_versions", { plan_id: made.operationsPlan, status: "draft" });
    await w.insert("version_set_members", { version_set_id: made.draftSet, version_id: operations });
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
    const { draftSet, draft: copy, draftOffering, w } = await draft(db, 2807);
    expect(
      await w.update("plan_offerings", draftOffering, { starts_on: "2807-06-01", ends_on: "2807-06-30" }),
    ).toBeUndefined();
    await w.insert("plan_activities", {
      version_id: copy,
      key: randomUUID(),
      offering_id: draftOffering,
      date: "2807-06-06",
      kind: "practice",
    });
    expect(await writeDraftResults(config(false), knexOver(db), draftSet, engine)).toBe(true);
    const { rows } = await db.query<Values>(
      `SELECT version_set_member_id, to_char(date, 'YYYY-MM-DD') AS date, category FROM plan_result_warnings
        WHERE version_set_id = $1 AND code = 'unallocated_activity'`,
      [draftSet],
    );
    expect(rows).toEqual([
      { version_set_member_id: await memberOf(db, copy), date: "2807-06-06", category: "allocation" },
    ]);
  });

  it("leaves a saved Financial Plan's results to its save", async () => {
    const db = await database(config(false));
    const { set } = await plans(db, 2803);
    expect(await writeDraftResults(config(false), knexOver(db), set, engine)).toBe(false);
    expect(await writeSetResults(config(false), knexOver(db), set, engine)).toBe(true);
    expect(await writeDraftResults(config(false), knexOver(db), set, engine)).toBe(false);
    expect(await writeSetResults(config(false), knexOver(db), set, engine)).toBe(false);
    expect(await count(db, "plan_results", set)).toBe(1);
  });

  it("finds the drafts a change to a plan's rows, its plan, its members, or the catalog changes", async () => {
    const db = await database(config(false));
    const { draftSet, draftOffering, savedOffering, plan, product } = await draft(db, 2804);
    const other = await draft(db, 2805);
    const knex = knexOver(db);
    const changes = (collection: string, keys: string[]) => draftsChangedBy(config(false), knex, collection, keys);
    expect(await changes("plan_offerings", [draftOffering])).toEqual([draftSet]);
    // A saved Financial Plan's results never change.
    expect(await changes("plan_offerings", [savedOffering])).toEqual([]);
    expect(await changes("plans", [plan])).toEqual([draftSet]);
    const [member] = (
      await db.query<{ id: string }>(`SELECT id FROM version_set_members WHERE version_set_id = $1`, [draftSet])
    ).rows;
    expect(await changes("version_set_members", [member!.id])).toEqual([draftSet]);
    expect((await changes("products", [product])).sort()).toEqual(
      expect.arrayContaining([draftSet, other.draftSet].sort()),
    );
    expect(await changes("directus_users", [randomUUID()])).toEqual([]);
  });
});
