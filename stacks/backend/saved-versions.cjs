// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a saved Financial Plan, and every plan in it, from changing, for every user, admins
// included (docs/planning-schema.md), apart from its name, its note, the date it's active from, and whether it's
// archived. Its filters refuse such a
// request with a clear 403, and stamp who saved a Financial Plan. Directus skips filters on some
// paths, such as a flow's data steps, so the database triggers it installs refuse the same writes on
// every path.
// It also copies a new Financial Plan's parent into it, and works out its results: a draft's again
// after each change to what they're worked out from, and a saved one's once, when it's saved.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const crypto = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const url = require("node:url");

const PLANS = "plans";
const VERSIONS = "plan_versions";
// Written last when a Financial Plan's results go in, so one that has it has them all.
const RESULTS = "plan_results";
// Financial Plans, and their plans.
const SETS = "version_sets";
const MEMBERS = "version_set_members";

const REFUSED = "A saved plan can't be changed. Start a new Financial Plan from the one it's in.";
const NEW_DRAFT = "A new plan copy starts as a draft.";
const SAVED_WITH_SET = "A plan is saved with its Financial Plan. Save the Financial Plan instead.";
const NEEDS_PLATFORM = "Saving a Financial Plan needs the @cyc-seattle/platform version that calculated it.";
const VERSION_STAYS = "A plan copy can't move to another plan.";
const ROW_STAYS = "A plan row can't move to another version. Copy it into that version instead.";
const SAME_VERSION = "A plan row can only link to rows in its own version.";
const PLAN_FIXED =
  "A plan's kind, program area, organization, and year can't change once it's in a Financial Plan or has a saved copy.";
const AREA_NAMED = "A program area's plan names its program area, and an Operations Plan names none.";
const RESULTS_BY_SAVE = "A Financial Plan's results are worked out from its plans, and can't be written by hand.";
const NEW_SET_DRAFT = "A new Financial Plan starts as a draft.";
const SET_STAYS =
  "A saved Financial Plan can't be changed, apart from its name, its note, the date it's active from, and whether it's archived. Start a new one from it.";
const SET_FIXED = "A Financial Plan's organization, year, and parent can't change.";
const PARENT_SAME_YEAR = "A Financial Plan can only start from one for the same organization and year.";
const NEEDS_OPERATIONS = "A Financial Plan needs an Operations Plan before it's saved.";
const MEMBERS_FIXED = "A saved Financial Plan's plans can't change. Start a new Financial Plan from it.";
const MEMBER_DRAFT = "Only a draft plan can be added to a Financial Plan.";
const MEMBER_YEAR = "A plan in a Financial Plan must be for the same organization and year.";
const ONE_PER_AREA = "A Financial Plan holds one Operations Plan, and at most one Program Plan for each program area.";
const IN_ANOTHER = "A plan copy is in only one Financial Plan.";
const ONE_PER_DATE = "Another Financial Plan for the year is already active from that date.";
const IN_FORCE_NOT_ARCHIVED = "The plan in force can't be archived, and nor can one active from a later date.";
const ARCHIVED_NOT_ACTIVE = "An archived Financial Plan can't be made active. Bring it back from the archive first.";
const ACTIVE_STAYS = "An active Financial Plan can't be deleted. Clear the date it's active from first.";
const BONUS_IN_OPERATIONS = "A bonus goes in the Operations Plan.";

/** What a saved Financial Plan lets change: its name, its note, the date it's active from, and whether it's archived. */
const SET_EDITABLE = ["name", "message", "effective_from", "archived_at"];

/** The plan rows only an Operations Plan holds, which the database refuses in a Program Plan. */
const OPERATIONS_ONLY_ROWS = ["plan_bonus_owners", "plan_bonus_owner_products"];

