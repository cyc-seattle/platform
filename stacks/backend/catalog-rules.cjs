// A Directus hook. Installs the catalog's rules a schema can't declare: an offering links its Clubspot
// class and session together, or neither, and one class and session have one offering
// (cyc-seattle/platform#395). The migrations that first made them return early on a new database,
// before the schema apply makes the tables, so this installs them at start, and again after each
// schema change, once the tables are there. CommonJS, with no imports.

// Long enough for a write in flight to commit, short enough not to hold up Directus's start.
const LOCK_TIMEOUT = "5s";

/** The columns the rules read, by table. */
const NEEDED = {
  offerings: ["id", "clubspot_class_id", "clubspot_session_id"],
  clubspot_sessions: ["id"],
  clubspot_classes: ["id"],
};

/** Deleting a Clubspot class or session unlinks its offerings from both, so none keeps half a link. */
const unlink = (name, column) => `
CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $unlink$
BEGIN
  UPDATE offerings SET clubspot_class_id = NULL, clubspot_session_id = NULL WHERE ${column} = OLD.id;
  RETURN OLD;
END
$unlink$`;

const TRIGGERS = [
  { name: "cyc_unlink_session_offerings", table: "clubspot_sessions", column: "clubspot_session_id" },
  { name: "cyc_unlink_class_offerings", table: "clubspot_classes", column: "clubspot_class_id" },
];

/**
 * Installs the rules, inside one transaction the caller opens. `db.query(sql)` returns rows;
 * `db.exec(sql)` runs one statement. Returns the tables whose columns don't all exist yet, and installs
 * nothing unless that's none. Adds only what's missing, so a start with every rule in place locks no table.
 */
async function installCatalogRules(db) {
  await db.exec(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  // Serializes Directus's processes, which each install at startup.
  await db.exec("SELECT pg_advisory_xact_lock(hashtext('cyc_catalog_rules'))");
  const rows = await db.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
  );
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(NEEDED)
    .filter(([table, columns]) => columns.some((column) => !present.has(`${table}.${column}`)))
    .map(([table]) => table);
  if (missing.length > 0) return { missing, installed: [] };

  const installed = [];
  for (const { name, column } of TRIGGERS) await db.exec(unlink(name, column));
  const triggers = new Set(
    (await db.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).map((row) => row.tgname),
  );
  for (const { name, table } of TRIGGERS) {
    if (triggers.has(name)) continue;
    await db.exec(`CREATE TRIGGER ${name} BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    installed.push(name);
  }
  const constraints = new Set(
    (await db.query("SELECT conname FROM pg_constraint WHERE conrelid = 'offerings'::regclass")).map(
      (row) => row.conname,
    ),
  );
  if (!constraints.has("offerings_class_with_session")) {
    await db.exec(`ALTER TABLE offerings ADD CONSTRAINT offerings_class_with_session
      CHECK ((clubspot_class_id IS NULL) = (clubspot_session_id IS NULL))`);
    installed.push("offerings_class_with_session");
  }
  const indexes = new Set(
    (await db.query("SELECT indexname FROM pg_indexes WHERE tablename = 'offerings'")).map((row) => row.indexname),
  );
  if (!indexes.has("offerings_clubspot_class_session_unique")) {
    // A Clubspot registration entry finds one offering by its class and session.
    await db.exec(`CREATE UNIQUE INDEX offerings_clubspot_class_session_unique
      ON offerings (clubspot_class_id, clubspot_session_id) WHERE clubspot_class_id IS NOT NULL`);
    installed.push("offerings_clubspot_class_session_unique");
  }
  return { missing: [], installed };
}

// Applying a schema emits these once it commits. A table it made may need the rules.
const SCHEMA_EVENTS = ["collections", "fields", "relations"].flatMap((scope) =>
  ["create", "update", "delete"].map((event) => `${scope}.${event}`),
);
// Coalesces the burst of events one schema apply emits into one install.
const DEBOUNCE_MS = 1000;

function register({ action, init }, { database, logger }) {
  const connect = (trx) => ({
    query: async (sql) => (await trx.raw(sql)).rows,
    exec: (sql) => trx.raw(sql),
  });
  const install = async () => {
    try {
      const { missing, installed } = await database.transaction((trx) => installCatalogRules(connect(trx)));
      if (missing.length > 0) {
        logger.warn(`catalog-rules: not yet, since these tables lack columns: ${missing.join(", ")}`);
      } else if (installed.length > 0) {
        logger.info(`catalog-rules: installed ${installed.join(", ")}`);
      }
    } catch (error) {
      logger.error(error, "catalog-rules: couldn't install the catalog's rules");
    }
  };
  let pending;
  const reinstall = () => {
    clearTimeout(pending);
    pending = setTimeout(install, DEBOUNCE_MS);
  };
  for (const event of SCHEMA_EVENTS) action(event, reinstall);
  init("app.after", install);
}

module.exports = register;
module.exports.installCatalogRules = installCatalogRules;
