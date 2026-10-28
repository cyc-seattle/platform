// What a user would lose moving from one set of permission rows to another. Pure, for
// ./migrate-roles.ts and its tests.

import { effectiveAccess } from "../stacks/backend/community-query-guard.cjs";

/** A permission row, as a key that says what it allows. */
export interface Grant {
  collection: string;
  action: string;
  filtered: boolean;
  fields: string[];
}

/** The grants in `before` that nothing in `after` covers as fully. */
export function lost(before: Grant[], after: Grant[]): Grant[] {
  return before.filter(
    (old) =>
      !after.some(
        (now) =>
          now.collection === old.collection &&
          now.action === old.action &&
          (!now.filtered || old.filtered) &&
          (now.fields.includes("*") || old.fields.every((field) => now.fields.includes(field))),
      ),
  );
}

/**
 * Where the query guard would refuse a filter or sort that `before` allowed: a collection no longer
 * read whole, or a field no longer read on every row. Directus's own app permissions, such as a
 * user's own row of directus_users, aren't permission rows, so this can't see them.
 */
export function refusedByGuard(before: Grant[], after: Grant[], fieldsOf: (collection: string) => string[]): string[] {
  const accessOf = (grants: Grant[]) => {
    const reads: Record<string, { fields: string[] | "*"; filtered: boolean }[]> = {};
    for (const grant of grants.filter(({ action }) => action === "read")) {
      (reads[grant.collection] ??= []).push({
        fields: grant.fields.includes("*") ? "*" : grant.fields,
        filtered: grant.filtered,
      });
    }
    return { reads, access: effectiveAccess({ policies: { user: reads } }, ["user"], fieldsOf) };
  };
  const old = accessOf(before);
  const now = accessOf(after);
  if (now.access === undefined) return [];
  const missing: string[] = [];
  for (const collection of Object.keys(old.reads)) {
    const joinable = old.access === undefined || old.access.open.includes(collection);
    if (joinable && !now.access.open.includes(collection)) missing.push(`relations into ${collection}`);
    for (const field of now.access.restricted[collection] ?? []) {
      if (!(old.access?.restricted[collection] ?? []).includes(field)) missing.push(`${collection}.${field}`);
    }
  }
  return missing;
}