/** Each reason a trigger gives, which the hook answers with its status. */
const REASONS = {
  [REFUSED]: 403,
  [PLAN_FIXED]: 403,
  [SET_STAYS]: 403,
  [MEMBERS_FIXED]: 403,
  [ACTIVE_STAYS]: 403,
  [RESULTS_BY_SAVE]: 403,
  [NEW_DRAFT]: 400,
  [SAVED_WITH_SET]: 400,
  [NEEDS_PLATFORM]: 400,
  [VERSION_STAYS]: 400,
  [ROW_STAYS]: 400,
  [SAME_VERSION]: 400,
  [AREA_NAMED]: 400,
  [NEW_SET_DRAFT]: 400,
  [SET_FIXED]: 400,
  [PARENT_SAME_YEAR]: 400,
  [NEEDS_OPERATIONS]: 400,
  [MEMBER_DRAFT]: 400,
  [MEMBER_YEAR]: 400,
  [ONE_PER_AREA]: 400,
  [IN_ANOTHER]: 400,
  [ONE_PER_DATE]: 400,
  [IN_FORCE_NOT_ARCHIVED]: 400,
  [ARCHIVED_NOT_ACTIVE]: 400,
  [BONUS_IN_OPERATIONS]: 400,
};
/** The SQLSTATE every trigger raises, so the hook can tell its refusals from other errors. */
const SQLSTATE = "CY001";

/** Whether a Financial Plan's status is saved. */
function isSaved(status) {
  return status === "saved";
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
 * - `versionIds(collection, keys)`: the `version_id` of each row
 * - `plans(ids)`: each plan's `id`, `kind`, and `program_area_id`
 * - `versions(ids)`: each version's `id`, `plan_id`, `status`, and `platform_version`
 * - `sets(ids)`: each Financial Plan's `id`, `status`, and `archived_at`
 * - `memberSets(keys)`: the Financial Plan each of these members is in
 * - `deletesSaved(user)`: whether this user may delete a saved Financial Plan, which only dev allows
 */
async function guard({ collection, event, payload, keys = [], user, now }, config, lookup) {
  const saved = async (ids) =>
    ids.length > 0 && (await lookup.versions(ids)).some((version) => version.status === "saved");
  const savedSet = async (ids) => ids.length > 0 && (await lookup.sets(ids)).some((set) => isSaved(set.status));

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
      if ((payload.status ?? "draft") !== "draft") throw refuse(NEW_DRAFT, 400);
      return unstamped(payload, ["saved_by", "saved_at", "platform_version"]);
    }
    if (event === "delete") {
      if ((await saved(keys)) && !(await lookup.deletesSaved(user))) throw refuse(REFUSED);
      return payload;
    }
    if (await saved(keys)) throw refuse(REFUSED);
    if (payload.status === "saved") throw refuse(SAVED_WITH_SET, 400);
    // Only saving its Financial Plan stamps a plan copy as saved.
    return unstamped(payload, ["saved_by", "saved_at", "platform_version"]);
  }

  if (collection === SETS) {
    const stamps = ["saved_by", "saved_at", "platform_version"];
    if (event === "create") {
      if ((payload.status ?? "draft") !== "draft") throw refuse(NEW_SET_DRAFT, 400);
      return unstamped(payload, stamps);
    }
    if (event === "delete") {
      if ((await savedSet(keys)) && !(await lookup.deletesSaved(user))) throw refuse(SET_STAYS);
      return payload;
    }
    // The triggers check the dates it's active from, and archiving, against the other Financial Plans.
    const sets = await lookup.sets(keys);
    if (sets.some((set) => isSaved(set.status))) {
      // Only its name and note change, such as "Reviewed with the board", and when it's active, and whether it's archived.
      const changed = Object.keys(payload).filter((field) => !(field === "status" && payload.status === "saved"));
      if (changed.some((field) => !SET_EDITABLE.includes(field))) throw refuse(SET_STAYS);
      // A draft changed with a saved one is refused too, rather than saved without its stamps.
      if ("status" in payload && sets.some((set) => set.status !== payload.status)) throw refuse(SET_STAYS);
      return payload;
    }
    const rest = unstamped(payload, stamps);
    if (rest.status !== "saved") return rest;
    // The hook works out a saved Financial Plan's results, so it records its own engine's version.
    return { ...rest, platform_version: config.platformVersion, saved_by: user ?? null, saved_at: now };
  }

  if (collection === MEMBERS) {
    const sets = event === "create" ? [] : await lookup.memberSets(keys);
    if (event !== "delete" && payload.version_set_id !== undefined) sets.push(keyOf(payload.version_set_id));
    if (await savedSet([...new Set(sets.filter(Boolean))])) {
      if (event !== "delete" || !(await lookup.deletesSaved(user))) throw refuse(MEMBERS_FIXED);
    }
    if (event === "delete" || payload.version_id === undefined) return payload;
    // The trigger sets the plan from the copy too; this fills it in for Directus's own checks first.
    const [version] = await lookup.versions([keyOf(payload.version_id)].filter(Boolean));
    return version ? { ...payload, plan_id: version.plan_id } : payload;
  }

  if (config.results.includes(collection)) {
    if (event === "delete" && (await lookup.deletesSaved(user))) return payload;
    throw refuse(RESULTS_BY_SAVE);
  }
  if (!config.versioned.includes(collection)) return payload;
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
    [PLANS]: ["id", "kind", "program_area_id", "organization_id", "fiscal_year"],
    [VERSIONS]: ["id", "plan_id", "status", "platform_version", "saved_by", "saved_at"],
    [SETS]: [
      "id",
      "organization_id",
      "fiscal_year",
      "status",
      "parent_id",
      "platform_version",
      "saved_by",
      "saved_at",
      "archived_at",
      "effective_from",
    ],
    [MEMBERS]: ["id", "version_set_id", "plan_id", "version_id"],
    ...Object.fromEntries(config.results.map((table) => [table, ["id", "version_set_id"]])),
    ...Object.fromEntries(
      config.versioned.map((table) => [table, ["id", "version_id", ...Object.keys(config.links[table] ?? {})]]),
    ),
  };
}

