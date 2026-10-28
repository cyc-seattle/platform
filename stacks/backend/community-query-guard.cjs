// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Directus checks only that a filter's or sort's field is readable on *some* row, then runs it
// against the raw column, and joins a relational filter's rows with no permissions at all. So a
// family member who sees a teammate by name could probe the teammate's hidden email letter by
// letter, and a Crew member could probe every sailor's allergies through the rule that shows them
// their own child's. This rejects any query from a user with a row-filtered read rule that filters,
// sorts, groups, or aggregates on a field they can't read on every row, or that crosses a relation
// into a collection whose rows they read only in part. Search is left alone: Directus applies
// permissions to it.

const OPERATOR_RELATIONS = ["_some", "_none"];

/** A `DirectusError` by duck type, which Directus's error handler answers with its status. */
function forbidden(reason) {
  const error = new Error(`Queries can't use ${reason}.`);
  error.name = "DirectusError";
  error.code = "FORBIDDEN";
  error.status = 403;
  error.extensions = { reason };
  return error;
}

function relatedCollection(relations, collection, field) {
  for (const relation of relations) {
    if (relation.collection === collection && relation.field === field && relation.related_collection) {
      return relation.related_collection;
    }
    if (relation.related_collection === collection && relation.meta?.one_field === field) {
      return relation.collection;
    }
  }
  return undefined;
}

/** `year(date_created)` filters on `date_created`. */
function fieldName(key) {
  const match = /^\w+\((\w+)\)$/.exec(key);
  return match ? match[1] : key;
}

/**
 * What a user holding `names` reads: per collection, the fields some of their read rules withhold
 * (`restricted`), and the collections they read every row of (`open`). `fieldsOf` lists a
 * collection's fields, for a rule that grants them all. Undefined if no rule limits rows, since then
 * nothing needs checking.
 */
function effectiveAccess(config, names, fieldsOf) {
  const rulesBy = {};
  for (const name of names) {
    for (const [collection, rules] of Object.entries(config.policies[name] ?? {})) {
      (rulesBy[collection] ??= []).push(...rules);
    }
  }
  const all = Object.values(rulesBy).flat();
  if (!all.some((rule) => rule.filtered)) return undefined;

  const restricted = {};
  const open = [];
  for (const [collection, rules] of Object.entries(rulesBy)) {
    const fields = (rule) => (rule.fields === "*" ? fieldsOf(collection) : rule.fields);
    // An unfiltered rule for every field reads the whole collection, whatever the others say.
    const whole = rules.some((rule) => !rule.filtered && rule.fields === "*");
    if (whole || rules.every((rule) => !rule.filtered)) open.push(collection);
    if (whole) continue;
    const everyRow = new Set(rules.filter((rule) => !rule.filtered).flatMap(fields));
    const each = rules.map((rule) => new Set(fields(rule)));
    const some = [...new Set(rules.flatMap(fields))];
    const partial = some.filter((field) => !everyRow.has(field) && !each.every((set) => set.has(field))).sort();
    if (partial.length > 0) restricted[collection] = partial;
  }
  return { restricted, open: open.sort() };
}

/**
 * Returns why `query` on `collection` would reveal a field the viewer can't read, or undefined.
 *
 * @param config `restricted`: per collection, the fields some of the viewer's read rules withhold.
 *   `open`: the collections the viewer reads every row of.
 */
function violation(config, relations, collection, query) {
  function checkField(current, key) {
    const field = fieldName(key);
    if ((config.restricted[current] ?? []).includes(field)) {
      return `${current}.${field}`;
    }
    return undefined;
  }

  function step(current, key) {
    if (key.startsWith("$FOLLOW") || key.includes(":")) {
      return { reason: `the relation ${key}` };
    }
    const restricted = checkField(current, key);
    if (restricted) return { reason: restricted };
    const target = relatedCollection(relations, current, key);
    if (!target || !config.open.includes(target)) {
      return { reason: `the relation ${current}.${key}` };
    }
    return { target };
  }

  function checkFilter(current, filter) {
    if (filter === null || typeof filter !== "object") return undefined;
    for (const [key, value] of Object.entries(filter)) {
      if (key === "_and" || key === "_or") {
        for (const branch of value) {
          const reason = checkFilter(current, branch);
          if (reason) return reason;
        }
        continue;
      }
      if (key.startsWith("_")) continue;
      const nested =
        value !== null &&
        typeof value === "object" &&
        Object.keys(value).some((inner) => !inner.startsWith("_") || OPERATOR_RELATIONS.includes(inner));
      if (!nested) {
        const reason = checkField(current, key);
        if (reason) return reason;
        continue;
      }
      const { target, reason } = step(current, key);
      if (reason) return reason;
      const inner = Object.keys(value).find((k) => OPERATOR_RELATIONS.includes(k)) ? Object.values(value)[0] : value;
      const innerReason = checkFilter(target, inner);
      if (innerReason) return innerReason;
    }
    return undefined;
  }

  function checkPath(path) {
    const parts = path.replace(/^-/, "").split(".");
    let current = collection;
    for (const part of parts.slice(0, -1)) {
      const { target, reason } = step(current, part);
      if (reason) return reason;
      current = target;
    }
    return checkField(current, parts.at(-1));
  }

  const aliases = query.alias ?? {};
  const paths = [...(query.sort ?? []), ...(query.group ?? []), ...Object.values(query.aggregate ?? {}).flat()].map(
    (path) => aliases[path.replace(/^-/, "")] ?? path,
  );

  if (query.deep && Object.keys(query.deep).length > 0) return "deep";
  const reason = checkFilter(collection, query.filter);
  if (reason) return reason;
  for (const path of paths) {
    if (path === "*") continue;
    const pathReason = checkPath(path);
    if (pathReason) return pathReason;
  }
  return undefined;
}

/** A collection's fields, without the aliases, which a relation's own check covers. */
function columns(schema, collection) {
  const fields = schema.collections[collection]?.fields ?? {};
  return Object.values(fields)
    .filter((field) => field.type !== "alias")
    .map((field) => field.field);
}

const CACHE_MS = 5_000;

function register({ filter }) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const cache = new Map();

  /** The names of the policies the user holds, through their role or their own account. */
  async function policyNames(database, accountability) {
    const roles = accountability.roles ?? (accountability.role ? [accountability.role] : []);
    const key = `${accountability.user}:${roles.join(",")}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.names;
    const rows = await database("directus_access")
      .join("directus_policies", "directus_policies.id", "directus_access.policy")
      .select("directus_policies.name")
      .where((where) => {
        if (accountability.user) where.orWhere("directus_access.user", accountability.user);
        if (roles.length > 0) where.orWhereIn("directus_access.role", roles);
      });
    const names = rows.map((row) => row.name);
    cache.set(key, { at: Date.now(), names });
    return names;
  }

  filter("items.query", async (query, { collection }, { accountability, schema, database }) => {
    if (!accountability || accountability.admin || (!accountability.user && !accountability.role)) return query;
    const names = await policyNames(database, accountability);
    const access = effectiveAccess(config, names, (name) => columns(schema, name));
    if (!access) return query;
    const reason = violation(access, schema.relations, collection, query);
    if (reason) throw forbidden(reason);
    return query;
  });
}

module.exports = register;
module.exports.violation = violation;
module.exports.effectiveAccess = effectiveAccess;
