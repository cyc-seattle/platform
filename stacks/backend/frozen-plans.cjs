// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a frozen Financial Plan, and every plan in it, from changing, for every user, admins
// included (docs/planning-schema.md), apart from its name, its note, the date it's active from, and
// whether it's archived. Its filters refuse such a request with a clear 403, and stamp who froze a
// Financial Plan. Directus skips filters on some paths, such as a flow's data steps, so the
// database triggers it installs refuse the same writes on every path.
// It also copies a new Financial Plan's parent into it, and works out its results: a draft's again
// after each change to what they're worked out from, and a frozen one's once, when it's frozen.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const crypto = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const url = require("node:url");

const PLANS = "plans";
// Written last when a Financial Plan's results go in, so one that has it has them all.
const RESULTS = "plan_results";
const SETS = "financial_plans";

const REFUSED = "A frozen plan can't be changed. Start a new Financial Plan from the one it's in.";
const NOT_EDITOR = "Only someone who can edit this Financial Plan can do this.";
const NOT_DRAFT = "Only a draft's numbers can be worked out again.";
const PLAN_STAYS = "A plan can't move to another Financial Plan.";
const ROW_STAYS = "A plan row can't move to another plan. Copy it into that plan instead.";
const SAME_PLAN = "A plan row can only link to rows in its own plan.";
const AREA_NAMED = "A program area's plan names its program area, and an Operations Plan names none.";
const RESULTS_BY_HOOK = "A Financial Plan's results are worked out from its plans, and can't be written by hand.";
const NEW_SET_DRAFT = "A new Financial Plan starts as a draft.";
const SET_STAYS =
  "A frozen Financial Plan can't be changed, apart from its name, its note, the date it's active from, and whether it's archived. Start a new one from it.";
const SET_FIXED = "A Financial Plan's organization, year, and parent can't change.";
const PARENT_SAME_ORGANIZATION = "A Financial Plan can only start from one for the same organization.";
const NEEDS_OPERATIONS = "A Financial Plan needs an Operations Plan before it's frozen.";
const PLANS_FIXED = "A frozen Financial Plan's plans can't change. Start a new Financial Plan from it.";
const ONE_PER_AREA = "A Financial Plan holds one Operations Plan, and at most one Program Plan for each program area.";
const ONE_PER_DATE = "Another Financial Plan for the year is already active from that date.";
const IN_FORCE_NOT_ARCHIVED = "The plan in force can't be archived, and nor can one active from a later date.";
const ARCHIVED_NOT_ACTIVE = "An archived Financial Plan can't be made active. Bring it back from the archive first.";
const ACTIVE_STAYS = "An active Financial Plan can't be deleted. Clear the date it's active from first.";
const BONUS_IN_OPERATIONS = "A bonus goes in the Operations Plan.";
const SHORT_NOTES = "Each note is one line of at most 280 characters.";

/** What a frozen Financial Plan lets change: its name, its note, the date it's active from, and whether it's archived. */
const SET_EDITABLE = ["name", "note", "effective_from", "archived_at"];

/** The plan rows only an Operations Plan holds, which the database refuses in a Program Plan. */
const OPERATIONS_ONLY_ROWS = ["plan_bonus_owners", "plan_bonus_owner_products"];

/** Each reason a trigger gives, which the hook answers with its status. */
const REASONS = {
  [REFUSED]: 403,
  [SET_STAYS]: 403,
  [PLANS_FIXED]: 403,
  [ACTIVE_STAYS]: 403,
  [RESULTS_BY_HOOK]: 403,
  [PLAN_STAYS]: 400,
  [ROW_STAYS]: 400,
  [SAME_PLAN]: 400,
  [AREA_NAMED]: 400,
  [NEW_SET_DRAFT]: 400,
  [SET_FIXED]: 400,
  [PARENT_SAME_ORGANIZATION]: 400,
  [NEEDS_OPERATIONS]: 400,
  [ONE_PER_AREA]: 400,
  [ONE_PER_DATE]: 400,
  [IN_FORCE_NOT_ARCHIVED]: 400,
  [ARCHIVED_NOT_ACTIVE]: 400,
  [BONUS_IN_OPERATIONS]: 400,
  [SHORT_NOTES]: 400,
};
/** The SQLSTATE every trigger raises, so the hook can tell its refusals from other errors. */
const SQLSTATE = "CY001";

/** Whether a Financial Plan's status is frozen. */
function isFrozen(status) {
  return status === "frozen";
}

/** A `DirectusError` by duck type, which Directus's error handler answers with its status. */
function refuse(reason, status = 403) {
  const error = new Error(reason);
  error.name = "DirectusError";
  error.code = status === 403 ? "FORBIDDEN" : "INVALID_PAYLOAD";
  error.status = status;
  error.extensions = { reason };
  return error;
}

/** A many-to-one's key, whether the payload gives the key or a nested row. */
function keyOf(value) {
  return value !== null && typeof value === "object" ? value.id : value;
}

/** A payload without the fields only the hook stamps. */
function unstamped(payload, fields) {
  const rest = { ...payload };
  for (const field of fields) delete rest[field];
  return rest;
}

/**
 * Checks one write, and returns the payload to write. `event` is `create`, `update`, or `delete`;
 * `keys` are the rows an update or delete touches. `lookup` reads the database:
 * - `planIds(collection, keys)`: the `plan_id` of each row
 * - `plans(ids)`: each plan's `id`, `financial_plan_id`, `kind`, and `program_area_id`
 * - `sets(ids)`: each Financial Plan's `id`, `status`, and `archived_at`
 * - `deletesFrozen(user)`: whether this user may delete a frozen Financial Plan, which only dev allows
 */
