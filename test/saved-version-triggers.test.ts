import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import * as yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { savedVersionsConfig, type SavedVersionsConfig } from "../stacks/backend/policies.ts";
import { installTriggers, REFUSED, triggerStatements } from "../stacks/backend/saved-versions.cjs";

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
      ({ collection, field, related_collection: related }) =>
        `ALTER TABLE "${collection}" ADD FOREIGN KEY ("${field}") REFERENCES "${related}" (id) ON DELETE RESTRICT`,
    );
  return [...create, ...keys];
}

async function database(config: SavedVersionsConfig): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pageinspect } });
  await db.exec("CREATE EXTENSION pageinspect");
  for (const statement of tables()) await db.exec(statement);
  const missing = await db.transaction((tx) => installTriggers(config, connect(tx)));
  expect(missing).toEqual([]);
  return db;
}

const connect = (tx: Transaction) => ({
  query: async (sql: string) => (await tx.query<Record<string, unknown>>(sql)).rows,
  exec: (sql: string) => tx.exec(sql),
});

const config = (deletable: boolean) => savedVersionsConfig(schemas, deletable);

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

const refusal = (message: string) => expect.objectContaining({ code: "CY001", message });

/** An organization's Operations Plan with a saved version, and a product's plan with a saved version and a draft. */
async function plans(db: PGlite, year = 2027) {
  const w = writer(db);
  const organization = await w.insert("organizations", { name: "Test club", fiscal_year_start_month: 10 });
  const product = await w.insert("products", { name: "Test product", kind: "program" });
  const kind = await w.insert("resource_kinds", { name: "Safety boat" });
  const operationsPlan = await w.insert("plans", {
    kind: "operations",
    organization_id: organization,
    fiscal_year: year,
    name: "Operations",
  });
  const operations = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
  await w.insert("plan_rates", { version_id: operations, key: randomUUID(), rib_resource_kind_id: kind });
  expect(await w.update("plan_versions", operations, { status: "saved", platform_version: "1.4.0" })).toBeUndefined();

  const plan = await w.insert("plans", {
    kind: "product",
    product_id: product,
    organization_id: organization,
    fiscal_year: year,
    name: "Product",
  });
  const saved = await w.insert("plan_versions", { plan_id: plan, status: "draft" });
  const draft = await w.insert("plan_versions", { plan_id: plan, status: "draft", parent_version_id: saved });
  const offering = async (version: string) =>
    w.insert("plan_offerings", { version_id: version, key: randomUUID(), product_id: product, name: "Offering" });
  const savedOffering = await offering(saved);
  const draftOffering = await offering(draft);
  expect(
    await w.update("plan_versions", saved, {
      status: "saved",
      platform_version: "1.4.0",
      operations_version_id: operations,
    }),
  ).toBeUndefined();
  return { organization, product, operationsPlan, operations, plan, saved, draft, savedOffering, draftOffering };
}

