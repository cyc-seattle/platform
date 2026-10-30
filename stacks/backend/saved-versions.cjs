// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a saved plan version from changing, for every user, admins included (docs/planning-schema.md).
// Its filters refuse such a request with a clear 403, and stamp who saved a version and who made one
// active. Directus skips filters on some paths, such as a flow's data steps, so the database
// triggers it installs refuse the same writes on every path.

const PLANS = "plans";
const VERSIONS = "plan_versions";
const ACTIVATIONS = "plan_activations";

const REFUSED = "A saved plan version can't be changed. Make a new draft from it.";
const NEW_DRAFT = "A new plan version starts as a draft.";
const NEEDS_PLATFORM = "Saving a version needs the @cyc-seattle/platform version that calculated it.";
const NEEDS_OPERATIONS =
  "Saving a product's plan needs the saved Operations Plan version it was calculated with, for the same organization and year.";
const OPERATIONS_NAMES_NONE = "An Operations Plan's version doesn't name an Operations Plan version.";
const VERSION_STAYS = "A plan version can't move to another plan.";
const ROW_STAYS = "A plan row can't move to another version. Copy it into that version instead.";
const SAME_VERSION = "A plan row can only link to rows in its own version.";
const PLAN_FIXED = "A plan's kind, product, organization, and year can't change once it has a saved version.";
const ACTIVATION_STAYS = "An activation stays in the plan's history. Make another saved version active instead.";
const ONLY_SAVED_ACTIVE = "Only a saved version can be made active.";
const OWN_PLAN = "A version can only be made active for its own plan.";
const ONE_PLAN =
  "A product has one plan for each organization and year, and an organization one Operations Plan for each year.";

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
 * - `versions(ids)`: each version's `id`, `plan_id`, `status`, and `platform_version`
 * - `deletesSaved(user)`: whether this user may delete a saved version, which only dev allows
 */
async function guard({ collection, event, payload, keys = [], user, now }, config, lookup) {
  const saved = async (ids) =>
    ids.length > 0 && (await lookup.versions(ids)).some((version) => version.status === "saved");

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
    const current = await lookup.versions(keys);
    const written = (version) => ("platform_version" in rest ? rest.platform_version : version.platform_version);
    if (current.some((version) => !written(version))) throw refuse(NEEDS_PLATFORM, 400);
    return { ...rest, saved_by: user ?? null, saved_at: now };
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

  if (!config.versioned.includes(collection)) return payload;
  const ids = event === "create" ? [] : await lookup.versionIds(collection, keys);
  if (event !== "delete" && payload.version_id !== undefined) ids.push(keyOf(payload.version_id));
  const touched = [...new Set(ids.filter(Boolean))];
  if (await saved(touched)) {
    if (event !== "delete" || !(await lookup.deletesSaved(user))) throw refuse(REFUSED);
  }
  return payload;
}

/** Directus's error for a write a trigger refused, or for a second plan for the same year. */
function databaseError(error) {
  if (error?.code === SQLSTATE) {
    // knex puts the statement before the trigger's message.
    const reason = Object.keys(REASONS).find((known) => String(error.message).endsWith(known));
    return reason ? refuse(reason, REASONS[reason]) : error;
  }
  if (error?.code === "RECORD_NOT_UNIQUE" && error.extensions?.collection === PLANS) return refuse(ONE_PLAN, 400);
  return error;
}

const literal = (text) => `'${text.replaceAll("'", "''")}'`;
const raise = (reason) => `RAISE EXCEPTION USING ERRCODE = '${SQLSTATE}', MESSAGE = ${literal(reason)}`;

/** The columns each trigger reads, by table. The triggers wait until every one exists. */
function columnsNeeded(config) {
  return {
    [PLANS]: ["id", "kind", "product_id", "organization_id", "fiscal_year"],
    [VERSIONS]: ["id", "plan_id", "status", "platform_version", "operations_version_id", "saved_at"],
    [ACTIVATIONS]: ["id", "plan_id", "version_id", "sequence", "activated_at"],
    ...Object.fromEntries(
      config.versioned.map((table) => [table, ["id", "version_id", ...Object.keys(config.links[table] ?? {})]]),
    ),
  };
}

/**
 * The statements that install the triggers, in order. Each `CREATE OR REPLACE`s only this hook's
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
  IF (NEW.kind, NEW.product_id, NEW.organization_id, NEW.fiscal_year)
      IS DISTINCT FROM (OLD.kind, OLD.product_id, OLD.organization_id, OLD.fiscal_year)
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
  -- One activation of a plan at a time, so no two take the same place.
  PERFORM 1 FROM ${PLANS} p WHERE p.id = NEW.plan_id FOR NO KEY UPDATE;
  SELECT coalesce(max(a.sequence), 0) + 1 INTO NEW.sequence FROM ${ACTIVATIONS} a WHERE a.plan_id = NEW.plan_id;
  NEW.activated_at := now();
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
    row,
    version,
    plan,
    activation,
    ...trigger(PLANS, "cyc_saved_versions_plan", "UPDATE"),
    ...trigger(VERSIONS, "cyc_saved_versions_version", all),
    ...trigger(ACTIVATIONS, "cyc_saved_versions_activation", all),
    ...config.versioned.flatMap((table) =>
      trigger(table, "cyc_saved_versions_row", all, Object.entries(config.links[table] ?? {}).flat()),
    ),
    `CREATE UNIQUE INDEX IF NOT EXISTS cyc_one_product_plan ON ${PLANS} (organization_id, fiscal_year, product_id) WHERE kind = 'product'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS cyc_one_operations_plan ON ${PLANS} (organization_id, fiscal_year) WHERE kind = 'operations'`,
  ];
}

/**
 * Installs the triggers, inside one transaction the caller opens. `db.query(sql)` returns rows;
 * `db.exec(sql)` runs one statement. Returns the tables whose columns don't all exist yet, and
 * installs nothing unless that's none.
 */
async function installTriggers(config, db) {
  // Serializes Directus's processes, which each install at startup.
  await db.exec("SELECT pg_advisory_xact_lock(hashtext('cyc_saved_versions'))");
  const rows = await db.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
  );
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(columnsNeeded(config))
    .filter(([table, columns]) => columns.some((column) => !present.has(`${table}.${column}`)))
    .map(([table]) => table);
  if (missing.length > 0) return missing;
  for (const statement of triggerStatements(config)) await db.exec(statement);
  return [];
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
  const watched = new Set([VERSIONS, ACTIVATIONS, ...config.versioned]);

  const install = async () => {
    try {
      const missing = await database.transaction((trx) =>
        installTriggers(config, {
          query: async (sql) => (await trx.raw(sql)).rows,
          exec: (sql) => trx.raw(sql),
        }),
      );
      if (missing.length > 0) {
        logger.warn(`saved-versions: no triggers yet, since these tables lack columns: ${missing.join(", ")}`);
      } else {
        logger.info(`saved-versions: installed the triggers on ${config.versioned.length + 3} planning tables`);
      }
    } catch (error) {
      logger.error(error, "saved-versions: couldn't install the triggers");
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

  const lookupIn = (database) => ({
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
module.exports.triggerStatements = triggerStatements;
module.exports.REFUSED = REFUSED;