async function guard({ collection, event, payload, keys = [], user, now }, config, lookup) {
  const frozenSet = async (ids) => ids.length > 0 && (await lookup.sets(ids)).some((set) => isFrozen(set.status));
  const frozenPlan = async (ids) =>
    ids.length > 0 && frozenSet([...new Set((await lookup.plans(ids)).map((plan) => plan.financial_plan_id))]);

  if (collection === PLANS) {
    const current = event === "create" ? [] : await lookup.plans(keys);
    const sets = current.map((plan) => plan.financial_plan_id);
    if (event === "create") sets.push(keyOf(payload.financial_plan_id));
    if (await frozenSet([...new Set(sets.filter(Boolean))])) {
      if (event !== "delete" || !(await lookup.deletesFrozen(user))) throw refuse(PLANS_FIXED);
    }
    if (event === "delete") return payload;
    if (event === "update" && "financial_plan_id" in payload) {
      if (current.some((plan) => plan.financial_plan_id !== keyOf(payload.financial_plan_id)))
        throw refuse(PLAN_STAYS, 400);
    }
    for (const plan of event === "create" ? [{}] : current) {
      const kind = "kind" in payload ? payload.kind : plan.kind;
      const area = keyOf("program_area_id" in payload ? payload.program_area_id : plan.program_area_id) ?? null;
      if ((kind === "program_area") !== (area !== null)) throw refuse(AREA_NAMED, 400);
    }
    return payload;
  }

  if (collection === SETS) {
    const stamps = ["frozen_by", "frozen_at"];
    if (event === "create") {
      if ((payload.status ?? "draft") !== "draft") throw refuse(NEW_SET_DRAFT, 400);
      return unstamped(payload, stamps);
    }
    if (event === "delete") {
      if ((await frozenSet(keys)) && !(await lookup.deletesFrozen(user))) throw refuse(SET_STAYS);
      return payload;
    }
    // The triggers check the dates it's active from, and archiving, against the other Financial Plans.
    const sets = await lookup.sets(keys);
    if (sets.some((set) => isFrozen(set.status))) {
      // Only its name and note change, such as "Reviewed with the board", and when it's active, and whether it's archived.
      const changed = Object.keys(payload).filter((field) => !(field === "status" && payload.status === "frozen"));
      if (changed.some((field) => !SET_EDITABLE.includes(field))) throw refuse(SET_STAYS);
      // A draft changed with a frozen one is refused too, rather than frozen without its stamps.
      if ("status" in payload && sets.some((set) => set.status !== payload.status)) throw refuse(SET_STAYS);
      return payload;
    }
    const rest = unstamped(payload, stamps);
    if (rest.status !== "frozen") return rest;
    return { ...rest, frozen_by: user ?? null, frozen_at: now };
  }

  if (config.results.includes(collection)) {
    if (event === "delete" && (await lookup.deletesFrozen(user))) return payload;
    throw refuse(RESULTS_BY_HOOK);
  }
  if (!config.rows.includes(collection)) return payload;
  const ids = event === "create" ? [] : await lookup.planIds(collection, keys);
  if (event !== "delete" && payload.plan_id !== undefined) ids.push(keyOf(payload.plan_id));
  if (await frozenPlan([...new Set(ids.filter(Boolean))])) {
    if (event !== "delete" || !(await lookup.deletesFrozen(user))) throw refuse(REFUSED);
  }
  return payload;
}

/** Directus's error for a write a trigger refused, with what it found, such as which area. */
function databaseError(error) {
  if (error?.code === SQLSTATE) {
    // knex puts the statement before the trigger's message.
    const reason = Object.keys(REASONS).find((known) => String(error.message).endsWith(known));
    if (!reason) return error;
    return refuse(error.detail ? `${reason} ${error.detail}` : reason, REASONS[reason]);
  }
  return error;
}

const literal = (text) => `'${text.replaceAll("'", "''")}'`;
const raise = (reason) => `RAISE EXCEPTION USING ERRCODE = '${SQLSTATE}', MESSAGE = ${literal(reason)}`;

/** The columns each trigger reads, by table. The triggers wait until every one exists. */
function columnsNeeded(config) {
  return {
    [PLANS]: ["id", "financial_plan_id", "kind", "program_area_id", "notes"],
    [SETS]: [
      "id",
      "organization_id",
      "fiscal_year",
      "status",
      "parent_id",
      "frozen_by",
      "frozen_at",
      "archived_at",
      "effective_from",
    ],
    ...Object.fromEntries(config.results.map((table) => [table, ["id", "financial_plan_id"]])),
    ...Object.fromEntries(
      config.rows.map((table) => [table, ["id", "plan_id", ...Object.keys(config.links[table] ?? {})]]),
    ),
  };
}

/** SQL that refuses a row whose `notes` aren't a list of short notes, each one line. */
const checkNotes = (row) => `
  -- Not jsonb's key-exists operator, which knex reads as a binding.
  IF coalesce(jsonb_typeof(to_jsonb(${row}) -> 'notes'), 'null') <> 'null' AND (
    jsonb_typeof(to_jsonb(${row}) -> 'notes') <> 'array' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(to_jsonb(${row}) -> 'notes') note
        WHERE jsonb_typeof(note) <> 'string' OR length(note #>> '{}') > 280 OR strpos(note #>> '{}', E'\\n') > 0
    )
  ) THEN
    ${raise(SHORT_NOTES)};
  END IF;`;

/**
 * The statements that install the triggers' own functions and triggers on the planning tables. Each
 * trigger locks the Financial Plan it checks, so it can't be frozen, or a plan changed, while a write
 * that read it is still open.
 */