describe("the saved-versions triggers", () => {
  let db: PGlite;
  let w: ReturnType<typeof writer>;
  beforeAll(async () => {
    db = await database(config(false));
    w = writer(db);
  });

  describe("on a saved version's rows", () => {
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
      const { draftOffering, saved, draft, product } = await plans(db, 2103);
      const otherDraft = await w.insert("plan_versions", {
        plan_id: (await w.read("plan_versions", draft))!["plan_id"],
        status: "draft",
      });
      const message = "A plan row can't move to another version. Copy it into that version instead.";
      expect(await w.update("plan_offerings", draftOffering, { version_id: saved })).toEqual(refusal(message));
      expect(await w.update("plan_offerings", draftOffering, { version_id: otherDraft })).toEqual(refusal(message));
      expect(product).toBeDefined();
    });
  });

  describe("on a draft's rows", () => {
    it("let them be added, changed, and deleted", async () => {
      const { draft, draftOffering, product } = await plans(db, 2104);
      const added = await w.insert("plan_offerings", { version_id: draft, key: randomUUID(), product_id: product });
      expect(await w.update("plan_offerings", draftOffering, { name: "Changed" })).toBeUndefined();
      expect(await w.remove("plan_offerings", added)).toBeUndefined();
    });

    it("refuse a link to a row in another version, for every link", async () => {
      const { draft, saved } = await plans(db, 2105);
      const { links } = config(false);
      // A row in the saved version for each table a link points at. Made before the save would
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

  describe("on a version", () => {
    it("refuse to change a saved one, turn it back into a draft, or delete it", async () => {
      const { saved } = await plans(db, 2106);
      expect(await w.update("plan_versions", saved, { message: "Changed" })).toEqual(refusal(REFUSED));
      expect(await w.update("plan_versions", saved, { status: "draft" })).toEqual(refusal(REFUSED));
      expect(await w.remove("plan_versions", saved)).toEqual(refusal(REFUSED));
    });

    it("refuse a new version that isn't a draft", async () => {
      const { plan } = await plans(db, 2107);
      expect(
        await w.refusedInsert("plan_versions", { plan_id: plan, status: "saved", platform_version: "1.4.0" }),
      ).toEqual(refusal("A new plan version starts as a draft."));
    });

    it("refuse to save one without a platform version, or with it cleared", async () => {
      const { draft, operations } = await plans(db, 2108);
      for (const platform of [null, "", " "]) {
        expect(
          await w.update("plan_versions", draft, {
            status: "saved",
            platform_version: platform,
            operations_version_id: operations,
          }),
        ).toEqual(refusal("Saving a version needs the @cyc-seattle/platform version that calculated it."));
      }
    });

    it("save a product's plan only with a saved Operations Plan version of the same organization and year", async () => {
      const { draft, operations, organization, plan } = await plans(db, 2109);
      const message =
        "Saving a product's plan needs the saved Operations Plan version it was calculated with, for the same organization and year.";
      const save = (operations_version_id: string | null) =>
        w.update("plan_versions", draft, { status: "saved", platform_version: "1.4.0", operations_version_id });
      expect(await save(null)).toEqual(refusal(message));
      // A draft of the Operations Plan, a saved version of another product's plan, and another year's.
      const operationsPlan = (await w.read("plan_versions", operations))!["plan_id"] as string;
      const operationsDraft = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      expect(await save(operationsDraft)).toEqual(refusal(message));
      const other = await plans(db, 2110);
      expect(await save(other.saved)).toEqual(refusal(message));
      expect(await save(other.operations)).toEqual(refusal(message));
      expect(organization).not.toBe(other.organization);

      expect(await save(operations)).toBeUndefined();
      expect(await w.read("plan_versions", draft)).toMatchObject({ status: "saved", saved_at: expect.any(Date) });
      expect(plan).toBeDefined();
    });

    it("save an Operations Plan's version without another Operations Plan version", async () => {
      const { operationsPlan, operations } = await plans(db, 2111);
      const draft = await w.insert("plan_versions", { plan_id: operationsPlan, status: "draft" });
      expect(
        await w.update("plan_versions", draft, {
          status: "saved",
          platform_version: "1.4.0",
          operations_version_id: operations,
        }),
      ).toEqual(refusal("An Operations Plan's version doesn't name an Operations Plan version."));
    });

    it("refuse to move a version to another plan", async () => {
      const { draft, operationsPlan } = await plans(db, 2112);
      expect(await w.update("plan_versions", draft, { plan_id: operationsPlan })).toEqual(
        refusal("A plan version can't move to another plan."),
      );
    });
  });

  describe("on a plan", () => {
    it("refuse to change its kind, product, organization, or year once it has a saved version", async () => {
      const { plan, operationsPlan } = await plans(db, 2113);
      const other = await plans(db, 2114);
      const message = "A plan's kind, product, organization, and year can't change once it has a saved version.";
      for (const change of [
        { kind: "operations", product_id: null },
        { product_id: other.product },
        { organization_id: other.organization },
        { fiscal_year: 2115 },
      ]) {
        expect(await w.update("plans", plan, change), JSON.stringify(change)).toEqual(refusal(message));
      }
      expect(await w.update("plans", plan, { name: "Renamed", archived: true })).toBeUndefined();
      expect(await w.update("plans", operationsPlan, { fiscal_year: 2115 })).toEqual(refusal(message));
    });

    it("let a plan with only drafts change", async () => {
      const { organization, product } = await plans(db, 2116);
      const plan = await w.insert("plans", {
        kind: "product",
        product_id: product,
        organization_id: organization,
        fiscal_year: 2117,
      });
      await w.insert("plan_versions", { plan_id: plan, status: "draft" });
      expect(await w.update("plans", plan, { fiscal_year: 2118 })).toBeUndefined();
    });

    it("allow one plan per product, organization, and year, and one Operations Plan per organization and year", async () => {
      const { organization, product } = await plans(db, 2119);
      const again = (values: Values) =>
        w.refusedInsert("plans", { organization_id: organization, fiscal_year: 2119, ...values });
      expect(await again({ kind: "product", product_id: product })).toMatchObject({ code: "23505" });
      expect(await again({ kind: "operations" })).toMatchObject({ code: "23505" });
      expect(await again({ kind: "operations", fiscal_year: 2120 })).toBeUndefined();
    });
  });

  describe("on making a version active", () => {
    it("stamp when, and order a plan's activations so none tie", async () => {
      const { plan, saved, operations, operationsPlan } = await plans(db, 2121);
      const first = await w.insert("plan_activations", { version_id: saved, activated_at: "1999-01-01" });
      const second = await w.insert("plan_activations", { version_id: saved });
      const other = await w.insert("plan_activations", { version_id: operations });
      expect(await w.read("plan_activations", first)).toMatchObject({ plan_id: plan, sequence: 1 });
      expect(await w.read("plan_activations", second)).toMatchObject({ plan_id: plan, sequence: 2 });
      expect(await w.read("plan_activations", other)).toMatchObject({ plan_id: operationsPlan, sequence: 1 });
      expect(((await w.read("plan_activations", first))!["activated_at"] as Date).getFullYear()).toBeGreaterThan(1999);
    });

    it("refuse a draft, or another plan's version", async () => {
      const { draft, saved, operationsPlan } = await plans(db, 2122);
      expect(await w.refusedInsert("plan_activations", { version_id: draft })).toEqual(
        refusal("Only a saved version can be made active."),
      );
      expect(await w.refusedInsert("plan_activations", { version_id: saved, plan_id: operationsPlan })).toEqual(
        refusal("A version can only be made active for its own plan."),
      );
    });

    it("refuse to change or delete an activation", async () => {
      const { saved, operations } = await plans(db, 2123);
      const activation = await w.insert("plan_activations", { version_id: saved });
      const message = "An activation stays in the plan's history. Make another saved version active instead.";
      expect(await w.update("plan_activations", activation, { version_id: operations })).toEqual(refusal(message));
      expect(await w.update("plan_activations", activation, { activated_at: "1999-01-01" })).toEqual(refusal(message));
      expect(await w.remove("plan_activations", activation)).toEqual(refusal(message));
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
    await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_trigger WHERE tgname = 'cyc_saved_versions' AND tgrelid = 'plan_offerings'::regclass`,
    );
    expect(rows[0]!.count).toBe(1);
  });
});

describe("installing the saved-versions triggers", () => {
  it("waits until every planning table has the columns they read", async () => {
    const db = await PGlite.create();
    for (const statement of tables()) await db.exec(statement);
    await db.exec(`ALTER TABLE plans DROP COLUMN fiscal_year`);
    const missing = await db.transaction((tx) => installTriggers(config(false), connect(tx)));
    expect(missing).toEqual(["plans"]);
    const { rows } = await db.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'cyc_saved_versions'`);
    expect(rows).toEqual([]);
  });

  // knex reads a ? as a binding, even in a statement with none.
  it("writes no ? into its SQL", () => {
    expect(triggerStatements(config(true)).join("\n")).not.toContain("?");
  });
});

describe("the saved-versions triggers with dev's flag", () => {
  it("let a saved version, its rows, and its activations be deleted, but not changed", async () => {
    const db = await database(config(true));
    const w = writer(db);
    const { saved, draft, savedOffering, draftOffering } = await plans(db);
    const activation = await w.insert("plan_activations", { version_id: saved });
    expect(await w.update("plan_offerings", savedOffering, { name: "Changed" })).toEqual(refusal(REFUSED));
    expect(await w.update("plan_versions", saved, { message: "Changed" })).toEqual(refusal(REFUSED));
    expect(await w.remove("plan_activations", activation)).toBeUndefined();
    expect(await w.remove("plan_offerings", savedOffering)).toBeUndefined();
    // The draft made from it goes first, since it points at it.
    expect(await w.remove("plan_offerings", draftOffering)).toBeUndefined();
    expect(await w.remove("plan_versions", draft)).toBeUndefined();
    expect(await w.remove("plan_versions", saved)).toBeUndefined();
  });
});