/**
 * The statements that install the triggers' own functions and triggers on the planning tables, and
 * drop what earlier installs made that's no longer used. Each trigger locks the row it checks, so a
 * Financial Plan can't be saved, or a plan changed, while a write that read it is still open.
 */
function triggerStatements(config) {
  const deletable = config.deletable ? "true" : "false";
  const editable = `ARRAY[${SET_EDITABLE.map(literal).join(", ")}]`;
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
  IF TG_TABLE_NAME IN (${OPERATIONS_ONLY_ROWS.map(literal).join(", ")}) AND EXISTS (
    SELECT 1 FROM ${VERSIONS} v JOIN ${PLANS} p ON p.id = v.plan_id WHERE v.id = NEW.version_id AND p.kind <> 'operations'
  ) THEN
    ${raise(BONUS_IN_OPERATIONS)};
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

  // Only the hook writes results, a set at a time, with no results there yet. A draft's are replaced
  // as its plans change, and cleared when it's saved; a saved one's go in once and never change.
  const result = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_result() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  set_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT s.status INTO set_status FROM ${SETS} s WHERE s.id = OLD.version_set_id;
    -- A Financial Plan or member that's gone is a draft's, whose delete cascades to its results.
    IF ${deletable} OR set_status IS NULL
      OR (to_jsonb(OLD) ->> 'version_set_member_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${MEMBERS} m WHERE m.id = (to_jsonb(OLD) ->> 'version_set_member_id')::uuid))
      OR (set_status = 'draft' AND current_setting('cyc.writing_results', true) = 'on') THEN
      RETURN OLD;
    END IF;
    ${raise(RESULTS_BY_SAVE)};
  END IF;
  IF TG_OP = 'UPDATE' OR current_setting('cyc.writing_results', true) IS DISTINCT FROM 'on' THEN
    ${raise(RESULTS_BY_SAVE)};
  END IF;
  SELECT s.status INTO set_status FROM ${SETS} s WHERE s.id = NEW.version_set_id FOR SHARE;
  IF set_status IS NULL
    OR EXISTS (SELECT 1 FROM ${RESULTS} r WHERE r.version_set_id = NEW.version_set_id) THEN
    ${raise(RESULTS_BY_SAVE)};
  END IF;
  RETURN NEW;
END
$fn$`;

  const version = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
    -- Only saving its Financial Plan saves a plan copy: the set's trigger sets the flag, and updates the copy from
    -- inside itself, so a session that sets the flag and updates a copy directly is still refused.
    IF current_setting('cyc.saving_set', true) IS DISTINCT FROM 'on' OR pg_trigger_depth() < 2 THEN
      ${raise(SAVED_WITH_SET)};
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
    AND (
      EXISTS (SELECT 1 FROM ${VERSIONS} v WHERE v.plan_id = OLD.id AND v.status = 'saved')
      -- A member was checked against its Financial Plan's year and areas when it joined.
      OR EXISTS (SELECT 1 FROM ${MEMBERS} m WHERE m.plan_id = OLD.id)
    ) THEN
    ${raise(PLAN_FIXED)};
  END IF;
  RETURN NEW;
END
$fn$`;

  // Saving a Financial Plan saves every plan copy in it, in the same statement, so they're saved together.
  // The plan in force on a day is the one for its year with the latest date on or before it, so no
  // two share a date. Today is the database's date, which is UTC.
  const set = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_set() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'saved' AND NOT ${deletable} THEN
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
      SELECT s.organization_id, s.fiscal_year INTO parent FROM ${SETS} s WHERE s.id = NEW.parent_id;
      IF (parent.organization_id, parent.fiscal_year) IS DISTINCT FROM (NEW.organization_id, NEW.fiscal_year) THEN
        ${raise(PARENT_SAME_YEAR)};
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
  IF OLD.status = 'saved' THEN
    IF (to_jsonb(NEW) - ${editable}) IS DISTINCT FROM (to_jsonb(OLD) - ${editable}) THEN
      ${raise(SET_STAYS)};
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.organization_id, NEW.fiscal_year, NEW.parent_id) IS DISTINCT FROM (OLD.organization_id, OLD.fiscal_year, OLD.parent_id) THEN
    ${raise(SET_FIXED)};
  END IF;
  IF NEW.status = 'saved' THEN
    IF coalesce(btrim(NEW.platform_version), '') = '' THEN
      ${raise(NEEDS_PLATFORM)};
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('cyc_set|' || NEW.id, 0));
    IF NOT EXISTS (
      SELECT 1 FROM ${MEMBERS} m JOIN ${PLANS} p ON p.id = m.plan_id
        WHERE m.version_set_id = NEW.id AND p.kind = 'operations'
    ) THEN
      ${raise(NEEDS_OPERATIONS)};
    END IF;
    -- A draft's results are cleared, for the hook to work out again with the engine it records.
    PERFORM set_config('cyc.writing_results', 'on', true);
    ${config.results.map((table) => `DELETE FROM ${table} WHERE version_set_id = NEW.id;`).join("\n    ")}
    PERFORM set_config('cyc.writing_results', 'off', true);
    PERFORM set_config('cyc.saving_set', 'on', true);
    UPDATE ${VERSIONS} SET status = 'saved', platform_version = NEW.platform_version, saved_by = NEW.saved_by
      WHERE id IN (SELECT m.version_id FROM ${MEMBERS} m WHERE m.version_set_id = NEW.id);
    PERFORM set_config('cyc.saving_set', 'off', true);
    NEW.saved_at := now();
  END IF;
  RETURN NEW;