function triggerStatements(config) {
  const deletable = config.deletable ? "true" : "false";
  const editable = `ARRAY[${SET_EDITABLE.map(literal).join(", ")}]`;
  const row = `
CREATE OR REPLACE FUNCTION cyc_frozen_plans_row() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  set_status text;
  linked_id uuid;
  linked_plan uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    ${raise(ROW_STAYS)};
  END IF;
  -- A plan or Financial Plan that's gone is a draft's, whose delete cascades to its rows.
  SELECT s.status INTO set_status FROM ${PLANS} p JOIN ${SETS} s ON s.id = p.financial_plan_id
    WHERE p.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.plan_id ELSE OLD.plan_id END
    FOR SHARE;
  IF set_status = 'frozen' AND NOT (TG_OP = 'DELETE' AND ${deletable}) THEN
    ${raise(REFUSED)};
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME IN (${OPERATIONS_ONLY_ROWS.map(literal).join(", ")}) AND EXISTS (
    SELECT 1 FROM ${PLANS} p WHERE p.id = NEW.plan_id AND p.kind <> 'operations'
  ) THEN
    ${raise(BONUS_IN_OPERATIONS)};
  END IF;
  ${checkNotes("NEW")}
  -- The trigger's arguments are pairs: a field, then the table it links to.
  FOR i IN 0 .. TG_NARGS - 1 BY 2 LOOP
    linked_id := (to_jsonb(NEW) ->> TG_ARGV[i])::uuid;
    IF linked_id IS NOT NULL THEN
      EXECUTE format('SELECT plan_id FROM %I WHERE id = $1', TG_ARGV[i + 1]) INTO linked_plan USING linked_id;
      -- A row that doesn't exist is the foreign key's to refuse.
      IF linked_plan IS NOT NULL AND linked_plan <> NEW.plan_id THEN
        ${raise(SAME_PLAN)};
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$fn$`;

  // Only the hook writes results, a set at a time, with no results there yet. A draft's are replaced
  // as its plans change, and cleared when it's frozen; a frozen one's go in once and never change.
  const result = `
CREATE OR REPLACE FUNCTION cyc_frozen_plans_result() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  set_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT s.status INTO set_status FROM ${SETS} s WHERE s.id = OLD.financial_plan_id;
    -- A Financial Plan or plan that's gone is a draft's, whose delete cascades to its results.
    IF ${deletable} OR set_status IS NULL
      OR (to_jsonb(OLD) ->> 'plan_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${PLANS} p WHERE p.id = (to_jsonb(OLD) ->> 'plan_id')::uuid))
      OR (set_status = 'draft' AND current_setting('cyc.writing_results', true) = 'on') THEN
      RETURN OLD;
    END IF;
    ${raise(RESULTS_BY_HOOK)};
  END IF;
  IF TG_OP = 'UPDATE' OR current_setting('cyc.writing_results', true) IS DISTINCT FROM 'on' THEN
    ${raise(RESULTS_BY_HOOK)};
  END IF;
  SELECT s.status INTO set_status FROM ${SETS} s WHERE s.id = NEW.financial_plan_id FOR SHARE;
  IF set_status IS NULL
    OR EXISTS (SELECT 1 FROM ${RESULTS} r WHERE r.financial_plan_id = NEW.financial_plan_id) THEN
    ${raise(RESULTS_BY_HOOK)};
  END IF;
  RETURN NEW;
END
$fn$`;

  // A Financial Plan's plans change only while it's a draft: one Operations Plan, and at most one
  // Program Plan for each program area.
  const plan = `
CREATE OR REPLACE FUNCTION cyc_frozen_plans_plan() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  set_status text;
  clash text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT s.status INTO set_status FROM ${SETS} s WHERE s.id = OLD.financial_plan_id FOR SHARE;
    IF set_status = 'frozen' AND NOT ${deletable} THEN
      ${raise(PLANS_FIXED)};
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.financial_plan_id IS DISTINCT FROM OLD.financial_plan_id THEN
    ${raise(PLAN_STAYS)};
  END IF;
  SELECT s.status INTO set_status FROM ${SETS} s WHERE s.id = NEW.financial_plan_id FOR SHARE;
  IF set_status = 'frozen' THEN
    ${raise(PLANS_FIXED)};
  END IF;
  IF (NEW.kind = 'program_area') IS DISTINCT FROM (NEW.program_area_id IS NOT NULL) THEN
    ${raise(AREA_NAMED)};
  END IF;
  ${checkNotes("NEW")}
  IF TG_OP = 'INSERT' OR (NEW.kind, NEW.program_area_id) IS DISTINCT FROM (OLD.kind, OLD.program_area_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cyc_set|' || NEW.financial_plan_id, 0));
    SELECT coalesce(area.name, 'the Operations Plan') INTO clash
      FROM ${PLANS} p LEFT JOIN program_areas area ON area.id = p.program_area_id
      WHERE p.financial_plan_id = NEW.financial_plan_id AND p.id <> NEW.id
        AND p.kind = NEW.kind AND p.program_area_id IS NOT DISTINCT FROM NEW.program_area_id
      LIMIT 1;
    IF clash IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '${SQLSTATE}', MESSAGE = ${literal(ONE_PER_AREA)},
        DETAIL = format('It already has %s.', clash);
    END IF;
  END IF;
  RETURN NEW;
END
$fn$`;

  // The plan in force on a day is the one for its year with the latest date on or before it, so no
  // two share a date. Today is the database's date, which is UTC.
  const set = `
CREATE OR REPLACE FUNCTION cyc_frozen_plans_set() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'frozen' AND NOT ${deletable} THEN
      ${raise(SET_STAYS)};
    END IF;
    IF OLD.effective_from IS NOT NULL AND NOT ${deletable} THEN
      ${raise(ACTIVE_STAYS)};
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.effective_from IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    IF NEW.archived_at IS NOT NULL THEN
      ${raise(ARCHIVED_NOT_ACTIVE)};
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      concat_ws('|', 'cyc_set_activation', NEW.organization_id, NEW.fiscal_year), 0));
    IF EXISTS (
      SELECT 1 FROM ${SETS} o
        WHERE o.organization_id = NEW.organization_id AND o.fiscal_year = NEW.fiscal_year
          AND o.effective_from = NEW.effective_from AND o.id <> NEW.id
    ) THEN
      ${raise(ONE_PER_DATE)};
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      ${raise(NEW_SET_DRAFT)};
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      SELECT s.organization_id INTO parent FROM ${SETS} s WHERE s.id = NEW.parent_id;
      IF parent.organization_id IS DISTINCT FROM NEW.organization_id THEN
        ${raise(PARENT_SAME_ORGANIZATION)};
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- In force today, or from a later date: no plan for the year dated after it has taken over by today.
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL AND NEW.effective_from IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ${SETS} o
        WHERE o.organization_id = NEW.organization_id AND o.fiscal_year = NEW.fiscal_year AND o.id <> NEW.id
          AND o.effective_from > NEW.effective_from AND o.effective_from <= current_date
    ) THEN
    ${raise(IN_FORCE_NOT_ARCHIVED)};
  END IF;
  IF OLD.status = 'frozen' THEN
    IF (to_jsonb(NEW) - ${editable}) IS DISTINCT FROM (to_jsonb(OLD) - ${editable}) THEN
      ${raise(SET_STAYS)};
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.organization_id, NEW.fiscal_year, NEW.parent_id) IS DISTINCT FROM (OLD.organization_id, OLD.fiscal_year, OLD.parent_id) THEN
    ${raise(SET_FIXED)};
  END IF;
  IF NEW.status = 'frozen' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cyc_set|' || NEW.id, 0));
    IF NOT EXISTS (SELECT 1 FROM ${PLANS} p WHERE p.financial_plan_id = NEW.id AND p.kind = 'operations') THEN
      ${raise(NEEDS_OPERATIONS)};
    END IF;
    -- A draft's results are cleared, for the hook to work out again and stamp with its engine.
    PERFORM set_config('cyc.writing_results', 'on', true);
    ${config.results.map((table) => `DELETE FROM ${table} WHERE financial_plan_id = NEW.id;`).join("\n    ")}
    PERFORM set_config('cyc.writing_results', 'off', true);
    NEW.frozen_at := now();
  END IF;
  RETURN NEW;
END
$fn$`;

  const trigger = (table, fn, events, args = []) => [
    `DROP TRIGGER IF EXISTS cyc_frozen_plans ON ${table}`,
    `CREATE TRIGGER cyc_frozen_plans BEFORE ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}(${args
      .map(literal)
      .join(", ")})`,
  ];
  const all = "INSERT OR UPDATE OR DELETE";
  return [
    row,
    result,
    plan,
    set,
    ...trigger(PLANS, "cyc_frozen_plans_plan", all),
    ...trigger(SETS, "cyc_frozen_plans_set", all),
    // One Financial Plan for an organization's year active from each date, should two writes race the trigger.
    `CREATE UNIQUE INDEX IF NOT EXISTS cyc_one_set_per_date ON ${SETS} (organization_id, fiscal_year, effective_from) WHERE effective_from IS NOT NULL`,
    ...config.results.flatMap((table) => trigger(table, "cyc_frozen_plans_result", all)),
    ...config.rows.flatMap((table) =>
      trigger(table, "cyc_frozen_plans_row", all, Object.entries(config.links[table] ?? {}).flat()),
    ),
  ];
}

