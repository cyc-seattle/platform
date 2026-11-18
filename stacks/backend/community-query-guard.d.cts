import type { QueryGuardConfig } from "./policies.ts";

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta?: { one_field?: string | null } | null;
}

/** Per collection, the fields some of a user's read rules withhold, and the collections they read whole. */
export interface Access {
  restricted: Record<string, string[]>;
  open: string[];
}

/** What a user holding the policies `names` reads, or undefined if none of their rules limits rows. */
export function effectiveAccess(
  config: QueryGuardConfig,
  names: string[],
  fieldsOf: (collection: string) => string[],
): Access | undefined;

/** Why `query` would reveal a field the user can't read on every row, or undefined. */
export function violation(
  access: Access,
  relations: Relation[],
  collection: string,
  query: Record<string, unknown>,
): string | undefined;
