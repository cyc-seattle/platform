// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a saved plan version from changing, for every user, admins included (docs/planning-schema.md).
// Its filters refuse such a request with a clear 403, and stamp who saved a version and who made one
// active. Directus skips filters on some paths, such as a flow's data steps, so the database
// triggers it installs refuse the same writes on every path.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const crypto = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const url = require("node:url");

const PLANS = "plans";
const VERSIONS = "plan_versions";
const ACTIVATIONS = "plan_activations";
// Written last when a version's results go in, so a version that has one has them all.
const RESULTS = "plan_results";
// Club plans, saved when they're added, and the versions the database fills each one with.
const SETS = "version_sets";
const MEMBERS = "version_set_members";

const REFUSED = "A saved plan version can't be changed. Make a new draft from it.";
const NEW_DRAFT = "A new plan version starts as a draft.";
const NEEDS_PLATFORM = "Saving a version needs the @cyc-seattle/platform version that calculated it.";
const NEEDS_OPERATIONS =
  "Saving a program area's plan needs the saved Operations Plan version it was calculated with, for the same organization and year.";
const OPERATIONS_NAMES_NONE = "An Operations Plan's version doesn't name an Operations Plan version.";
const VERSION_STAYS = "A plan version can't move to another plan.";
const ROW_STAYS = "A plan row can't move to another version. Copy it into that version instead.";
const SAME_VERSION = "A plan row can only link to rows in its own version.";
const PLAN_FIXED = "A plan's kind, program area, organization, and year can't change once it has a saved version.";
const ACTIVATION_STAYS = "An activation stays in the plan's history. Make another saved version active instead.";
const ONLY_SAVED_ACTIVE = "Only a saved version can be made active.";
const OWN_PLAN = "A version can only be made active for its own plan.";
const AREA_NAMED = "A program area's plan names its program area, and an Operations Plan names none.";
const RESULTS_BY_SAVE = "A version's results are worked out when it's saved, and can't be written by hand.";
const SET_STAYS = "A club plan can't be changed or deleted. Save another one instead.";
const MEMBERS_BY_SAVE = "A club plan holds the versions active when it's saved, and they can't be written by hand.";
const NEEDS_ACTIVE_OPERATIONS = "A club plan needs an active Operations Plan version for its organization and year.";
const NEEDS_ACTIVE_AREAS =
  "A club plan needs an active version for every program area with a plan for its organization and year.";

/** Each reason a trigger gives, which the hook answers with its status. */
const REASONS = {
  [REFUSED]: 403,
  [PLAN_FIXED]: 403,
  [ACTIVATION_STAYS]: 403,
  [NEW_DRAFT]: 400,
  [NEEDS_PLATFORM]: 400,
  [NEEDS_OPERATIONS]: 400,
  [OPERATIONS_NAMES_NONE]: 400,
  [VERSION_STAYS]: 400,
  [ROW_STAYS]: 400,
  [SAME_VERSION]: 400,
  [ONLY_SAVED_ACTIVE]: 400,
  [OWN_PLAN]: 400,
  [AREA_NAMED]: 400,
  [RESULTS_BY_SAVE]: 403,
  [SET_STAYS]: 403,
  [MEMBERS_BY_SAVE]: 403,
  [NEEDS_ACTIVE_OPERATIONS]: 400,
  [NEEDS_ACTIVE_AREAS]: 400,
};
/** The SQLSTATE every trigger raises, so the hook can tell its refusals from other errors. */
const SQLSTATE = "CY001";

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

/**
 * Checks one write, and returns the payload to write. `event` is `create`, `update`, or `delete`;
 * `keys` are the rows an update or delete touches. `lookup` reads the database:
 * - `versionIds(collection, keys)`: the `version_id` of each row
 * - `plans(ids)`: each plan's `id`, `kind`, and `program_area_id`
 * - `versions(ids)`: each version's `id`, `plan_id`, `status`, and `platform_version`
 * - `deletesSaved(user)`: whether this user may delete a saved version, which only dev allows
 */