/** The tables that get a trigger. */
const triggered = (config) => [PLANS, SETS, ...config.results, ...config.rows];

/** A hash of the triggers `config` installs, which the install records on a function it makes. */
function fingerprint(config) {
  return crypto.createHash("sha256").update(triggerStatements(config).join(";\n")).digest("hex");
}

/** Which tables have their trigger, and the installed triggers' fingerprint. */
async function triggerStatus(config, db) {
  const tables = triggered(config);
  const [{ fingerprint: installed }] = await db.query(
    "SELECT obj_description(to_regproc('cyc_frozen_plans_row'), 'pg_proc') AS fingerprint",
  );
  const triggers = new Set(
    (
      await db.query(
        `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname = 'cyc_frozen_plans' AND c.relnamespace = current_schema()::regnamespace`,
      )
    ).map((row) => row.relname),
  );
  return {
    fingerprint: installed ?? null,
    tables: Object.fromEntries(tables.map((table) => [table, triggers.has(table)])),
  };
}

// Long enough for a write in flight to commit, short enough not to hold up Directus's start.
const LOCK_TIMEOUT = "5s";

/**
 * Installs the triggers, inside one transaction the caller opens. `db.query(sql)` returns rows;
 * `db.exec(sql)` runs one statement. Returns the tables whose columns don't all exist yet, and
 * installs nothing unless that's none. Skips the install, which locks every planning table, when
 * the same triggers are already on every table.
 */
async function installTriggers(config, db) {
  await db.exec(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  // Serializes Directus's processes, which each install at startup.
  await db.exec("SELECT pg_advisory_xact_lock(hashtext('cyc_frozen_plans'))");
  const rows = await db.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
  );
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(columnsNeeded(config))
    .filter(([table, columns]) => columns.some((column) => !present.has(`${table}.${column}`)))
    .map(([table]) => table);
  if (missing.length > 0) return { missing, installed: false };
  const status = await triggerStatus(config, db);
  const hash = fingerprint(config);
  if (status.fingerprint === hash && Object.values(status.tables).every(Boolean)) {
    return { missing: [], installed: false };
  }
  for (const statement of triggerStatements(config)) await db.exec(statement);
  await db.exec(`COMMENT ON FUNCTION cyc_frozen_plans_row() IS ${literal(hash)}`);
  return { missing: [], installed: true };
}

/** Where the staff levels migration (cyc0018) lists the levels, and the rows that name one. */
const STAFF_LEVELS_SEED = "cyc_seed_staff_levels";
const STAFF_LEVEL_ROWS_SEED = "cyc_seed_staff_level_rows";
const STAFF_LEVEL_TABLES = ["plan_staff_levels", "plan_programs", "plan_block_staff", "plan_labor_lines"];

/**
 * Adds the roles and levels the staff levels migration listed, and points each row it listed at its
 * level, once the schema apply has added `staff_level_id`, inside one transaction the caller opens.
 * Frozen plans' rows keep their meaning, so their triggers are off for it. Returns every draft, whose
 * results now name the levels.
 */
async function seedStaffLevels(db) {
  const [{ seed }] = await db.query(`SELECT to_regclass('${STAFF_LEVEL_ROWS_SEED}') IS NOT NULL AS seed`);
  if (!seed) return [];
  const [{ ready }] = await db.query(
    `SELECT count(*) = ${STAFF_LEVEL_TABLES.length + 1} AS ready FROM information_schema.columns
      WHERE table_schema = current_schema() AND ((table_name IN (${STAFF_LEVEL_TABLES.map(literal).join(", ")})
        AND column_name = 'staff_level_id') OR (table_name = 'staff_levels' AND column_name = 'grade'))`,
  );
  if (!ready) return [];
  await db.exec(
    `INSERT INTO staff_roles (id, name, sort)
      SELECT gen_random_uuid(), s.role, min(s.role_sort) FROM ${STAFF_LEVELS_SEED} s
        WHERE NOT EXISTS (SELECT 1 FROM staff_roles r WHERE r.name = s.role) GROUP BY s.role`,
  );
  await db.exec(
    `INSERT INTO staff_levels (id, name, role_id, grade)
      SELECT gen_random_uuid(), s.name, (SELECT r.id FROM staff_roles r WHERE r.name = s.role ORDER BY r.id LIMIT 1), s.grade
        FROM ${STAFF_LEVELS_SEED} s WHERE NOT EXISTS (SELECT 1 FROM staff_levels l WHERE l.name = s.name)`,
  );
  for (const table of STAFF_LEVEL_TABLES) {
    await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await db.exec(
      `UPDATE ${table} t SET staff_level_id = (SELECT l.id FROM staff_levels l WHERE l.name = s.level ORDER BY l.id LIMIT 1)
        FROM ${STAFF_LEVEL_ROWS_SEED} s WHERE s.collection = ${literal(table)} AND s.id = t.id`,
    );
    await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
  await db.exec(`DROP TABLE ${STAFF_LEVEL_ROWS_SEED}, ${STAFF_LEVELS_SEED}`);
  return (await db.query(`SELECT id FROM ${SETS} WHERE status = 'draft'`)).map((row) => row.id);
}

/** Where the payroll taxes migration (cyc0019) lists each plan's taxes. */
const PAYROLL_TAXES_SEED = "cyc_seed_payroll_taxes";

/**
 * Adds the taxes the payroll taxes migration listed, once the schema apply has made
 * `plan_payroll_taxes`, inside one transaction the caller opens. A frozen plan's rows are added
 * too, so its trigger is off for it. Returns every draft, whose results now charge the taxes.
 */
async function seedPayrollTaxes(db) {
  const [{ ready }] = await db.query(
    `SELECT to_regclass('${PAYROLL_TAXES_SEED}') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'plan_payroll_taxes' AND column_name = 'hourly_cents') AS ready`,
  );
  if (!ready) return [];
  await db.exec("ALTER TABLE plan_payroll_taxes DISABLE TRIGGER USER");
  await db.exec(
    `INSERT INTO plan_payroll_taxes (id, plan_id, key, name, wage_share, hourly_cents, sort)
      SELECT gen_random_uuid(), s.plan_id, gen_random_uuid(), s.name, s.wage_share, s.hourly_cents, s.sort
        FROM ${PAYROLL_TAXES_SEED} s JOIN ${PLANS} p ON p.id = s.plan_id`,
  );
  await db.exec("ALTER TABLE plan_payroll_taxes ENABLE TRIGGER USER");
  await db.exec(`DROP TABLE ${PAYROLL_TAXES_SEED}`);
  return (await db.query(`SELECT id FROM ${SETS} WHERE status = 'draft'`)).map((row) => row.id);
}

// The catalog the engine reads as it is now.
const CATALOG = [
  "products",
  "program_areas",
  "accounts",
  "qualifications",
  "qualification_covers",
  "boat_classes",
  "assets",
  "boats",
  "staff_roles",
  "staff_levels",
  "programs",
  "program_boat_classes",
];

/** A `date` as `YYYY-MM-DD`, whether the driver gives a string, or a `Date` at UTC or local midnight. */
function dateString(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0) return value.toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Rows as the engine reads them: decimals as numbers, dates as strings, JSON parsed. */
function engineRows(config, table, rows) {
  const decimals = new Set(config.decimals[table] ?? []);
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => {
        if (value === null) return [field, value];
        if (decimals.has(field)) return [field, Number(value)];
        if (value instanceof Date) return [field, dateString(value)];
        return [field, value];
      }),
    ),
  );
}