END
$fn$`;

  // A Financial Plan's plans change only while it's a draft: one Operations Plan, at most one
  // Program Plan for each program area, each a draft copy in no other Financial Plan.
  const member = `
CREATE OR REPLACE FUNCTION cyc_saved_versions_member() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  set_row record;
  version record;
  plan record;
  clash text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT s.status INTO set_row FROM ${SETS} s WHERE s.id = OLD.version_set_id FOR SHARE;
    IF set_row.status = 'saved' AND NOT (TG_OP = 'DELETE' AND ${deletable}) THEN
      ${raise(MEMBERS_FIXED)};
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;
  SELECT s.status, s.organization_id, s.fiscal_year INTO set_row FROM ${SETS} s WHERE s.id = NEW.version_set_id FOR SHARE;
  IF set_row.status = 'saved' THEN
    ${raise(MEMBERS_FIXED)};
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cyc_set|' || NEW.version_set_id, 0));
  SELECT v.plan_id, v.status INTO version FROM ${VERSIONS} v WHERE v.id = NEW.version_id FOR SHARE;
  IF version.status IS DISTINCT FROM 'draft' THEN
    ${raise(MEMBER_DRAFT)};
  END IF;
  NEW.plan_id := version.plan_id;
  SELECT p.kind, p.program_area_id, p.organization_id, p.fiscal_year INTO plan FROM ${PLANS} p WHERE p.id = NEW.plan_id;
  IF (plan.organization_id, plan.fiscal_year) IS DISTINCT FROM (set_row.organization_id, set_row.fiscal_year) THEN
    ${raise(MEMBER_YEAR)};
  END IF;
  IF EXISTS (SELECT 1 FROM ${MEMBERS} m WHERE m.version_id = NEW.version_id AND m.id <> NEW.id) THEN
    ${raise(IN_ANOTHER)};
  END IF;
  SELECT coalesce(area.name, 'the Operations Plan') INTO clash
    FROM ${MEMBERS} m JOIN ${PLANS} p ON p.id = m.plan_id LEFT JOIN program_areas area ON area.id = p.program_area_id
    WHERE m.version_set_id = NEW.version_set_id AND m.id <> NEW.id
      AND p.kind = plan.kind AND p.program_area_id IS NOT DISTINCT FROM plan.program_area_id
    LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '${SQLSTATE}', MESSAGE = ${literal(ONE_PER_AREA)},
      DETAIL = format('It already has %s.', clash);
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
    // Club plans filled their members from plan activations, which Financial Plans replaced.
    `DROP TRIGGER IF EXISTS cyc_saved_versions_members ON ${SETS}`,
    "DROP FUNCTION IF EXISTS cyc_saved_versions_set_members()",
    "DROP FUNCTION IF EXISTS cyc_saved_versions_activation()",
    // Financial Plans were marked active in a log, which a status replaced (cyc0004).
    "DROP FUNCTION IF EXISTS cyc_saved_versions_set_activation()",
    row,
    result,
    version,
    plan,
    set,
    member,
    ...trigger(PLANS, "cyc_saved_versions_plan", "INSERT OR UPDATE"),
    ...trigger(VERSIONS, "cyc_saved_versions_version", all),
    ...trigger(SETS, "cyc_saved_versions_set", all),
    ...trigger(MEMBERS, "cyc_saved_versions_member", all),
    // A Financial Plan is active from a date, in place of an active status (cyc0015).
    "DROP INDEX IF EXISTS cyc_one_active_set",
    // One Financial Plan for an organization's year active from each date, should two writes race the trigger.
    `CREATE UNIQUE INDEX IF NOT EXISTS cyc_one_set_per_date ON ${SETS} (organization_id, fiscal_year, effective_from) WHERE effective_from IS NOT NULL`,
    ...config.results.flatMap((table) => trigger(table, "cyc_saved_versions_result", all)),
    ...config.versioned.flatMap((table) =>
      trigger(table, "cyc_saved_versions_row", all, Object.entries(config.links[table] ?? {}).flat()),
    ),
  ];
}