async function guard({ collection, event, payload, keys = [], user, now }, config, lookup) {
  const saved = async (ids) =>
    ids.length > 0 && (await lookup.versions(ids)).some((version) => version.status === "saved");

  if (collection === PLANS) {
    if (event === "delete" || (event === "update" && !("kind" in payload) && !("program_area_id" in payload))) {
      return payload;
    }
    const current = event === "create" ? [{}] : await lookup.plans(keys);
    for (const plan of current) {
      const kind = "kind" in payload ? payload.kind : plan.kind;
      const area = keyOf("program_area_id" in payload ? payload.program_area_id : plan.program_area_id) ?? null;
      if ((kind === "program_area") !== (area !== null)) throw refuse(AREA_NAMED, 400);
    }
    return payload;
  }

  if (collection === VERSIONS) {
    if (event === "create") {
      if ((payload.status ?? "draft") !== "draft") throw refuse(NEW_DRAFT);
      return payload;
    }
    if (event === "delete") {
      if ((await saved(keys)) && !(await lookup.deletesSaved(user))) throw refuse(REFUSED);
      return payload;
    }
    if (await saved(keys)) throw refuse(REFUSED);
    // Only the hook stamps who saved a version, and when.
    const rest = { ...payload };
    delete rest.saved_by;
    delete rest.saved_at;
    if (rest.status !== "saved") return rest;
    // The hook works out a saved version's results, so it records its own engine's version.
    return { ...rest, platform_version: config.platformVersion, saved_by: user ?? null, saved_at: now };
  }

  if (collection === ACTIVATIONS) {
    if (event === "update") throw refuse(ACTIVATION_STAYS);
    if (event === "delete") {
      if (!(await lookup.deletesSaved(user))) throw refuse(ACTIVATION_STAYS);
      return payload;
    }
    const [version] = await lookup.versions([keyOf(payload.version_id)].filter(Boolean));
    if (version?.status !== "saved") throw refuse(ONLY_SAVED_ACTIVE, 400);
    if (payload.plan_id !== undefined && keyOf(payload.plan_id) !== version.plan_id) {
      throw refuse(OWN_PLAN, 400);
    }
    // The trigger sets `activated_at` again, and `sequence`.
    return { ...payload, plan_id: version.plan_id, activated_by: user ?? null, activated_at: now };
  }

  if (collection === SETS) {
    if (event === "create") {
      // The hook works out a club plan's results, so it records its own engine's version.
      return { ...payload, platform_version: config.platformVersion, saved_by: user ?? null, saved_at: now };
    }
    if (event === "delete" && (await lookup.deletesSaved(user))) return payload;
    throw refuse(SET_STAYS);
  }
  if (collection === MEMBERS) {
    if (event === "delete" && (await lookup.deletesSaved(user))) return payload;
    throw refuse(MEMBERS_BY_SAVE);
  }

  if (!config.versioned.includes(collection)) return payload;
  if (config.results.includes(collection)) {
    if (event === "delete" && (await lookup.deletesSaved(user))) return payload;
    throw refuse(RESULTS_BY_SAVE);
  }
  const ids = event === "create" ? [] : await lookup.versionIds(collection, keys);
  if (event !== "delete" && payload.version_id !== undefined) ids.push(keyOf(payload.version_id));
  const touched = [...new Set(ids.filter(Boolean))];
  if (await saved(touched)) {
    if (event !== "delete" || !(await lookup.deletesSaved(user))) throw refuse(REFUSED);
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
    [PLANS]: ["id", "kind", "program_area_id", "organization_id", "fiscal_year", "archived"],
    [VERSIONS]: ["id", "plan_id", "status", "platform_version", "operations_version_id", "saved_at"],
    [ACTIVATIONS]: ["id", "plan_id", "version_id", "sequence", "activated_at"],
    [SETS]: ["id", "organization_id", "fiscal_year", "platform_version", "saved_at"],
    [MEMBERS]: ["id", "version_set_id", "plan_id", "version_id"],
    ...Object.fromEntries(
      config.versioned.map((table) => [
        table,
        [
          "id",
          "version_id",
          ...(config.setResults.includes(table) ? ["version_set_id"] : []),
          ...Object.keys(config.links[table] ?? {}),
        ],
      ]),
    ),
  };
}

/**
 * own functions and triggers, on the planning tables, and drops the unique indexes plans once had. Each trigger locks the row it
 * own functions, triggers, and indexes, on the planning tables. Each trigger locks the row it
 * checks, so a version can't be saved, or a plan changed, while a write that read it is still open.
 */
