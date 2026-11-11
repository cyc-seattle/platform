/**
 * The subset of `Parse.Query` (and so `LoggedQuery`) that `findAll` needs, kept as an interface so
 * paging can be tested against a fake query instead of a live one.
 */
export interface PageableQuery<T> {
  ascending(key: "objectId"): PageableQuery<T>;
  greaterThan(key: "objectId", value: string): PageableQuery<T>;
  limit(n: number): PageableQuery<T>;
  find(): Promise<T[]>;
}

// Parse's own default page size is 100. `cyc-seattle/admin-functions`' `.limit(1000)` calls raise
// that cap but don't remove it - a 1001st row is dropped exactly as silently, just less often.
// Paging removes the cap instead of moving it.
const PAGE_SIZE = 1000;

/**
 * Pages a Parse query in fixed-size batches, so a result larger than one page is never truncated.
 *
 * Pages by key on `objectId`, not by `skip`: Parse on Postgres promises no order without a sort,
 * and a row inserted mid-run shifts every later skip page, so skip paging can drop one row and
 * repeat another (cyc-seattle/platform#159). The sort replaces any sort the caller set.
 */
export async function findAll<T extends { id: string }>(query: PageableQuery<T>, pageSize = PAGE_SIZE): Promise<T[]> {
  const results: T[] = [];
  query.ascending("objectId").limit(pageSize);
  for (;;) {
    const page = await query.find();
    results.push(...page);
    const last = page.at(-1);
    if (page.length < pageSize || !last) {
      return results;
    }
    query.greaterThan("objectId", last.id);
  }
}