/** The tables that get a trigger. */
const triggered = (config) => [PLANS, VERSIONS, SETS, MEMBERS, ...config.results, ...config.versioned];

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
  await seedSaved(db);
  const status = await triggerStatus(config, db);
  const hash = fingerprint(config);
  if (status.fingerprint === hash && Object.values(status.tables).every(Boolean)) {
    await seedEffectiveDates(db);
    return { missing: [], installed: false };
  }
  for (const statement of triggerStatements(config)) await db.exec(statement);
  await db.exec(`COMMENT ON FUNCTION cyc_saved_versions_row() IS ${literal(hash)}`);
  await seedEffectiveDates(db);
  return { missing: [], installed: true };
}

/** Where the Financial Plans migration (cyc0002) lists the club plans, each saved when it was added. */
const SAVED_SEED = "cyc_seed_saved_sets";

/**
 * Marks saved each club plan the Financial Plans migration listed, once the schema apply has added
 * `version_sets.status`, as a draft, then drops the list. Its plans were saved already, so this sets
 * only the status, with the trigger that would save them again off for the one statement.
 */
async function seedSaved(db) {
  const [{ seed }] = await db.query(`SELECT to_regclass('${SAVED_SEED}') IS NOT NULL AS seed`);
  if (!seed) return;
  await db.exec(`ALTER TABLE ${SETS} DISABLE TRIGGER USER`);
  await db.exec(
    `UPDATE ${SETS} SET status = 'saved' WHERE id IN (SELECT version_set_id FROM ${SAVED_SEED}) AND status = 'draft'`,
  );
  await db.exec(`ALTER TABLE ${SETS} ENABLE TRIGGER USER`);
  await db.exec(`DROP TABLE ${SAVED_SEED}`);
}

/** Where the effective dates migration (cyc0015) lists the Financial Plans that were active, with their dates. */
const SEED = "cyc_seed_effective_sets";

/**
 * Sets the date each Financial Plan the effective dates migration listed is active from, then drops
 * the list. The migration runs before the schema apply adds `version_sets.effective_from`, so it
 * can't set them itself. A saved one allows a new date, but its trigger is off for the one
 * statement, as the migration's own update was.
 */