function triggerStatements(config) {
  const deletable = config.deletable ? "true" : "false";
  const row = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_row() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  version_status text;
  linked_id uuid;
  linked_version uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    ${raise(ROW_STAYS)};
  END IF;
  SELECT v.status INTO version_status FROM ${VERSIONS} v
    WHERE v.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.version_id ELSE OLD.version_id END
    FOR SHARE;
  IF version_status = 'saved' AND NOT (TG_OP = 'DELETE' AND ${deletable}) THEN
    ${raise(REFUSED)};
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  -- The trigger's arguments are pairs: a field, then the table it links to.
  FOR i IN 0 .. TG_NARGS - 1 BY 2 LOOP
    linked_id := (to_jsonb(NEW) ->> TG_ARGV[i])::uuid;
    IF linked_id IS NOT NULL THEN
      EXECUTE format('SELECT version_id FROM %I WHERE id = $1', TG_ARGV[i + 1]) INTO linked_version USING linked_id;
      -- A row that doesn't exist is the foreign key's to refuse.
      IF linked_version IS NOT NULL AND linked_version <> NEW.version_id THEN
        ${raise(SAME_VERSION)};
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$fn$`;

  // A saved version's results go in once, from the hook (writeResults), and never change.
  const result = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_result() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  version_status text;
  set_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT ${deletable} THEN
      ${raise(RESULTS_BY_SAVE)};
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR current_setting('cyc.writing_results', true) IS DISTINCT FROM 'on' THEN
    ${raise(RESULTS_BY_SAVE)};
  END IF;
  -- A club plan's results have its version_set_id and no version_id; a version's, the reverse.
  set_id := (to_jsonb(NEW) ->> 'version_set_id')::uuid;
  IF set_id IS NOT NULL THEN
    PERFORM 1 FROM ${SETS} s WHERE s.id = set_id FOR SHARE;
    IF NOT FOUND OR NEW.version_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM ${RESULTS} r WHERE r.version_set_id = set_id) THEN
      ${raise(RESULTS_BY_SAVE)};
    END IF;
    RETURN NEW;
  END IF;
  SELECT v.status INTO version_status FROM ${VERSIONS} v WHERE v.id = NEW.version_id FOR SHARE;
  IF version_status IS DISTINCT FROM 'saved'
    OR EXISTS (SELECT 1 FROM ${RESULTS} r WHERE r.version_id = NEW.version_id) THEN
    ${raise(RESULTS_BY_SAVE)};
  END IF;
  RETURN NEW;
END
$fn$`;

  const version = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  plan record;
  operations record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'saved' AND NOT ${deletable} THEN
      ${raise(REFUSED)};
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      ${raise(NEW_DRAFT)};
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'saved' THEN
    ${raise(REFUSED)};
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    ${raise(VERSION_STAYS)};
  END IF;
  IF NEW.status = 'saved' THEN
    IF coalesce(btrim(NEW.platform_version), '') = '' THEN
      ${raise(NEEDS_PLATFORM)};
    END IF;
    SELECT p.kind, p.organization_id, p.fiscal_year INTO plan FROM ${PLANS} p WHERE p.id = NEW.plan_id FOR SHARE;
    IF plan.kind = 'operations' THEN
      IF NEW.operations_version_id IS NOT NULL THEN
        ${raise(OPERATIONS_NAMES_NONE)};
      END IF;
    ELSE
      SELECT v.status, p.kind, p.organization_id, p.fiscal_year INTO operations
        FROM ${VERSIONS} v JOIN ${PLANS} p ON p.id = v.plan_id
        WHERE v.id = NEW.operations_version_id;
      IF NOT FOUND OR operations.status <> 'saved' OR operations.kind <> 'operations'
        OR operations.organization_id IS DISTINCT FROM plan.organization_id
        OR operations.fiscal_year IS DISTINCT FROM plan.fiscal_year THEN
        ${raise(NEEDS_OPERATIONS)};
      END IF;
    END IF;
    NEW.saved_at := now();
  END IF;
  RETURN NEW;
END
$fn$`;

  const plan = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_plan() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (NEW.kind = 'program_area') IS DISTINCT FROM (NEW.program_area_id IS NOT NULL) THEN
    ${raise(AREA_NAMED)};
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF (NEW.kind, NEW.program_area_id, NEW.organization_id, NEW.fiscal_year)
      IS DISTINCT FROM (OLD.kind, OLD.program_area_id, OLD.organization_id, OLD.fiscal_year)
    AND EXISTS (SELECT 1 FROM ${VERSIONS} v WHERE v.plan_id = OLD.id AND v.status = 'saved') THEN
    ${raise(PLAN_FIXED)};
  END IF;
  RETURN NEW;
END
$fn$`;

  const activation = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_activation() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  version record;
  plan record;
BEGIN
  IF TG_OP = 'UPDATE' OR (TG_OP = 'DELETE' AND NOT ${deletable}) THEN
    ${raise(ACTIVATION_STAYS)};
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  SELECT v.plan_id, v.status INTO version FROM ${VERSIONS} v WHERE v.id = NEW.version_id;
  IF NOT FOUND OR version.status <> 'saved' THEN
    ${raise(ONLY_SAVED_ACTIVE)};
  END IF;
  IF NEW.plan_id IS NOT NULL AND NEW.plan_id <> version.plan_id THEN
    ${raise(OWN_PLAN)};
  END IF;
  NEW.plan_id := version.plan_id;
  -- Activations are ordered across every plan for the same area, organization, and year, or the
  -- organization's Operations Plans for the year, so the newest is the one active. One at a time,
  -- so no two take the same place.
  SELECT p.kind, p.organization_id, p.fiscal_year, p.program_area_id INTO plan FROM ${PLANS} p WHERE p.id = NEW.plan_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws('|', 'cyc_activation', plan.kind, plan.organization_id, plan.fiscal_year, plan.program_area_id), 0));
  SELECT coalesce(max(a.sequence), 0) + 1 INTO NEW.sequence
    FROM ${ACTIVATIONS} a JOIN ${PLANS} p ON p.id = a.plan_id
    WHERE p.kind = plan.kind AND p.organization_id = plan.organization_id AND p.fiscal_year = plan.fiscal_year
      AND p.program_area_id IS NOT DISTINCT FROM plan.program_area_id;
  NEW.activated_at := now();
  RETURN NEW;
