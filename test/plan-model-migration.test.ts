import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { up } from "../stacks/backend/migrations/cyc0017-plan-model.cjs";

// The move to one plan model (cyc-seattle/platform#276), in a real Postgres (PGlite), on tables
// named and keyed the way Directus makes them, with a trigger like the old hook's that refuses
// every write.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [AREA, FROZEN, DRAFT] = [id(1), id(2), id(3)];
const [OPS_PLAN, AREA_PLAN] = [id(10), id(11)];
const [FROZEN_OPS, FROZEN_AREA, DRAFT_OPS, ORPHAN] = [id(20), id(21), id(22), id(23)];
const [MEMBER_OPS, MEMBER_AREA, MEMBER_DRAFT] = [id(30), id(31), id(32)];

/** The rows of one plan. Each has a `version_id`; some link to another row of the same plan. */
const ROWS: Record<string, string> = {
  plan_offerings: "note text, fill_rate numeric, target_enrollment integer",
  plan_trips: "offering_id uuid",
  plan_activity_blocks: "name text",
  plan_activities: "offering_id uuid, trip_id uuid, block_id uuid",
  plan_block_staff: "block_id uuid",
  plan_block_boats: "block_id uuid",
  plan_pools: "name text",
  plan_salaried_positions: "remainder_pool_id uuid",
  plan_salaried_bookings: "position_id uuid, kind varchar(255)",
  plan_bonus_owners: "role_name text",
  plan_bonus_owner_products: "bonus_owner_id uuid",
  plan_programs: "rules text",
  plan_labor_lines: "note text",
  plan_budget_lines: "note text",
  plan_capital_items: "note text",
  plan_revenue_charges: "note text",
};
const LINKS: [string, string, string][] = [
  ["plan_trips", "offering_id", "plan_offerings"],
  ["plan_activities", "offering_id", "plan_offerings"],
  ["plan_activities", "trip_id", "plan_trips"],
  ["plan_activities", "block_id", "plan_activity_blocks"],
  ["plan_block_staff", "block_id", "plan_activity_blocks"],
  ["plan_block_boats", "block_id", "plan_activity_blocks"],
  ["plan_salaried_positions", "remainder_pool_id", "plan_pools"],
  ["plan_salaried_bookings", "position_id", "plan_salaried_positions"],
  ["plan_bonus_owner_products", "bonus_owner_id", "plan_bonus_owners"],
];
const RESULTS = ["plan_results", "plan_result_positions", "plan_result_capital"];
const MEMBER_RESULTS = ["plan_result_lines", "plan_result_pnl", "plan_result_bonuses", "plan_result_warnings"];

const LONG = `${"A".repeat(100)} first line.\n${"B".repeat(300)}`;
const TOO_LONG_LINE = "C".repeat(300);