/**
 * Everything `computePlan` reads, for `plans`, a Financial Plan's. `set` is the Financial Plan: its
 * organization and year are the calculation's.
 */
async function loadPlan(config, db, set, plans) {
  const read = async (table, query = (q) => q) => engineRows(config, table, await query(db(table).select("*")));
  const data = Object.fromEntries(await Promise.all(CATALOG.map(async (table) => [table, await read(table)])));
  const ids = plans.map((plan) => plan.id);
  for (const table of config.rows) data[table] = await read(table, (q) => q.whereIn("plan_id", ids));
  const [organization] = await read("organizations", (q) => q.where("id", set.organization_id));
  return {
    ...data,
    fiscal_year: set.fiscal_year,
    organization,
    organization_cost_accounts: await read("organization_cost_accounts", (q) =>
      q.where("organization_id", set.organization_id),
    ),
    plans,
  };
}

/**
 * The engine's results for `data`, as rows. Each line and P&L row names `owner`, the plan that
 * holds what it's charged to: an offering's plan, an area's plan for its products and the area,
 * and the Operations Plan for the rest.
 */
function resultRows(data, out, operations) {
  const areaPlan = new Map();
  for (const p of data.plans) if (p.kind === "program_area") areaPlan.set(p.program_area_id, p.id);
  const offerings = new Map(data.plan_offerings.map((o) => [o.key, o]));
  const products = new Map(data.products.map((p) => [p.id, p]));
  const areas = new Map(data.program_areas.map((a) => [a.id, a]));
  const pools = new Map(data.plan_pools.map((p) => [p.key, p]));
  const owners = new Map(data.plan_bonus_owners.map((o) => [o.key, o.plan_id]));
  const terms = new Map((data.plan_terms ?? []).map((t) => [t.key, t]));
  // A frozen plan keeps its terms' names and first days, so its results read without its rows.
  const termOf = (key) => ({
    term_key: key ?? null,
    term_name: terms.get(key)?.name ?? null,
    term_starts_on: terms.get(key)?.starts_on ?? null,
  });
  const ownerOf = (type, key) => {
    if (type === "offering") return offerings.get(key)?.plan_id;
    if (type === "product") return areaPlan.get(products.get(key)?.program_area_id) ?? operations;
    if (type === "program_area" || type === "program_area_term") return areaPlan.get(key) ?? operations;
    return operations;
  };
  const nameOf = (type, key) =>
    ({
      offering: () => offerings.get(key)?.name,
      product: () => products.get(key)?.name,
      program_area: () => areas.get(key)?.name,
      program_area_term: () => areas.get(key)?.name,
      pool: () => pools.get(key)?.name,
    })[type]?.() ?? "Organization";
  const { operating, fundraising } = out.organization;
  return {
    plan_result_lines: out.lines.map((l) => ({
      owner: ownerOf(l.cost_center_type, l.cost_center_key),
      cost_center_type: l.cost_center_type,
      cost_center_key: l.cost_center_key,
      cost_center_name: nameOf(l.cost_center_type, l.cost_center_key),
      account_id: l.account_id,
      function: l.function,
      amount_cents: l.amount_cents,
      line: l.line_key,
      line_name: l.line_name,
      explanation: l.explanation,
    })),
    plan_result_pnl: out.pnl.map((p) => ({
      owner: ownerOf(p.level, p.key),
      level: p.level,
      subject_key: p.key,
      name: nameOf(p.level, p.key),
      revenue_cents: p.revenue_cents,
      expense_cents: p.expense_cents,
      net_cents: p.net_cents,
      mtdc_cents: p.mtdc_cents,
      enrollment: p.enrollment,
      days: p.days,
      sailor_days: p.sailor_days,
      allocation_holds: p.allocation_holds,
      breakeven_enrollment: p.breakeven_enrollment,
      ...termOf(p.term_key),
    })),
    plan_result_positions: out.positions.map((p) => ({
      position_key: p.position_key,
      name: p.name,
      salary_cents: p.salary_cents,
      salaried_coaching_hours: p.salaried_coaching_hours,
      salaried_coaching_cents: p.salaried_coaching_cents,
      hourly_coaching_hours: p.hourly_coaching_hours,
      hourly_coaching_cents: p.hourly_coaching_cents,
      booking_hours: p.booking_hours,
      booking_cents: p.booking_cents,
      bonus_cents: p.bonus_cents,
      total_pay_cents: p.total_pay_cents,
      payroll_tax_cents: p.payroll_tax_cents,
      double_booked_hours: p.double_booked_hours,
      double_booked_dates: p.double_booked_dates,
    })),
    plan_result_bonuses: out.bonuses.map((b) => ({
      owner: owners.get(b.bonus_owner_key),
      name: b.role_name,
      ...termOf(b.term_key),
      bonus_rate: b.bonus_rate,
      net_cents: b.net_cents,
      bonus_cents: b.bonus_cents,
      bonus_owner_key: b.bonus_owner_key,
      program_area_key: b.program_area_id,
    })),
    plan_result_capital: out.capital.map((c) => ({
      rank: c.rank,
      item_key: c.key,
      name: c.name,
      amount_cents: c.amount_cents,
      running_cents: c.running_cents,
      funded: c.funded,
    })),
    plan_result_warnings: out.warnings.map((w) => ({
      owner: w.plan_id ?? null,
      code: w.code,
      message: w.message,
      subject_key: w.key ?? null,
      date: w.date ?? null,
      category: w.category,
      severity: w.severity,
    })),
    totals: {
      calculated_at: new Date().toISOString(),
      operating_revenue_cents: operating.revenue_cents,
      operating_expense_cents: operating.expense_cents,
      operating_net_cents: operating.net_cents,
      fundraising_revenue_cents: fundraising.revenue_cents,
      fundraising_expense_cents: fundraising.expense_cents,
      fundraising_net_cents: fundraising.net_cents,
      capital_cents: out.organization.capital_cents,
      total_cents: out.organization.total_cents,
    },
  };
}