END
$fn$`;

  // A club plan is saved when it's added: it takes the year's active versions, and needs one for the
  // Operations Plan and for every program area with a plan that isn't archived.
  const activeVersions = (set) => `
    SELECT DISTINCT ON (p.kind, p.program_area_id) p.kind, p.program_area_id, a.plan_id, a.version_id
      FROM ${ACTIVATIONS} a JOIN ${PLANS} p ON p.id = a.plan_id
      WHERE p.organization_id = ${set}.organization_id AND p.fiscal_year = ${set}.fiscal_year
        AND p.archived IS NOT TRUE
      ORDER BY p.kind, p.program_area_id, a.sequence DESC`;
  const clubPlan = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_set() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  missing text;
BEGIN
  IF TG_OP = 'UPDATE' OR (TG_OP = 'DELETE' AND NOT ${deletable}) THEN
    ${raise(SET_STAYS)};
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF coalesce(btrim(NEW.platform_version), '') = '' THEN
    ${raise(NEEDS_PLATFORM)};
  END IF;
  IF NOT EXISTS (SELECT 1 FROM (${activeVersions("NEW")}) active WHERE active.kind = 'operations') THEN
    ${raise(NEEDS_ACTIVE_OPERATIONS)};
  END IF;
  SELECT string_agg(DISTINCT area.name, ', ' ORDER BY area.name) INTO missing
    FROM ${PLANS} p JOIN program_areas area ON area.id = p.program_area_id
    WHERE p.kind = 'program_area' AND p.organization_id = NEW.organization_id AND p.fiscal_year = NEW.fiscal_year
      AND p.archived IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM (${activeVersions("NEW")}) active WHERE active.program_area_id = p.program_area_id);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '${SQLSTATE}', MESSAGE = ${literal(NEEDS_ACTIVE_AREAS)},
      DETAIL = format('These have none: %s.', missing);
  END IF;
  NEW.saved_at := now();
  RETURN NEW;
END
$fn$`;
  const clubPlanMembers = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_set_members() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('cyc.writing_members', 'on', true);
  INSERT INTO ${MEMBERS} (id, version_set_id, plan_id, version_id)
    SELECT gen_random_uuid(), NEW.id, active.plan_id, active.version_id FROM (${activeVersions("NEW")}) active;
  PERFORM set_config('cyc.writing_members', 'off', true);
  RETURN NULL;