async function database(): Promise<PGlite> {
  const db = await PGlite.create();
  const rowTables = Object.entries(ROWS).map(
    ([table, columns]) => `
      CREATE TABLE ${table} (id uuid PRIMARY KEY, version_id uuid NOT NULL, ${columns},
        CONSTRAINT ${table}_version_id_foreign FOREIGN KEY (version_id) REFERENCES plan_versions (id) ON DELETE RESTRICT);`,
  );
  const links = LINKS.map(
    ([table, column, linked]) => `
      ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_foreign FOREIGN KEY (${column}) REFERENCES ${linked} (id) ON DELETE RESTRICT;`,
  );
  const results = [...RESULTS, ...MEMBER_RESULTS].map(
    (table) => `
      CREATE TABLE ${table} (id uuid PRIMARY KEY, version_set_id uuid NOT NULL
        ${MEMBER_RESULTS.includes(table) ? ", version_set_member_id uuid" : ""},
        CONSTRAINT ${table}_version_set_id_foreign FOREIGN KEY (version_set_id) REFERENCES version_sets (id) ON DELETE CASCADE
        ${
          MEMBER_RESULTS.includes(table)
            ? `, CONSTRAINT ${table}_version_set_member_id_foreign FOREIGN KEY (version_set_member_id) REFERENCES version_set_members (id) ON DELETE CASCADE`
            : ""
        });`,
  );
  await db.exec(`
    CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
    CREATE TABLE directus_fields (id serial PRIMARY KEY, collection varchar(64), field varchar(64), special varchar(64));
    CREATE TABLE directus_relations (id serial PRIMARY KEY, many_collection varchar(64), many_field varchar(64),
      one_collection varchar(64), one_field varchar(64), one_deselect_action varchar(255));
    CREATE TABLE directus_presets (id serial PRIMARY KEY, collection varchar(64), "user" uuid, role uuid, bookmark text);
    CREATE TABLE directus_revisions (id serial PRIMARY KEY, collection varchar(64));
    CREATE TABLE program_areas (id uuid PRIMARY KEY);
    CREATE TABLE assets (id uuid PRIMARY KEY, note text);
    CREATE TABLE version_sets (id uuid PRIMARY KEY, name text, message text, status varchar(255) NOT NULL DEFAULT 'draft',
      saved_by uuid, saved_at timestamptz, effective_from date);
    CREATE UNIQUE INDEX cyc_one_set_per_date ON version_sets (effective_from) WHERE effective_from IS NOT NULL;
    CREATE TABLE plans (id uuid PRIMARY KEY, kind varchar(255) NOT NULL, program_area_id uuid REFERENCES program_areas (id),
      name text);
    CREATE TABLE plan_versions (id uuid PRIMARY KEY, plan_id uuid NOT NULL,
      parent_version_id uuid, status varchar(255), message text, saved_by uuid, saved_at timestamptz,
      platform_version varchar(255), rules text,
      CONSTRAINT plan_versions_plan_id_foreign FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT,
      CONSTRAINT plan_versions_parent_version_id_foreign FOREIGN KEY (parent_version_id) REFERENCES plan_versions (id));
    CREATE TABLE version_set_members (id uuid PRIMARY KEY, version_set_id uuid REFERENCES version_sets (id) ON DELETE CASCADE,
      plan_id uuid REFERENCES plans (id), version_id uuid UNIQUE REFERENCES plan_versions (id));
    ${rowTables.join("")}
    ${links.join("")}
    ${results.join("")}

    INSERT INTO directus_collections VALUES ('plans'), ('plan_versions'), ('version_sets'), ('version_set_members'),
      ('plan_offerings');
    INSERT INTO directus_fields (collection, field, special) VALUES
      ('plans', 'kind', NULL), ('plans', 'versions', 'o2m'), ('plan_versions', 'plan_id', 'm2o'),
      ('plan_versions', 'status', NULL), ('plan_versions', 'rules', NULL), ('version_sets', 'message', NULL),
      ('version_sets', 'saved_at', NULL), ('version_sets', 'members', 'o2m'), ('version_set_members', 'version_id', 'm2o'),
      ('plan_offerings', 'version_id', 'm2o'), ('plan_offerings', 'fill_rate', NULL), ('plan_programs', 'rules', NULL),
      ('plan_result_lines', 'version_set_id', 'm2o'), ('plan_result_lines', 'version_set_member_id', 'm2o');
    INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field) VALUES
      ('plan_versions', 'plan_id', 'plans', 'versions'), ('version_set_members', 'version_set_id', 'version_sets', 'members'),
      ('plan_offerings', 'version_id', 'plan_versions', NULL), ('plan_result_lines', 'version_set_id', 'version_sets', NULL),
      ('plan_result_lines', 'version_set_member_id', 'version_set_members', NULL);
    INSERT INTO directus_presets (collection, "user", role, bookmark) VALUES
      ('version_sets', NULL, NULL, NULL), ('version_sets', '${id(99)}', NULL, 'Mine');
    INSERT INTO directus_revisions (collection) VALUES ('plan_versions'), ('version_set_members');

    INSERT INTO program_areas VALUES ('${AREA}');
    INSERT INTO assets VALUES ('${id(80)}', 'Bought\n used');
    INSERT INTO version_sets (id, name, message, status, saved_by, saved_at) VALUES
      ('${FROZEN}', 'Frozen', '${LONG}', 'saved', '${id(99)}', now()),
      ('${DRAFT}', 'Draft', '${TOO_LONG_LINE}\nmore', 'draft', NULL, NULL);
    INSERT INTO plans VALUES ('${OPS_PLAN}', 'operations', NULL, 'Operations'), ('${AREA_PLAN}', 'program_area', '${AREA}', 'Area');
    INSERT INTO plan_versions (id, plan_id, parent_version_id, status, rules) VALUES
      ('${FROZEN_OPS}', '${OPS_PLAN}', NULL, 'saved', E'- Every Monday\\n\\n  * Not on holidays  \\n'),
      ('${FROZEN_AREA}', '${AREA_PLAN}', NULL, 'saved', NULL),
      ('${DRAFT_OPS}', '${OPS_PLAN}', '${FROZEN_OPS}', 'draft', ''),
      ('${ORPHAN}', '${AREA_PLAN}', '${FROZEN_AREA}', 'draft', NULL);
    INSERT INTO version_set_members VALUES
      ('${MEMBER_OPS}', '${FROZEN}', '${OPS_PLAN}', '${FROZEN_OPS}'),
      ('${MEMBER_AREA}', '${FROZEN}', '${AREA_PLAN}', '${FROZEN_AREA}'),
      ('${MEMBER_DRAFT}', '${DRAFT}', '${OPS_PLAN}', '${DRAFT_OPS}');
    INSERT INTO plan_offerings (id, version_id, note, fill_rate) VALUES
      ('${id(40)}', '${FROZEN_AREA}', E'Short\\nnote', 0.5), ('${id(41)}', '${ORPHAN}', '${"D".repeat(400)}', NULL);
    INSERT INTO plan_activity_blocks (id, version_id) VALUES ('${id(42)}', '${ORPHAN}');
    INSERT INTO plan_activities (id, version_id, offering_id, block_id) VALUES ('${id(43)}', '${ORPHAN}', '${id(41)}', '${id(42)}');
    INSERT INTO plan_programs (id, version_id, rules) VALUES ('${id(44)}', '${FROZEN_AREA}', E'One\\nTwo');
    INSERT INTO plan_results VALUES ('${id(50)}', '${FROZEN}');
    INSERT INTO plan_result_lines VALUES ('${id(51)}', '${FROZEN}', '${MEMBER_AREA}'), ('${id(52)}', '${FROZEN}', NULL);

    CREATE FUNCTION cyc_saved_versions_row() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused'; END $$;
    CREATE TRIGGER cyc_saved_versions BEFORE INSERT OR UPDATE OR DELETE ON plan_offerings
      FOR EACH ROW EXECUTE FUNCTION cyc_saved_versions_row();
    CREATE TRIGGER cyc_saved_versions BEFORE INSERT OR UPDATE OR DELETE ON version_sets
      FOR EACH ROW EXECUTE FUNCTION cyc_saved_versions_row();
    CREATE TRIGGER cyc_saved_versions BEFORE INSERT OR UPDATE OR DELETE ON plan_result_lines
      FOR EACH ROW EXECUTE FUNCTION cyc_saved_versions_row();
  `);
  return db;
}

