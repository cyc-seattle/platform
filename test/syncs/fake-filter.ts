import { type DirectusFilter } from "../../src/syncs/runtime/client.ts";

/** The filter a request's `filter[...]` query parameters encode, as `DirectusClient` writes them. */
export function filterFromParams(search: URLSearchParams): DirectusFilter {
  const filter: Record<string, unknown> = {};
  for (const [key, value] of search.entries()) {
    const path = /^filter((?:\[[^\]]+\])+)$/.exec(key)?.[1];
    if (path === undefined) {
      continue;
    }
    const parts = [...path.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!);
    let node = filter;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts.at(-1)!] = value;
  }
  // `_or`'s members arrive keyed by index.
  const toArrays = (node: unknown): unknown =>
    node === null || typeof node !== "object"
      ? node
      : Object.fromEntries(
          Object.entries(node).map(([key, child]) => [
            key,
            key === "_or" ? Object.values(child as object).map(toArrays) : toArrays(child),
          ]),
        );
  return toArrays(filter) as DirectusFilter;
}

/**
 * Whether a fake Directus row matches `filter`: `_eq`, `_neq`, `_in`, `_null`, `_lte` on timestamps,
 * and `_or`. Values compare as strings, as they arrive in a URL. Any other operator, such as
 * `_icontains`, matches every row, and person-sync's tests rely on that.
 */
export function matchesFilter(row: Record<string, unknown>, filter: DirectusFilter): boolean {
  return Object.entries(filter).every(([field, operators]) => {
    if (operators === undefined) {
      return true;
    }
    if (Array.isArray(operators)) {
      return operators.some((each) => matchesFilter(row, each));
    }
    const actual = row[field];
    return Object.entries(operators).every(([operator, expected]) => {
      const value = String(expected);
      switch (operator) {
        case "_eq":
          return String(actual ?? "") === value;
        case "_neq":
          return String(actual ?? "") !== value;
        case "_in":
          return value.split(",").includes(String(actual ?? ""));
        case "_null":
          return (actual == null) === (value === "true");
        case "_lte":
          return actual != null && new Date(String(actual)).getTime() <= new Date(value).getTime();
        default:
          return true;
      }
    });
  });
}
