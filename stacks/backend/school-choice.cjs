// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps a person's school either on the list (`school_id`) or in their own words (`school`), never
// both (docs/crm-schema.md), for every writer through Directus: the apps, the Data Studio, and the
// syncs. Setting one clears the other, and setting both in one write is refused.

/** A `DirectusError` by duck type, which Directus's error handler answers with its status. */
function invalid(reason) {
  const error = new Error(`Invalid payload. ${reason}`);
  error.name = "DirectusError";
  error.code = "INVALID_PAYLOAD";
  error.status = 400;
  error.extensions = { reason };
  return error;
}

function given(payload, field) {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) return false;
  const value = payload[field];
  return typeof value === "string" ? value.trim() !== "" : value != null;
}

/** `payload` with the other school field cleared, or an error if it sets both. */
function schoolChoice(payload) {
  const picked = given(payload, "school_id");
  const typed = given(payload, "school");
  if (picked && typed) {
    throw invalid("A person's school is one on the list or one in their own words, not both.");
  }
  if (picked && !Object.prototype.hasOwnProperty.call(payload, "school")) return { ...payload, school: null };
  if (typed && !Object.prototype.hasOwnProperty.call(payload, "school_id")) return { ...payload, school_id: null };
  return payload;
}

function register({ filter }) {
  for (const event of ["people.items.create", "people.items.update"]) {
    filter(event, (payload) => schoolChoice(payload));
  }
}

module.exports = register;
module.exports.schoolChoice = schoolChoice;
