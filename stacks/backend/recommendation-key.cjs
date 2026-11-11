// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a sailor to one recommendation a term (docs/crm-schema.md), for every writer through
// Directus. Directus can't make a pair of columns unique, so this fills `recommendations.key` from
// the sailor and the term, and the column's unique constraint refuses a second one. A migration
// can't add the constraint instead: it runs before the schema apply makes the table.

const COLLECTION = "recommendations";
const DUPLICATE = "This sailor already has a recommendation for this term. Change that one instead.";

/** A `DirectusError` by duck type, which Directus's error handler answers with its status. */
function invalid(reason) {
  const error = new Error(`Invalid payload. ${reason}`);
  error.name = "DirectusError";
  error.code = "INVALID_PAYLOAD";
  error.status = 400;
  error.extensions = { reason };
  return error;
}

/** A link's ID, whether the payload gives the ID or the linked row. */
function idOf(value) {
  return value !== null && typeof value === "object" ? value.id : value;
}

function recommendationKey(personId, termId) {
  return `${personId}:${termId}`;
}

/**
 * `payload` with its `key` set from the sailor and the term, over `current`, the stored row an update
 * changes. A key in the payload is dropped, and an update that changes neither keeps the stored one.
 */
function withKey(payload, current) {
  const rest = { ...payload };
  delete rest.key;
  const changes = "person_id" in rest || "term_id" in rest;
  if (current !== undefined && !changes) return rest;
  const personId = idOf("person_id" in rest ? rest.person_id : current?.person_id);
  const termId = idOf("term_id" in rest ? rest.term_id : current?.term_id);
  // A missing sailor or term is the required columns' error to give, not this hook's.
  if (personId == null || termId == null) return rest;
  return { ...rest, key: recommendationKey(personId, termId) };
}

async function refuseDuplicate(database, key, ownId) {
  if (key === undefined) return;
  const query = database(COLLECTION).select("id").where({ key });
  const existing = await (ownId === undefined ? query : query.whereNot({ id: ownId })).first();
  if (existing !== undefined) throw invalid(DUPLICATE);
}

function register({ filter }) {
  filter(`${COLLECTION}.items.create`, async (payload, _meta, { database }) => {
    const next = withKey(payload);
    await refuseDuplicate(database, next.key);
    return next;
  });

  filter(`${COLLECTION}.items.update`, async (payload, { keys }, { database }) => {
    if (!("person_id" in payload || "term_id" in payload)) return withKey(payload, {});
    // Each row's key comes from its own sailor and term, which one payload can't give for many rows.
    if (keys.length !== 1) throw invalid("Change the sailor or the term of one recommendation at a time.");
    const current = await database(COLLECTION).select("person_id", "term_id").where({ id: keys[0] }).first();
    const next = withKey(payload, current ?? {});
    await refuseDuplicate(database, next.key, keys[0]);
    return next;
  });
}

module.exports = register;
module.exports.register = register;
module.exports.withKey = withKey;
module.exports.recommendationKey = recommendationKey;
module.exports.DUPLICATE = DUPLICATE;