async function seedEffectiveDates(db) {
  const [{ seed }] = await db.query(`SELECT to_regclass('${SEED}') IS NOT NULL AS seed`);
  if (!seed) return;
  await db.exec(`ALTER TABLE ${SETS} DISABLE TRIGGER USER`);
  await db.exec(
    `UPDATE ${SETS} s SET effective_from = seed.effective_from FROM ${SEED} seed
      WHERE s.id = seed.version_set_id AND s.effective_from IS NULL`,
  );
  await db.exec(`ALTER TABLE ${SETS} ENABLE TRIGGER USER`);
  await db.exec(`DROP TABLE ${SEED}`);
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
 * Everything `computePlan` reads, for the plan copies in `ids`. `set` is the Financial Plan: its
 * organization and year are the calculation's. `operations` is its Operations Plan copy.
 */
async function loadPlan(config, db, set, operations, ids) {
  const read = async (table, query = (q) => q) => engineRows(config, table, await query(db(table).select("*")));
  const data = Object.fromEntries(await Promise.all(CATALOG.map(async (table) => [table, await read(table)])));
  for (const table of config.versioned) data[table] = await read(table, (q) => q.whereIn("version_id", ids));
  const versions = await db(VERSIONS).whereIn("id", ids).select("id", "plan_id");
  const plans = await db(PLANS)
    .whereIn(
      "id",
      versions.map((v) => v.plan_id),
    )
    .select("id", "kind", "program_area_id");
  const [organization] = await read("organizations", (q) => q.where("id", set.organization_id));
  const rates = data.plan_rates.find((r) => r.version_id === operations);
  return {
    ...data,
    fiscal_year: set.fiscal_year,
    organization,
    organization_cost_accounts: await read("organization_cost_accounts", (q) =>
      q.where("organization_id", set.organization_id),
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
    plan_result_capital: out.capital.map((c) => ({
      rank: c.rank,
      item_key: c.key,
      name: c.name,
      amount_cents: c.amount_cents,
      running_cents: c.running_cents,
      funded: c.funded,
    })),
    plan_result_warnings: out.warnings.map((w) => ({
      owner: w.version_id ?? null,
      code: w.code,
      message: w.message,
      subject_key: w.key ?? null,
      date: w.date ?? null,
      category: w.category,
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
 * row names the member that holds what it's charged to, and each warning the member it's about.
 */
async function calculate(config, db, set, engine) {
  const setId = set.id;
  const members = await db(MEMBERS).where("version_set_id", setId).select("id", "version_id", "plan_id");
  const kinds = await db(PLANS)
    .whereIn(
      "id",
      members.map((m) => m.plan_id),
    )
    .select("id", "kind");
  const operations = members.find((m) => kinds.find((p) => p.id === m.plan_id)?.kind === "operations")?.version_id;
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
    plan_result_capital: all.plan_result_capital.map(row),
    plan_result_warnings: all.plan_result_warnings.map(owned),
  };
  return { rows, totals: row(totals) };
}

/** Works out a saved Financial Plan's results and writes them, once. */
async function writeSetResults(config, db, setId, engine) {
  const set = await db(SETS).where("id", setId).first();
  if (!isSaved(set?.status)) return false;
  if (await db(RESULTS).where("version_set_id", setId).first()) return false;
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
  for (const table of config.results) await trx(table).where("version_set_id", setId).delete();
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

/** What a draft's results are worked out from apart from its plans' rows, so a change to it changes every draft's. */
const INPUTS = [...CATALOG, "organizations", "organization_cost_accounts"];

/** The draft Financial Plans whose results a write to these rows of `collection` changes. */
async function draftsChangedBy(config, db, collection, keys) {
  const drafts = () => db(SETS).where("status", "draft");
  const ids = (rows, field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))];
  if (INPUTS.includes(collection)) return ids(await drafts().select("id"), "id");
  if (keys.length === 0) return [];
  let members;
  if (collection === MEMBERS) members = await db(MEMBERS).whereIn("id", keys).select("version_set_id");
  else if (collection === PLANS) members = await db(MEMBERS).whereIn("plan_id", keys).select("version_set_id");
  else if (config.versioned.includes(collection)) {
    const versions = ids(await db(collection).whereIn("id", keys).select("version_id"), "version_id");
    members = versions.length === 0 ? [] : await db(MEMBERS).whereIn("version_id", versions).select("version_set_id");
  } else return [];
  const sets = ids(members, "version_set_id");
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
 * The versioned tables in an order that copies a row only after every row it links to, such as an
 * offering before its activities.
 */
function copyOrder(config) {
  const order = [];
  const visit = (table, path) => {
    if (order.includes(table)) return;
    if (path.includes(table))
      throw new Error(`saved-versions: plan rows link in a loop: ${[...path, table].join(" → ")}`);
    for (const linked of Object.values(config.links[table] ?? {}))
      if (linked !== table) visit(linked, [...path, table]);
    order.push(table);
  };
  for (const table of config.versioned) visit(table, []);
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
    if (await trx(MEMBERS).where("version_set_id", setId).first()) return false;
    const members = await trx(MEMBERS).where("version_set_id", set.parent_id).select("version_id", "plan_id");
    const kinds = new Map(
      (
        await trx(PLANS)
          .whereIn(
            "id",
            members.map((m) => m.plan_id),
          )
          .select("id", "kind")
      ).map((p) => [p.id, p.kind]),
    );
    const operations = members.find((m) => kinds.get(m.plan_id) === "operations")?.version_id;
    const programPlans = new Set(members.filter((m) => m.version_id !== operations).map((m) => m.version_id));
    const copyOf = new Map();
    for (const { version_id: from } of members) {
      const source = await trx(VERSIONS).where("id", from).first();
      const id = crypto.randomUUID();
      await trx(VERSIONS).insert({
        id,
        plan_id: source.plan_id,
        parent_version_id: from,
        status: "draft",
        message: source.message,
        rules: source.rules,
      });
      copyOf.set(from, id);
    }
    const ids = [...copyOf.keys()];
    for (const table of copyOrder(config)) {
      const links = Object.entries(config.links[table] ?? {});
      const rows = ids.length === 0 ? [] : await trx(table).whereIn("version_id", ids).select("*");
      const self = links.filter(([, linked]) => linked === table);
      // A bonus a Program Plan held before bonuses moved to the Operations Plan moves there in the copy.
      const moves = OPERATIONS_ONLY_ROWS.includes(table) && operations !== undefined;
      const copies = rows.map((row) => {
        const into = moves && programPlans.has(row.version_id) ? operations : row.version_id;
        const copy = { ...asWritten(row), id: crypto.randomUUID(), version_id: copyOf.get(into) };
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
    for (const { version_id: from } of members) {
      await trx(MEMBERS).insert({ id: crypto.randomUUID(), version_set_id: setId, version_id: copyOf.get(from) });
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

function register({ filter, action, init }, { env, database, logger }) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const bootstrapAdmin = String(env["ADMIN_EMAIL"] ?? "").toLowerCase();
  const watched = new Set([PLANS, VERSIONS, SETS, MEMBERS, ...config.results, ...config.versioned]);

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
      logger.error(error, `saved-versions: couldn't write the results of ${id}`);
      throw error;
    }
  };
  const drafts = draftQueue(
    async (id) => {
      try {
        await writeDraftResults(config, database, id, await loadEngine());
      } catch (error) {
        logger.error(error, `saved-versions: couldn't work out the draft results of ${id}`);
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
        .whereNotExists(database(RESULTS).select(1).whereRaw(`${RESULTS}.version_set_id = ${SETS}.id`))
        .select("id");
      drafts.mark(missing.map((set) => set.id));
    } catch (error) {
      logger.error(error, "saved-versions: couldn't list the drafts to work out their results");
    }
  });
  const changed = async (collection, keys) => {
    try {
      drafts.mark(await draftsChangedBy(config, database, collection, keys));
    } catch (error) {
      logger.error(error, `saved-versions: couldn't tell which drafts a change to ${collection} changes`);
    }
  };
  const copy = async (id) => {
    try {
      return await copyParent(config, database, id);
    } catch (error) {
      logger.error(error, `saved-versions: couldn't copy the parent of ${id}`);
      throw error;
    }
  };
  // Directus checks access, and commits the write, before its actions run.
  action("items.update", async ({ collection, keys, payload }) => {
    if (collection !== SETS || payload?.status !== "saved") return;
    for (const key of keys ?? []) await results(key).catch(() => {});
  });
  action("items.create", async ({ collection, key }) => {
    if (collection === SETS) {
      await copy(key).catch(() => {});
      drafts.mark([key]);
    } else await changed(collection, [key]);
  });
  // A deleted row, or a member moved to another draft, can't be traced to the drafts it was in once
  // the write commits, so the write's filter finds them first, for its action.
  const before = new Map();
  const remember = async (event, collection, keys, db) => {
    const found = await draftsChangedBy(config, db, collection, keys).catch(() => []);
    if (found.length === 0) return;
    const id = `${event}|${collection}|${JSON.stringify(keys)}`;
    before.set(id, found);
    setTimeout(() => before.delete(id), BEFORE_TTL_MS).unref?.();
  };
  const recall = (event, collection, keys) => {
    const id = `${event}|${collection}|${JSON.stringify(keys)}`;
    const found = before.get(id) ?? [];
    before.delete(id);
    return found;
  };
  filter("items.update", async (payload, { collection, keys }, { database }) => {
    if (collection === MEMBERS && "version_set_id" in payload)
      await remember("update", collection, keys ?? [], database);
    return payload;
  });
  action("items.update", async ({ collection, keys }) => {
    drafts.mark(recall("update", collection, keys ?? []));
    await changed(collection, keys ?? []);
  });
  filter("items.delete", async (keys, { collection }, { database }) => {
    await remember("delete", collection, keys, database);
    return keys;
  });
  action("items.delete", ({ collection, keys }) => drafts.mark(recall("delete", collection, keys)));

  // The deploy asks this whether every trigger is in place (`SavedVersionsCheck`). It answers with
  // names and yes or no, never data.
  init("routes.custom.before", ({ app }) => {
    const adminOnly = (handler) => async (req, res) => {
      if (req.accountability?.admin !== true) {
        res.status(403).json({ errors: [{ message: "Only an admin can do this." }] });
        return;
      }
      await handler(req, res);
    };
    // Fills in a saved Financial Plan's results, if writing them failed when it was saved.
    app.post(
      "/saved-versions/results/:id",
      adminOnly(async (req, res) => {
        try {
          res.json({ written: await results(req.params.id) });
        } catch {
          res.status(500).json({ errors: [{ message: "Couldn't work out the saved results." }] });
        }
      }),
    );
    // Copies a new Financial Plan's parent into it, if that failed when it was added.
    app.post(
      "/saved-versions/copy/:id",
      adminOnly(async (req, res) => {
        try {
          res.json({ copied: await copy(req.params.id) });
        } catch {
          res.status(500).json({ errors: [{ message: "Couldn't copy the Financial Plan's parent." }] });
        }
      }),
    );
    app.get(
      "/saved-versions/status",
      adminOnly(async (_req, res) => {
        try {
          res.json(await database.transaction((trx) => triggerStatus(config, connect(trx))));
        } catch (error) {
          logger.error(error, "saved-versions: couldn't read the triggers");
          res.status(500).json({ errors: [{ message: "Couldn't read the saved-versions triggers." }] });
        }
      }),
    );
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
    sets: async (ids) =>
      ids.length === 0 ? [] : database(SETS).select("id", "status", "archived_at").whereIn("id", ids),
    memberSets: async (keys) =>
      keys.length === 0
        ? []
        : (await database(MEMBERS).select("version_set_id").whereIn("id", keys)).map((row) => row.version_set_id),
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
module.exports.triggerStatus = triggerStatus;
module.exports.fingerprint = fingerprint;
module.exports.triggerStatements = triggerStatements;
module.exports.writeSetResults = writeSetResults;
module.exports.writeDraftResults = writeDraftResults;
module.exports.draftsChangedBy = draftsChangedBy;
module.exports.draftQueue = draftQueue;
module.exports.copyParent = copyParent;
module.exports.copyOrder = copyOrder;
module.exports.REFUSED = REFUSED;
module.exports.RESULTS_BY_SAVE = RESULTS_BY_SAVE;
module.exports.SET_STAYS = SET_STAYS;
module.exports.MEMBERS_FIXED = MEMBERS_FIXED;
module.exports.SAVED_WITH_SET = SAVED_WITH_SET;
module.exports.NEEDS_OPERATIONS = NEEDS_OPERATIONS;
module.exports.ONE_PER_AREA = ONE_PER_AREA;
module.exports.ONE_PER_DATE = ONE_PER_DATE;
module.exports.IN_FORCE_NOT_ARCHIVED = IN_FORCE_NOT_ARCHIVED;
module.exports.ARCHIVED_NOT_ACTIVE = ARCHIVED_NOT_ACTIVE;
module.exports.ACTIVE_STAYS = ACTIVE_STAYS;
module.exports.BONUS_IN_OPERATIONS = BONUS_IN_OPERATIONS;