/** Writes one set of results, inside the caller's transaction, with `plan_results` last. */
async function insertResults(trx, { rows, totals }) {
  await trx.raw("SET LOCAL cyc.writing_results = 'on'");
  for (const [table, list] of Object.entries(rows)) {
    for (let i = 0; i < list.length; i += 500) await trx(table).insert(list.slice(i, i + 500));
  }
  await trx(RESULTS).insert(totals);
}

function withoutOwner(fields) {
  const row = { ...fields };
  delete row.owner;
  return row;
}

/**
 * A Financial Plan's results, worked out with the engine from the plans it holds. Each line and P&L
 * row names the plan that holds what it's charged to, and each warning the plan it's about.
 */
async function calculate(config, db, set, engine) {
  const plans = await db(PLANS).where("financial_plan_id", set.id).select("id", "kind", "program_area_id");
  const operations = plans.find((plan) => plan.kind === "operations")?.id;
  const data = await loadPlan(config, db, set, plans);
  const { totals, ...all } = resultRows(data, engine.computePlan(data), operations);
  const row = (fields) => ({ id: crypto.randomUUID(), financial_plan_id: set.id, ...withoutOwner(fields) });
  const owned = (fields) => ({ ...row(fields), plan_id: fields.owner ?? null });
  const rows = {
    plan_result_lines: all.plan_result_lines.map(owned),
    plan_result_pnl: all.plan_result_pnl.map(owned),
    plan_result_positions: all.plan_result_positions.map(row),
    plan_result_bonuses: all.plan_result_bonuses.map(owned),
    plan_result_capital: all.plan_result_capital.map(row),
    plan_result_warnings: all.plan_result_warnings.map(owned),
  };
  return { rows, totals: row({ ...totals, platform_version: config.platformVersion }) };
}

/** Works out a frozen Financial Plan's results and writes them, once. */
async function writeSetResults(config, db, setId, engine) {
  const set = await db(SETS).where("id", setId).first();
  if (!isFrozen(set?.status)) return false;
  if (await db(RESULTS).where("financial_plan_id", setId).first()) return false;
  const results = await calculate(config, db, set, engine);
  await db.transaction((trx) => insertResults(trx, results));
  return true;
}

/**
 * Locks a draft Financial Plan for the rest of `trx`, and clears its results. Returns it, or nothing
 * if it isn't a draft. Locks the row before the save's lock, in the order a save takes them.
 */
async function clearDraft(config, trx, setId) {
  const set = await trx(SETS).where("id", setId).forShare().first();
  if (set?.status !== "draft") return undefined;
  await trx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`cyc_set|${setId}`]);
  await trx.raw("SET LOCAL cyc.writing_results = 'on'");
  for (const table of config.results) await trx(table).where("financial_plan_id", setId).delete();
  return set;
}

/**
 * Works out a draft Financial Plan's results again, in place of the ones it has. If that fails, it
 * clears them, so no stale numbers look current, and throws.
 */
async function writeDraftResults(config, db, setId, engine) {
  try {
    return await db.transaction(async (trx) => {
      const set = await clearDraft(config, trx, setId);
      if (!set) return false;
      await insertResults(trx, await calculate(config, trx, set, engine));
      return true;
    });
  } catch (error) {
    // The failed transaction rolled back, so clearing them takes one of its own.
    await db.transaction((trx) => clearDraft(config, trx, setId)).catch(() => {});
    throw error;
  }
}

/**
 * Works out a draft's results again now, if `mayEdit` it. Answers with an HTTP status: 403 if not,
 * 409 if it isn't a draft, and 200 once they're written.
 */
async function workOutAgain(config, db, setId, engine, mayEdit) {
  if (!(await mayEdit(setId))) return 403;
  return (await writeDraftResults(config, db, setId, engine)) ? 200 : 409;
}

/** What a draft's results are worked out from apart from its plans' rows, so a change to it changes every draft's. */
const INPUTS = [...CATALOG, "organizations", "organization_cost_accounts"];

/** The draft Financial Plans whose results a write to these rows of `collection` changes. */
async function draftsChangedBy(config, db, collection, keys) {
  const drafts = () => db(SETS).where("status", "draft");
  const ids = (rows, field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))];
  if (INPUTS.includes(collection)) return ids(await drafts().select("id"), "id");
  if (keys.length === 0) return [];
  let plans;
  if (collection === PLANS) plans = keys;
  else if (config.rows.includes(collection))
    plans = ids(await db(collection).whereIn("id", keys).select("plan_id"), "plan_id");
  else return [];
  const sets =
    plans.length === 0
      ? []
      : ids(await db(PLANS).whereIn("id", plans).select("financial_plan_id"), "financial_plan_id");
  return sets.length === 0 ? [] : ids(await drafts().whereIn("id", sets).select("id"), "id");
}

/**
 * Runs `run` for each Financial Plan marked, once writes to it have stopped for `delayMs`, or
 * `maxWaitMs` after the first, so many rows changed at once cost one run. Runs one at a time, and
 * one marked again while it runs runs once more.
 */
function draftQueue(run, delayMs, maxWaitMs) {
  const waiting = new Map();
  const ready = new Set();
  let draining;
  const drain = async () => {
    while (ready.size > 0) {
      const [id] = ready;
      ready.delete(id);
      await run(id).catch(() => {});
    }
    draining = undefined;
  };
  const due = (id) => {
    waiting.delete(id);
    ready.add(id);
    draining ??= drain();
  };
  return {
    mark(ids) {
      for (const id of ids) {
        const since = waiting.get(id)?.since ?? Date.now();
        clearTimeout(waiting.get(id)?.timer);
        const wait = Math.max(0, Math.min(delayMs, since + maxWaitMs - Date.now()));
        waiting.set(id, { since, timer: setTimeout(() => due(id), wait) });
      }
    },
  };
}

/**
 * The plans' row tables in an order that copies a row only after every row it links to, such as an
 * offering before its activities.
 */
function copyOrder(config) {
  const order = [];
  const visit = (table, path) => {
    if (order.includes(table)) return;
    if (path.includes(table))
      throw new Error(`frozen-plans: plan rows link in a loop: ${[...path, table].join(" → ")}`);
    for (const linked of Object.values(config.links[table] ?? {}))
      if (linked !== table) visit(linked, [...path, table]);
    order.push(table);
  };
  for (const table of config.rows) visit(table, []);
  return order;
}

/**
 * A row as it reads, ready to write back: JSON as text, since the driver would send an array as a
 * Postgres array, which a `json` column refuses.
 */
function asWritten(row) {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [
      field,
      value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)
        ? JSON.stringify(value)
        : value,
    ]),
  );
}