END
$fn$`;
  const member = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_member() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND ${deletable} THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' OR current_setting('cyc.writing_members', true) IS DISTINCT FROM 'on' THEN
    ${raise(MEMBERS_BY_SAVE)};
  END IF;
  RETURN NEW;
END
$fn$`;

  const trigger = (table, fn, events, args = []) => [
    `DROP TRIGGER IF EXISTS cyc_saved_versions ON ${table}`,
    `CREATE TRIGGER cyc_saved_versions BEFORE ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}(${args
      .map(literal)
      .join(", ")})`,
  ];
  const all = "INSERT OR UPDATE OR DELETE";
  return [
    // A program area may have several plans for a year, and an organization several Operations Plans.
    "DROP INDEX IF EXISTS cyc_one_product_plan",
    "DROP INDEX IF EXISTS cyc_one_program_area_plan",
    "DROP INDEX IF EXISTS cyc_one_operations_plan",
    row,
    result,
    version,
    plan,
    activation,
    clubPlan,
    clubPlanMembers,
    member,
    ...trigger(PLANS, "cyc_saved_versions_plan", "INSERT OR UPDATE"),
    ...trigger(VERSIONS, "cyc_saved_versions_version", all),
    ...trigger(ACTIVATIONS, "cyc_saved_versions_activation", all),
    ...trigger(SETS, "cyc_saved_versions_set", all),
    `DROP TRIGGER IF EXISTS cyc_saved_versions_members ON ${SETS}`,
    `CREATE TRIGGER cyc_saved_versions_members AFTER INSERT ON ${SETS} FOR EACH ROW EXECUTE FUNCTION cyc_saved_versions_set_members()`,
    ...trigger(MEMBERS, "cyc_saved_versions_member", all),
    ...config.versioned.flatMap((table) =>
      config.results.includes(table)
        ? trigger(table, "cyc_saved_versions_result", all)
        : trigger(table, "cyc_saved_versions_row", all, Object.entries(config.links[table] ?? {}).flat()),
    ),
  ];
}

/** The tables that get a trigger. */
const triggered = (config) => [PLANS, VERSIONS, ACTIVATIONS, SETS, MEMBERS, ...config.versioned];

/** A hash of the triggers `config` installs, which the install records on a function it makes. */
function fingerprint(config) {
  return crypto.createHash("sha256").update(triggerStatements(config).join(";\n")).digest("hex");
}