const knex = (db: PGlite) => ({ raw: (sql: string) => db.exec(sql) });

async function rows<T>(db: PGlite, sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

// Starting a PGlite can take longer than the 5s default on a CI runner.
describe("the plan model migration", { timeout: 30_000 }, () => {
  it("makes each copy a plan in its Financial Plan, and deletes copies in none, with their rows", async () => {
    const db = await database();
    await up(knex(db));
    await up(knex(db));
    expect(await rows(db, "SELECT id, financial_plan_id, kind, program_area_id FROM plans ORDER BY id")).toEqual([
      { id: FROZEN_OPS, financial_plan_id: FROZEN, kind: "operations", program_area_id: null },
      { id: FROZEN_AREA, financial_plan_id: FROZEN, kind: "program_area", program_area_id: AREA },
      { id: DRAFT_OPS, financial_plan_id: DRAFT, kind: "operations", program_area_id: null },
    ]);
    expect(await rows(db, "SELECT id FROM plan_offerings")).toEqual([{ id: id(40) }]);
    expect(await rows(db, "SELECT id FROM plan_activities")).toEqual([]);
    expect(await rows(db, "SELECT to_regclass('version_set_members') AS t, to_regclass('version_sets') AS s")).toEqual([
      { t: null, s: null },
    ]);
  });

  it("renames every row's version_id to plan_id, and results' links to the Financial Plan and plan", async () => {
    const db = await database();
    await up(knex(db));
    expect(await rows(db, "SELECT plan_id FROM plan_programs")).toEqual([{ plan_id: FROZEN_AREA }]);
    expect(await rows(db, "SELECT id, financial_plan_id, plan_id FROM plan_result_lines ORDER BY id")).toEqual([
      { id: id(51), financial_plan_id: FROZEN, plan_id: FROZEN_AREA },
      { id: id(52), financial_plan_id: FROZEN, plan_id: null },
    ]);
    expect(await rows(db, "SELECT financial_plan_id FROM plan_results")).toEqual([{ financial_plan_id: FROZEN }]);
  });

  it("freezes what was saved, and keeps a long note's first line only when it fits", async () => {
    const db = await database();
    await up(knex(db));
    expect(await rows(db, "SELECT id, status, note, frozen_by FROM financial_plans ORDER BY id")).toEqual([
      { id: FROZEN, status: "frozen", note: `${"A".repeat(100)} first line.`, frozen_by: id(99) },
      { id: DRAFT, status: "draft", note: null, frozen_by: null },
    ]);
  });

  it("makes rules a list of notes, and notes one line of at most 280 characters", async () => {
    const db = await database();
    await up(knex(db));
    expect(await rows(db, "SELECT id, notes FROM plans ORDER BY id")).toEqual([
      { id: FROZEN_OPS, notes: ["Every Monday", "Not on holidays"] },
      { id: FROZEN_AREA, notes: null },
      { id: DRAFT_OPS, notes: null },
    ]);
    expect(await rows(db, "SELECT notes FROM plan_programs")).toEqual([{ notes: ["One", "Two"] }]);
    expect(await rows(db, "SELECT note FROM plan_offerings")).toEqual([{ note: "Short note" }]);
    expect(await rows(db, "SELECT note FROM assets")).toEqual([{ note: "Bought used" }]);
    const types = await rows<{ table_name: string; column_name: string; character_maximum_length: number }>(
      db,
      `SELECT table_name, column_name, character_maximum_length FROM information_schema.columns
        WHERE column_name = 'note' ORDER BY table_name`,
    );
    expect(types.map((t) => [t.table_name, t.character_maximum_length])).toEqual([
      ["assets", 280],
      ["financial_plans", 280],
      ["plan_budget_lines", 280],
      ["plan_capital_items", 280],
      ["plan_labor_lines", 280],
      ["plan_offerings", 280],
      ["plan_revenue_charges", 280],
    ]);
  });

  it("drops the fields nothing reads", async () => {
    const db = await database();
    await up(knex(db));
    const columns = await rows<{ c: string }>(
      db,
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
        WHERE table_name IN ('plans', 'plan_offerings', 'plan_salaried_bookings', 'financial_plans') ORDER BY 1`,
    );
    expect(columns.map((c) => c.c)).toEqual([
      "financial_plans.effective_from",
      "financial_plans.frozen_at",
      "financial_plans.frozen_by",
      "financial_plans.id",
      "financial_plans.name",
      "financial_plans.note",
      "financial_plans.status",
      "plan_offerings.id",
      "plan_offerings.note",
      "plan_offerings.plan_id",
      "plan_offerings.target_enrollment",
      "plan_salaried_bookings.id",
      "plan_salaried_bookings.plan_id",
      "plan_salaried_bookings.position_id",
      "plans.financial_plan_id",
      "plans.id",
      "plans.kind",
      "plans.notes",
      "plans.program_area_id",
    ]);
  });

  it("renames Directus's records, and keeps a user's own view", async () => {
    const db = await database();
    await up(knex(db));
    expect(await rows(db, "SELECT collection FROM directus_collections ORDER BY 1")).toEqual([
      { collection: "financial_plans" },
      { collection: "plan_offerings" },
      { collection: "plans" },
    ]);
    expect(await rows(db, "SELECT collection, field, special FROM directus_fields ORDER BY collection, field")).toEqual(
      [
        { collection: "financial_plans", field: "frozen_at", special: null },
        { collection: "financial_plans", field: "note", special: null },
        { collection: "financial_plans", field: "plans", special: "o2m" },
        { collection: "plan_offerings", field: "plan_id", special: "m2o" },
        { collection: "plan_programs", field: "notes", special: "cast-json" },
        { collection: "plan_result_lines", field: "financial_plan_id", special: "m2o" },
        { collection: "plan_result_lines", field: "plan_id", special: "m2o" },
        { collection: "plans", field: "financial_plan_id", special: "m2o" },
        { collection: "plans", field: "kind", special: null },
        { collection: "plans", field: "notes", special: "cast-json" },
        { collection: "plans", field: "program_area_id", special: "m2o" },
      ],
    );
    expect(
      await rows(
        db,
        "SELECT many_collection, many_field, one_collection, one_field FROM directus_relations ORDER BY 1, 2",
      ),
    ).toEqual([
      { many_collection: "plan_offerings", many_field: "plan_id", one_collection: "plans", one_field: null },
      {
        many_collection: "plan_result_lines",
        many_field: "financial_plan_id",
        one_collection: "financial_plans",
        one_field: null,
      },
      { many_collection: "plan_result_lines", many_field: "plan_id", one_collection: "plans", one_field: null },
      {
        many_collection: "plans",
        many_field: "financial_plan_id",
        one_collection: "financial_plans",
        one_field: "plans",
      },
      { many_collection: "plans", many_field: "program_area_id", one_collection: "program_areas", one_field: null },
    ]);
    expect(await rows(db, "SELECT collection, bookmark FROM directus_presets ORDER BY 1")).toEqual([
      { collection: "financial_plans", bookmark: "Mine" },
      { collection: "version_sets", bookmark: null },
    ]);
    expect(await rows(db, "SELECT collection FROM directus_revisions ORDER BY 1")).toEqual([
      { collection: "plans" },
      { collection: "version_set_members" },
    ]);
  });

  it("names the keys as Directus would, and drops the old triggers", async () => {
    const db = await database();
    await up(knex(db));
    const keys = await rows<{ conname: string }>(
      db,
      `SELECT conname FROM pg_constraint WHERE conrelid IN ('plans'::regclass, 'plan_offerings'::regclass,
        'plan_activities'::regclass, 'plan_result_lines'::regclass) AND contype IN ('f', 'p') ORDER BY 1`,
    );
    expect(keys.map((k) => k.conname)).toEqual([
      "plan_activities_block_id_foreign",
      "plan_activities_offering_id_foreign",
      "plan_activities_pkey",
      "plan_activities_plan_id_foreign",
      "plan_activities_trip_id_foreign",
      "plan_offerings_pkey",
      "plan_offerings_plan_id_foreign",
      "plan_result_lines_financial_plan_id_foreign",
      "plan_result_lines_pkey",
      "plan_result_lines_plan_id_foreign",
      "plans_financial_plan_id_foreign",
      "plans_pkey",
      "plans_program_area_id_foreign",
    ]);
    expect(await rows(db, "SELECT tgname FROM pg_trigger WHERE tgname = 'cyc_saved_versions'")).toEqual([]);
  });

  it("deletes a Financial Plan's plans and their rows with it", async () => {
    const db = await database();
    await up(knex(db));
    await db.exec(`
      INSERT INTO plan_activity_blocks (id, plan_id) VALUES ('${id(60)}', '${FROZEN_AREA}');
      INSERT INTO plan_activities (id, plan_id, offering_id, block_id) VALUES ('${id(61)}', '${FROZEN_AREA}', '${id(40)}', '${id(60)}');
      DELETE FROM financial_plans WHERE id = '${FROZEN}';
    `);
    expect(await rows(db, "SELECT id FROM plans")).toEqual([{ id: DRAFT_OPS }]);
    expect(await rows(db, "SELECT count(*)::int AS n FROM plan_activities")).toEqual([{ n: 0 }]);
    expect(await rows(db, "SELECT count(*)::int AS n FROM plan_result_lines")).toEqual([{ n: 0 }]);
  });

  it("does nothing on a new database", async () => {
    const db = await PGlite.create();
    await up(knex(db));
    expect(await rows(db, "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'")).toEqual([{ n: 0 }]);
  });
});