/**
 * Copies a new Financial Plan's parent into it: a draft copy of each of the parent's plans, with
 * every row, each keeping its `key`, and each link pointing at the copy of the row it linked to.
 * Does nothing if the Financial Plan has no parent, or already has plans.
 */
async function copyParent(config, db, setId) {
  return db.transaction(async (trx) => {
    const set = await trx(SETS).where("id", setId).first();
    if (!set?.parent_id) return false;
    if (await trx(PLANS).where("financial_plan_id", setId).first()) return false;
    const copyOf = new Map();
    for (const source of await trx(PLANS).where("financial_plan_id", set.parent_id).select("*")) {
      const copy = { ...asWritten(source), id: crypto.randomUUID(), financial_plan_id: setId };
      await trx(PLANS).insert(copy);
      copyOf.set(source.id, copy.id);
    }
    const ids = [...copyOf.keys()];
    for (const table of copyOrder(config)) {
      const links = Object.entries(config.links[table] ?? {});
      const rows = ids.length === 0 ? [] : await trx(table).whereIn("plan_id", ids).select("*");
      const self = links.filter(([, linked]) => linked === table);
      const copies = rows.map((row) => {
        const copy = { ...asWritten(row), id: crypto.randomUUID(), plan_id: copyOf.get(row.plan_id) };
        copyOf.set(row.id, copy.id);
        return copy;
      });
      for (const copy of copies) {
        for (const [field, linked] of links) {
          if (copy[field] == null) continue;
          // A link to a row in the same table is set once every copy has its id.
          copy[field] = linked === table ? null : copyOf.get(copy[field]);
        }
      }
      for (let i = 0; i < copies.length; i += 500) await trx(table).insert(copies.slice(i, i + 500));
      for (const [field] of self) {
        for (const row of rows.filter((r) => r[field] != null)) {
          await trx(table)
            .where("id", copyOf.get(row.id))
            .update({ [field]: copyOf.get(row[field]) });
        }
      }
    }
    return true;
  });
}

// Applying a schema emits these once it commits. A changed table may need its trigger again.
const SCHEMA_EVENTS = ["collections", "fields", "relations"].flatMap((scope) =>
  ["create", "update", "delete"].map((event) => `${scope}.${event}`),
);
// Coalesces the burst of events one schema apply emits into one install.
const DEBOUNCE_MS = 1000;
// Coalesces a burst of writes to a draft, such as an agent's over MCP, into one run of the engine.
const DRAFT_DELAY_MS = 1000;
// So a steady stream of writes to a draft still updates its results.
const DRAFT_MAX_WAIT_MS = 10_000;
// How long a write's drafts wait for its action, which never comes if the write fails.
const BEFORE_TTL_MS = 60_000;

