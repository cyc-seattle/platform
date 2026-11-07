import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import * as yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { savedVersionsConfig, type SavedVersionsConfig } from "../stacks/backend/policies.ts";
import {
  ACTIVATION_STAYS,
  copyOrder,
  copyParent,
  fingerprint,
  installTriggers,
  MEMBERS_FIXED,
  NEEDS_OPERATIONS,
  ONE_PER_AREA,
  ONLY_SAVED_ACTIVE,
  REFUSED,
  RESULTS_BY_SAVE,
  SAVED_WITH_SET,
  SET_STAYS,
  triggerStatements,
  triggerStatus,
} from "../stacks/backend/saved-versions.cjs";

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

const schemas = ["core", "planning"].map((name) => ({
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
  const organization = await w.insert("organizations", { name: "Test club", fiscal_year_start_month: 10 });
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
  const offeringKey = (await w.read("plan_offerings", savedOffering))!["key"];
  await w.insert("plan_activities", {
    version_id: saved,
    key: randomUUID(),
    offering_id: savedOffering,
    date: `${year}-06-06`,
  });
  await w.insert("plan_activity_block_rules", {
    version_id: operations,
    key: randomUUID(),
    name: "Shared Saturdays",
    offering_keys: JSON.stringify([offeringKey]),
    weekdays: JSON.stringify([1, 3]),
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

    it("refuse results on a draft, even from the hook", async () => {
      const { draftSet } = await plans(db, 2202);
      expect(await hookWrites(draftSet)).toEqual(refusal(RESULTS_BY_SAVE));
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
      const { draft, saved } = await plans(db, 2105);
      const { links } = config(false);
      // A row in the saved version for each table a link points at. Made after the save would
      // need them in a draft, so they go straight into the table with the triggers off.
      for (const [table, fields] of Object.entries(links)) {
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
      const message = "A plan's kind, program area, organization, and year can't change once it has a saved version.";
      for (const change of [
        { kind: "operations", program_area_id: null },
        { program_area_id: other.area },
        { organization_id: other.organization },
        { fiscal_year: 2115 },
      ]) {
        expect(await w.update("plans", plan, change), JSON.stringify(change)).toEqual(refusal(message));
      }
      expect(await w.update("plans", plan, { name: "Renamed", archived: true })).toBeUndefined();
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

    it("let a saved one's note change, and nothing else", async () => {
      const { set } = await plans(db, 2305);
      expect(await w.update("version_sets", set, { message: "Reviewed with the board" })).toBeUndefined();
      for (const change of [{ name: "Changed" }, { status: "draft" }, { message: "Adopted", name: "Changed" }]) {
        expect(await w.update("version_sets", set, change), JSON.stringify(change)).toEqual(refusal(SET_STAYS));
      }
      expect(await w.remove("version_sets", set)).toEqual(refusal(SET_STAYS));
      expect(await w.read("version_sets", set)).toMatchObject({ message: "Reviewed with the board", name: "Budget" });
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

  describe("on marking a Financial Plan active", () => {
    it("stamp when, and order the year's marks so none tie", async () => {
      const { set, organization } = await plans(db, 2501);
      const another = await w.insert("version_sets", {
        organization_id: organization,
        fiscal_year: 2501,
        status: "draft",
      });
      const operationsPlan = await w.insert("plans", {
        kind: "operations",
        organization_id: organization,
        fiscal_year: 2501,
      });
      const operations = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      await w.insert("version_set_members", { version_set_id: another, version_id: operations });
      expect(await w.update("version_sets", another, { status: "saved", platform_version: "1.4.0" })).toBeUndefined();
      const first = await w.insert("version_set_activations", { version_set_id: set, activated_at: "1999-01-01" });
      const second = await w.insert("version_set_activations", { version_set_id: another });
      expect(await w.read("version_set_activations", first)).toMatchObject({ sequence: 1 });
      expect(await w.read("version_set_activations", second)).toMatchObject({ sequence: 2 });
      expect(((await w.read("version_set_activations", first))!["activated_at"] as Date).getFullYear()).toBeGreaterThan(
        1999,
      );
      const otherYear = await plans(db, 2502);
      const elsewhere = await w.insert("version_set_activations", { version_set_id: otherYear.set });
      expect(await w.read("version_set_activations", elsewhere)).toMatchObject({ sequence: 1 });
    });

    it("refuse a draft", async () => {
      const { draftSet } = await plans(db, 2503);
      expect(await w.refusedInsert("version_set_activations", { version_set_id: draftSet })).toEqual(
        refusal(ONLY_SAVED_ACTIVE),
      );
    });

    it("refuse to change or delete a mark", async () => {
      const { set } = await plans(db, 2504);
      const mark = await w.insert("version_set_activations", { version_set_id: set });
      expect(await w.update("version_set_activations", mark, { activated_at: "1999-01-01" })).toEqual(
        refusal(ACTIVATION_STAYS),
      );
      expect(await w.remove("version_set_activations", mark)).toEqual(refusal(ACTIVATION_STAYS));
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
  it("let a saved Financial Plan, its plans, their rows, and its marks be deleted, but not changed", async () => {
    const db = await database(config(true));
    const w = writer(db);
    const { set, operations, saved, draftSet, draft, savedOffering, draftOffering } = await plans(db);
    const mark = await w.insert("version_set_activations", { version_set_id: set });
    expect(await w.update("version_sets", set, { name: "Changed" })).toEqual(refusal(SET_STAYS));
    expect(await w.update("plan_offerings", savedOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
    expect(await w.update("plan_versions", saved, { message: "Changed" })).toEqual(refusal(REFUSED));
    expect(await w.remove("version_set_activations", mark)).toBeUndefined();
    // The draft started from it goes first, since it points at it.
    expect(await w.remove("version_sets", draftSet)).toBeUndefined();
    expect(await w.remove("plan_offerings", draftOffering)).toBeUndefined();
    expect(await w.remove("plan_versions", draft)).toBeUndefined();
    expect(await w.remove("version_sets", set)).toBeUndefined();
    await db.query(`DELETE FROM plan_activities WHERE version_id = $1`, [saved]);
    await db.query(`DELETE FROM plan_activity_block_rules WHERE version_id = $1`, [operations]);
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
 * Just enough of knex, over PGlite, for `copyParent`: `where`, `whereIn`, `first`, `select`,
 * `insert`, `update`, and `transaction`.
 */
function knexOver(db: PGlite | Transaction): unknown {
  const builder = (table: string) => {
    const where: [string, unknown[]][] = [];
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
    const select = async (...columns: string[]) => {
      const { sql, params } = clause();
      const list = columns.length === 0 || columns.includes("*") ? "*" : columns.map((c) => `"${c}"`).join(", ");
      return (await db.query<Values>(`SELECT ${list} FROM "${table}"${sql}`, params)).rows;
    };
    const self = {
      where: (column: string, value: unknown) => (where.push([column, [value]]), self),
      whereIn: (column: string, values: unknown[]) => (where.push([column, values]), self),
      select,
      first: async () => (await select())[0],
      insert: async (rows: Values | Values[]) => {
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const columns = Object.keys(row);
          await db.query(
            `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
            Object.values(row),
          );
        }
      },
      update: async (values: Values) => {
        const columns = Object.keys(values);
        const { sql, params } = clause(columns.length);
        await db.query(`UPDATE "${table}" SET ${columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ")}${sql}`, [
          ...Object.values(values),
          ...params,
        ]);
      },
    };
    return self;
  };
  return Object.assign(builder, {
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
    expect(activity).toMatchObject({ offering_id: offering!["id"] });
    const operationsCopy = copies.find((v) => v["parent_version_id"] === operations)!;
    const [rule] = (
      await db.query<Values>(`SELECT * FROM plan_activity_block_rules WHERE version_id = $1`, [operationsCopy["id"]])
    ).rows;
    expect(rule).toMatchObject({ offering_keys: [original["key"]], weekdays: [1, 3] });
    // The copy is a draft, so it can change, and the parent stays as it was.
    expect(await w.update("plan_offerings", offering!["id"] as string, { name: "Changed" })).toBeUndefined();
    expect((await w.read("plan_offerings", savedOffering))!["name"]).toBe("Offering");
    // A second try copies nothing more.
    expect(await copyParent(config(false), knexOver(db), child)).toBe(false);
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