/** Which tables have their trigger, and the installed triggers' fingerprint. */
async function triggerStatus(config, db) {
  const tables = triggered(config);
  const [{ fingerprint: installed }] = await db.query(
    "SELECT obj_description(to_regproc('cyc_saved_versions_row'), 'pg_proc') AS fingerprint",
  );
  const triggers = new Set(
    (
      await db.query(
        `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname = 'cyc_saved_versions' AND c.relnamespace = current_schema()::regnamespace`,
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
  await db.exec("SELECT pg_advisory_xact_lock(hashtext('cyc_saved_versions'))");
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
  await db.exec(`COMMENT ON FUNCTION cyc_saved_versions_row() IS ${literal(hash)}`);
  return { missing: [], installed: true };
}

// The catalog the engine reads as it is now.
const CATALOG = [
  "products",
  "program_areas",
  "accounts",
  "qualifications",
  "qualification_covers",
  "boat_classes",
  "resource_kinds",
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
 * The saved versions the engine calculates `version` with: the club's plan as it stands. That's its
 * Operations Plan version, or itself, and each program area's active version, with its own in place
 * of its area's.
 */
async function versionSet(db, version) {
  const plan = await db(PLANS).where("id", version.plan_id).first();
  const operations = plan.kind === "operations" ? version.id : version.operations_version_id;
  const active = await db(ACTIVATIONS)
    .join(`${PLANS} as p`, "p.id", `${ACTIVATIONS}.plan_id`)
    .where({ "p.organization_id": plan.organization_id, "p.fiscal_year": plan.fiscal_year, "p.kind": "program_area" })
    .distinctOn("p.program_area_id")
    .orderBy([{ column: "p.program_area_id" }, { column: `${ACTIVATIONS}.sequence`, order: "desc" }])
    .select("p.program_area_id", `${ACTIVATIONS}.version_id`);
  const areas = active.filter((a) => plan.kind === "operations" || a.program_area_id !== plan.program_area_id);
  const ids = [operations, ...areas.map((a) => a.version_id)];
  if (plan.kind === "program_area") ids.push(version.id);
  return { plan, operations, ids: [...new Set(ids)] };
}

/**
 * Everything `computePlan` reads, for the versions in `ids`. `plan` is a plan or a club plan: its
 * organization and year are the calculation's.
 */
async function loadPlan(config, db, plan, operations, ids) {
  const read = async (table, query = (q) => q) => engineRows(config, table, await query(db(table).select("*")));
  const data = Object.fromEntries(await Promise.all(CATALOG.map(async (table) => [table, await read(table)])));
  const inputs = config.versioned.filter((table) => !config.results.includes(table));
  for (const table of inputs) data[table] = await read(table, (q) => q.whereIn("version_id", ids));
  const versions = await db(VERSIONS).whereIn("id", ids).select("id", "plan_id", "operations_version_id");
  const plans = await db(PLANS)
    .whereIn(
      "id",
      versions.map((v) => v.plan_id),
    )
    .select("id", "kind", "program_area_id");
  const [organization] = await read("organizations", (q) => q.where("id", plan.organization_id));
  const rates = data.plan_rates.find((r) => r.version_id === operations);
  return {
    ...data,
    fiscal_year: plan.fiscal_year,
    organization,
    organization_cost_accounts: await read("organization_cost_accounts", (q) =>
      q.where("organization_id", plan.organization_id),
    ),
    rib_resource_kind_id: rates?.rib_resource_kind_id ?? null,
    plans,
    plan_versions: versions,
  };
}

/**
 * The engine's results for `data`, as rows. Each line and P&L row names `owner`, the version that
 * holds what it's charged to: an offering's version, an area's plan for its products and the area,
 * and the Operations Plan for the rest.
 */
function resultRows(data, out, operations) {
  const planOf = new Map(data.plan_versions.map((v) => [v.id, data.plans.find((p) => p.id === v.plan_id)]));
  const areaVersion = new Map();
  for (const [id, p] of planOf) if (p?.kind === "program_area") areaVersion.set(p.program_area_id, id);
  const offerings = new Map(data.plan_offerings.map((o) => [o.key, o]));
  const products = new Map(data.products.map((p) => [p.id, p]));
  const areas = new Map(data.program_areas.map((a) => [a.id, a]));
  const pools = new Map(data.plan_pools.map((p) => [p.key, p]));
  const ownerOf = (type, key) => {
    if (type === "offering") return offerings.get(key)?.version_id;
    if (type === "product") return areaVersion.get(products.get(key)?.program_area_id) ?? operations;
    if (type === "program_area") return areaVersion.get(key) ?? operations;
    return operations;
  };
  const nameOf = (type, key) =>
    ({
      offering: () => offerings.get(key)?.name,
      product: () => products.get(key)?.name,
      program_area: () => areas.get(key)?.name,
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
    plan_result_warnings: out.warnings.map((w) => ({ code: w.code, message: w.message, subject_key: w.key ?? null })),
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

/** Writes one set of results, all or nothing, with `plan_results` last. */
async function insertResults(db, rows, totals) {
  await db.transaction(async (trx) => {
    await trx.raw("SET LOCAL cyc.writing_results = 'on'");
    for (const [table, list] of Object.entries(rows)) {
      for (let i = 0; i < list.length; i += 500) await trx(table).insert(list.slice(i, i + 500));
    }
    await trx(RESULTS).insert(totals);
  });
}

function withoutOwner(fields) {
  const row = { ...fields };
  delete row.owner;
  return row;
}

/**
 * Works out a saved version's results with the engine, and writes them, once. Its lines and P&L
 * are those it holds; the totals, positions and warnings are the whole calculation's.
 */
async function writeResults(config, db, versionId, engine) {
  const version = await db(VERSIONS).where("id", versionId).first();
  if (version?.status !== "saved") return false;
  if (await db(RESULTS).where("version_id", versionId).first()) return false;
  const { plan, operations, ids } = await versionSet(db, version);
  const data = await loadPlan(config, db, plan, operations, ids);
  const { totals, ...all } = resultRows(data, engine.computePlan(data), operations);
  const row = (fields) => ({ id: crypto.randomUUID(), version_id: versionId, ...withoutOwner(fields) });
  const rows = {
    plan_result_versions: ids.filter((id) => id !== versionId).map((id) => row({ calculated_with_id: id })),
    plan_result_lines: all.plan_result_lines.filter((l) => l.owner === versionId).map(row),
    plan_result_pnl: all.plan_result_pnl.filter((p) => p.owner === versionId).map(row),
    plan_result_positions: all.plan_result_positions.map(row),
    plan_result_warnings: all.plan_result_warnings.map(row),
  };
  await insertResults(db, rows, row(totals));
  return true;
}

/**
 * Works out a club plan's results with the engine, from the versions it holds, and writes them,
 * once. Each line and P&L row names the member that holds what it's charged to.
 */
async function writeSetResults(config, db, setId, engine) {
  const set = await db(SETS).where("id", setId).first();
  if (set === undefined) return false;
  if (await db(RESULTS).where("version_set_id", setId).first()) return false;
  const members = await db(MEMBERS)
    .join(`${PLANS} as p`, "p.id", `${MEMBERS}.plan_id`)
    .where(`${MEMBERS}.version_set_id`, setId)
    .select(`${MEMBERS}.id`, `${MEMBERS}.version_id`, "p.kind");
  const operations = members.find((m) => m.kind === "operations")?.version_id;
  const data = await loadPlan(
    config,
    db,
    set,
    operations,
    members.map((m) => m.version_id),
  );
  const { totals, ...all } = resultRows(data, engine.computePlan(data), operations);
  const memberOf = new Map(members.map((m) => [m.version_id, m.id]));
  const row = (fields) => ({ id: crypto.randomUUID(), version_set_id: setId, ...withoutOwner(fields) });
  const owned = (fields) => ({ ...row(fields), version_set_member_id: memberOf.get(fields.owner) ?? null });
  const rows = {
    plan_result_lines: all.plan_result_lines.map(owned),
    plan_result_pnl: all.plan_result_pnl.map(owned),
    plan_result_positions: all.plan_result_positions.map(row),
    plan_result_warnings: all.plan_result_warnings.map(row),
  };
  await insertResults(db, rows, row(totals));
  return true;
}

// Applying a schema emits these once it commits. A changed table may need its trigger again.
const SCHEMA_EVENTS = ["collections", "fields", "relations"].flatMap((scope) =>
  ["create", "update", "delete"].map((event) => `${scope}.${event}`),
);
// Coalesces the burst of events one schema apply emits into one install.
const DEBOUNCE_MS = 1000;

function register({ filter, action, init }, { env, database, logger }) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const bootstrapAdmin = String(env["ADMIN_EMAIL"] ?? "").toLowerCase();
  const watched = new Set([PLANS, VERSIONS, ACTIVATIONS, SETS, MEMBERS, ...config.versioned]);

  const connect = (trx) => ({
    query: async (sql) => (await trx.raw(sql)).rows,
    exec: (sql) => trx.raw(sql),
  });
  const install = async () => {
    try {
      const { missing, installed } = await database.transaction((trx) => installTriggers(config, connect(trx)));
      if (missing.length > 0) {
        logger.warn(`saved-versions: no triggers yet, since these tables lack columns: ${missing.join(", ")}`);
        return;
      }
      if (installed)
        logger.info(`saved-versions: installed the triggers on ${triggered(config).length} planning tables`);
    } catch (error) {
      logger.error(error, "saved-versions: couldn't install the triggers. Writes that skip this hook aren't checked.");
    }
  };
  let pending;
  const reinstall = () => {
    clearTimeout(pending);
    pending = setTimeout(install, DEBOUNCE_MS);
  };
  init("app.after", install);
  for (const event of SCHEMA_EVENTS) action(event, reinstall);

  filter("database.error", (error) => databaseError(error));

  // The engine, bundled beside this file by `backend` (./engine-files.ts).
  let engine;
  const loadEngine = async () =>
    (engine ??= await import(url.pathToFileURL(path.join(__dirname, "planning-index.mjs")).href));
  // `id` is a saved version's or a club plan's.
  const results = async (id) => {
    try {
      const engine = await loadEngine();
      if (await database(SETS).where("id", id).first()) return await writeSetResults(config, database, id, engine);
      return await writeResults(config, database, id, engine);
    } catch (error) {
      logger.error(error, `saved-versions: couldn't write the results of ${id}`);
      throw error;
    }
  };
  // Directus checks access, and commits the save, before its actions run.
  action("items.update", async ({ collection, keys, payload }) => {
    if (collection !== VERSIONS || payload?.status !== "saved") return;
    for (const key of keys ?? []) await results(key).catch(() => {});
  });
  action("items.create", async ({ collection, key }) => {
    if (collection === SETS) await results(key).catch(() => {});
  });

  // The deploy asks this whether every trigger is in place (`SavedVersionsCheck`). It answers with
  // names and yes or no, never data.
  init("routes.custom.before", ({ app }) => {
    // Fills in a saved version's or club plan's results, if writing them failed when it was saved.
    app.post("/saved-versions/results/:id", async (req, res) => {
      if (req.accountability?.admin !== true) {
        res.status(403).json({ errors: [{ message: "Only an admin can fill in saved results." }] });
        return;
      }
      try {
        res.json({ written: await results(req.params.id) });
      } catch {
        res.status(500).json({ errors: [{ message: "Couldn't work out the saved results." }] });
      }
    });
    app.get("/saved-versions/status", async (req, res) => {
      if (req.accountability?.admin !== true) {
        res.status(403).json({ errors: [{ message: "Only an admin can see the saved-versions triggers." }] });
        return;
      }
      try {
        res.json(await database.transaction((trx) => triggerStatus(config, connect(trx))));
      } catch (error) {
        logger.error(error, "saved-versions: couldn't read the triggers");
        res.status(500).json({ errors: [{ message: "Couldn't read the saved-versions triggers." }] });
      }
    });
  });

  const lookupIn = (database) => ({
    plans: async (ids) =>
      ids.length === 0 ? [] : database(PLANS).select("id", "kind", "program_area_id").whereIn("id", ids),
    versionIds: async (collection, keys) =>
      keys.length === 0
        ? []
        : (await database(collection).select("version_id").whereIn("id", keys)).map((row) => row.version_id),
    versions: async (ids) =>
      ids.length === 0
        ? []
        : database(VERSIONS).select("id", "plan_id", "status", "platform_version").whereIn("id", ids),
    // Only so the tests can clean up after themselves (`backend:savedVersionsDeletable`).
    deletesSaved: async (user) => {
      if (!config.deletable || !user || !bootstrapAdmin) return false;
      const found = await database("directus_users").select("email").where("id", user).first();
      return (found?.email ?? "").toLowerCase() === bootstrapAdmin;
    },
  });

  for (const event of ["create", "update", "delete"]) {
    filter(`items.${event}`, async (payload, meta, { database, accountability }) => {
      if (!watched.has(meta.collection)) return payload;
      const keys = event === "delete" ? payload : (meta.keys ?? []);
      const checked = await guard(
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
      return checked;
    });
  }
}

module.exports = register;
module.exports.guard = guard;
module.exports.databaseError = databaseError;
module.exports.installTriggers = installTriggers;
module.exports.triggerStatus = triggerStatus;
module.exports.fingerprint = fingerprint;
module.exports.triggerStatements = triggerStatements;
module.exports.writeResults = writeResults;
module.exports.writeSetResults = writeSetResults;
module.exports.REFUSED = REFUSED;
module.exports.RESULTS_BY_SAVE = RESULTS_BY_SAVE;
module.exports.SET_STAYS = SET_STAYS;
module.exports.MEMBERS_BY_SAVE = MEMBERS_BY_SAVE;