function register({ filter, action, init }, { services, env, database, getSchema, logger }) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const bootstrapAdmin = String(env["ADMIN_EMAIL"] ?? "").toLowerCase();
  const watched = new Set([PLANS, SETS, ...config.results, ...config.rows]);

  const connect = (trx) => ({
    query: async (sql) => (await trx.raw(sql)).rows,
    exec: (sql) => trx.raw(sql),
  });
  const install = async () => {
    try {
      const { missing, installed } = await database.transaction((trx) => installTriggers(config, connect(trx)));
      if (missing.length > 0) {
        logger.warn(`frozen-plans: no triggers yet, since these tables lack columns: ${missing.join(", ")}`);
        return;
      }
      if (installed) logger.info(`frozen-plans: installed the triggers on ${triggered(config).length} planning tables`);
    } catch (error) {
      logger.error(error, "frozen-plans: couldn't install the triggers. Writes that skip this hook aren't checked.");
    }
    try {
      const changed = await database.transaction((trx) => seedStaffLevels(connect(trx)));
      if (changed.length > 0) {
        logger.info("frozen-plans: moved the plans' staff levels into the staff levels list");
        // Moved by SQL, which skips Directus's actions.
        drafts.mark(changed);
      }
    } catch (error) {
      logger.error(error, "frozen-plans: couldn't move the plans' staff levels into the staff levels list");
    }
    try {
      const changed = await database.transaction((trx) => seedPayrollTaxes(connect(trx)));
      if (changed.length > 0) {
        logger.info("frozen-plans: added each plan's payroll taxes");
        drafts.mark(changed);
      }
    } catch (error) {
      logger.error(error, "frozen-plans: couldn't add the plans' payroll taxes");
    }
  };
  let pending;
  const reinstall = () => {
    clearTimeout(pending);
    pending = setTimeout(install, DEBOUNCE_MS);
  };
  for (const event of SCHEMA_EVENTS) action(event, reinstall);

  filter("database.error", (error) => databaseError(error));

  // The engine, bundled beside this file by `backend` (./engine-files.ts).
  let engine;
  const loadEngine = async () =>
    (engine ??= await import(url.pathToFileURL(path.join(__dirname, "planning-index.mjs")).href));
  const results = async (id) => {
    try {
      return await writeSetResults(config, database, id, await loadEngine());
    } catch (error) {
      logger.error(error, `frozen-plans: couldn't write the results of ${id}`);
      throw error;
    }
  };
  const drafts = draftQueue(
    async (id) => {
      try {
        await writeDraftResults(config, database, id, await loadEngine());
      } catch (error) {
        logger.error(error, `frozen-plans: couldn't work out the draft results of ${id}`);
      }
    },
    DRAFT_DELAY_MS,
    DRAFT_MAX_WAIT_MS,
  );
  init("app.after", async () => {
    await install();
    // Fills in the results of drafts that have none, such as those from before drafts had any.
    try {
      const missing = await database(SETS)
        .where("status", "draft")
        .whereNotExists(database(RESULTS).select(1).whereRaw(`${RESULTS}.financial_plan_id = ${SETS}.id`))
        .select("id");
      drafts.mark(missing.map((set) => set.id));
    } catch (error) {
      logger.error(error, "frozen-plans: couldn't list the drafts to work out their results");
    }
  });
  const changed = async (collection, keys) => {
    try {
      drafts.mark(await draftsChangedBy(config, database, collection, keys));
    } catch (error) {
      logger.error(error, `frozen-plans: couldn't tell which drafts a change to ${collection} changes`);
    }
  };
  const copy = async (id) => {
    try {
      return await copyParent(config, database, id);
    } catch (error) {
      logger.error(error, `frozen-plans: couldn't copy the parent of ${id}`);
      throw error;
    }
  };
  // Directus checks access, and commits the write, before its actions run.
  action("items.update", async ({ collection, keys, payload }) => {
    if (collection !== SETS || payload?.status !== "frozen") return;
    for (const key of keys ?? []) await results(key).catch(() => {});
  });
  action("items.create", async ({ collection, key }) => {
    if (collection === SETS) {
      await copy(key).catch(() => {});
      drafts.mark([key]);
    } else await changed(collection, [key]);
  });
  action("items.update", ({ collection, keys }) => changed(collection, keys ?? []));
  // A deleted row can't be traced to the draft it was in once the write commits, so the write's
  // filter finds it first, for its action.
  const before = new Map();
  filter("items.delete", async (keys, { collection }, { database }) => {
    const found = await draftsChangedBy(config, database, collection, keys).catch(() => []);
    if (found.length > 0) {
      const id = `${collection}|${JSON.stringify(keys)}`;
      before.set(id, found);
      setTimeout(() => before.delete(id), BEFORE_TTL_MS).unref?.();
    }
    return keys;
  });
  action("items.delete", ({ collection, keys }) => {
    const id = `${collection}|${JSON.stringify(keys)}`;
    drafts.mark(before.get(id) ?? []);
    before.delete(id);
  });

  // The deploy asks this whether every trigger is in place (`FrozenPlansCheck`). It answers with
  // names and yes or no, never data.
  init("routes.custom.before", ({ app }) => {
    const adminOnly = (handler) => async (req, res) => {
      if (req.accountability?.admin !== true) {
        res.status(403).json({ errors: [{ message: "Only an admin can do this." }] });
        return;
      }
      await handler(req, res);
    };
    // The engine this Directus works numbers out with, so an app can tell a draft's results are older.
    app.get("/frozen-plans/engine", (req, res) => {
      if (!req.accountability?.user) {
        res.status(401).json({ errors: [{ message: "Sign in to do this." }] });
        return;
      }
      res.json({ platform_version: config.platformVersion });
    });
    // Works out a draft's results again now, for anyone who may edit it, such as after a new engine.
    app.post("/frozen-plans/drafts/:id/results", async (req, res) => {
      const id = req.params.id;
      try {
        const permissions = new services.PermissionsService({
          accountability: req.accountability,
          schema: req.schema ?? (await getSchema()),
          knex: database,
        });
        const mayEdit = async (setId) =>
          (await permissions.getItemPermissions(SETS, setId).catch(() => undefined))?.update.access === true;
        const status = await workOutAgain(config, database, id, await loadEngine(), mayEdit);
        if (status === 200) res.json({ written: true });
        else res.status(status).json({ errors: [{ message: status === 403 ? NOT_EDITOR : NOT_DRAFT }] });
      } catch (error) {
        logger.error(error, `frozen-plans: couldn't work out the draft results of ${id}`);
        res.status(500).json({ errors: [{ message: "Couldn't work out the draft's results." }] });
      }
    });
    // Fills in a frozen Financial Plan's results, if writing them failed when it was frozen.
    app.post(
      "/frozen-plans/results/:id",
      adminOnly(async (req, res) => {
        try {
          res.json({ written: await results(req.params.id) });
        } catch {
          res.status(500).json({ errors: [{ message: "Couldn't work out the frozen results." }] });
        }
      }),
    );
    // Copies a new Financial Plan's parent into it, if that failed when it was added.
    app.post(
      "/frozen-plans/copy/:id",
      adminOnly(async (req, res) => {
        try {
          res.json({ copied: await copy(req.params.id) });
        } catch {
          res.status(500).json({ errors: [{ message: "Couldn't copy the Financial Plan's parent." }] });
        }
      }),
    );
    app.get(
      "/frozen-plans/status",
      adminOnly(async (_req, res) => {
        try {
          res.json(await database.transaction((trx) => triggerStatus(config, connect(trx))));
        } catch (error) {
          logger.error(error, "frozen-plans: couldn't read the triggers");
          res.status(500).json({ errors: [{ message: "Couldn't read the frozen-plans triggers." }] });
        }
      }),
    );
  });

  const lookupIn = (database) => ({
    planIds: async (collection, keys) =>
      keys.length === 0
        ? []
        : (await database(collection).select("plan_id").whereIn("id", keys)).map((row) => row.plan_id),
    plans: async (ids) =>
      ids.length === 0
        ? []
        : database(PLANS).select("id", "financial_plan_id", "kind", "program_area_id").whereIn("id", ids),
    sets: async (ids) =>
      ids.length === 0 ? [] : database(SETS).select("id", "status", "archived_at").whereIn("id", ids),
    // Only so the tests can clean up after themselves (`backend:frozenPlansDeletable`).
    deletesFrozen: async (user) => {
      if (!config.deletable || !user || !bootstrapAdmin) return false;
      const found = await database("directus_users").select("email").where("id", user).first();
      return (found?.email ?? "").toLowerCase() === bootstrapAdmin;
    },
  });

  for (const event of ["create", "update", "delete"]) {
    filter(`items.${event}`, async (payload, meta, { database, accountability }) => {
      if (!watched.has(meta.collection)) return payload;
      const keys = event === "delete" ? payload : (meta.keys ?? []);
      return guard(
        {
          collection: meta.collection,
          event,
          payload,
          keys,
          user: accountability?.user,
          now: new Date().toISOString(),
        },
        config,
        lookupIn(database),
      );
    });
  }
}

module.exports = register;
module.exports.guard = guard;
module.exports.databaseError = databaseError;
module.exports.installTriggers = installTriggers;
module.exports.seedStaffLevels = seedStaffLevels;
module.exports.seedPayrollTaxes = seedPayrollTaxes;
module.exports.triggerStatus = triggerStatus;
module.exports.fingerprint = fingerprint;
module.exports.triggerStatements = triggerStatements;
module.exports.writeSetResults = writeSetResults;
module.exports.writeDraftResults = writeDraftResults;
module.exports.workOutAgain = workOutAgain;
module.exports.draftsChangedBy = draftsChangedBy;
module.exports.draftQueue = draftQueue;
module.exports.copyParent = copyParent;
module.exports.copyOrder = copyOrder;
module.exports.REFUSED = REFUSED;
module.exports.RESULTS_BY_HOOK = RESULTS_BY_HOOK;
module.exports.SET_STAYS = SET_STAYS;
module.exports.PLANS_FIXED = PLANS_FIXED;
module.exports.PLAN_STAYS = PLAN_STAYS;
module.exports.NEEDS_OPERATIONS = NEEDS_OPERATIONS;
module.exports.ONE_PER_AREA = ONE_PER_AREA;
module.exports.ONE_PER_DATE = ONE_PER_DATE;
module.exports.IN_FORCE_NOT_ARCHIVED = IN_FORCE_NOT_ARCHIVED;
module.exports.ARCHIVED_NOT_ACTIVE = ARCHIVED_NOT_ACTIVE;
module.exports.ACTIVE_STAYS = ACTIVE_STAYS;
module.exports.BONUS_IN_OPERATIONS = BONUS_IN_OPERATIONS;
module.exports.SHORT_NOTES = SHORT_NOTES;
