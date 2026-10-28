// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a saved plan version from changing, for every user, admins included: Directus skips
// permissions for an admin, but runs filter hooks for everyone (docs/planning-schema.md). It also
// stamps who saved a version and who made one active, and when.

const VERSIONS = "plan_versions";
const ACTIVATIONS = "plan_activations";
const REFUSED = "A saved plan version can't be changed. Make a new draft from it.";

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
 * - `versions(ids)`: each version's `id`, `plan_id`, and `status`
 * - `deletesSaved(user)`: whether this user may delete a saved version, which only dev allows
 */
async function guard({ collection, event, payload, keys = [], user, now }, config, lookup) {
  const saved = async (ids) =>
    ids.length > 0 && (await lookup.versions(ids)).some((version) => version.status === "saved");

  if (collection === VERSIONS) {
    if (event === "create") {
      if ((payload.status ?? "draft") !== "draft") throw refuse("A new plan version starts as a draft.");
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
    if (!rest.platform_version && current.some((version) => !version.platform_version)) {
      throw refuse("Saving a version needs the @cyc-seattle/platform version that calculated it.", 400);
    }
    return { ...rest, saved_by: user ?? null, saved_at: now };
  }

  if (collection === ACTIVATIONS && event === "create") {
    const [version] = await lookup.versions([keyOf(payload.version_id)].filter(Boolean));
    if (version?.status !== "saved") throw refuse("Only a saved version can be made active.", 400);
    if (payload.plan_id !== undefined && keyOf(payload.plan_id) !== version.plan_id) {
      throw refuse("A version can only be made active for its own plan.", 400);
    }
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

function register({ filter }, { env }) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const bootstrapAdmin = String(env["ADMIN_EMAIL"] ?? "").toLowerCase();
  const watched = new Set([VERSIONS, ACTIVATIONS, ...config.versioned]);

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
module.exports.REFUSED = REFUSED;
