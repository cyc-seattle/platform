import { describe, it, expect } from "vitest";
import { findAll, type PageableQuery } from "../../../src/syncs/clubspot/parse-paging.ts";

interface Row {
  id: string;
}

const rowsOf = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `obj${String(i).padStart(4, "0")}` }));

/**
 * A fake Parse query over `table`, which `find()` reads fresh each call so a test can insert rows
 * mid-run. Without `ascending("objectId")` it returns rows in a new shuffled order on every call,
 * as Parse on Postgres may with no `ORDER BY`.
 */
function fakeQuery(table: Row[], options: { onFind?: () => void } = {}): PageableQuery<Row> {
  let limit = 100;
  let after: string | undefined;
  let sorted = false;
  let seed = 1;
  const shuffled = (rows: Row[]): Row[] =>
    rows
      .map((row) => ({ row, key: (seed = (seed * 16807) % 2147483647) }))
      .sort((a, b) => a.key - b.key)
      .map(({ row }) => row);
  const query: PageableQuery<Row> = {
    ascending() {
      sorted = true;
      return query;
    },
    greaterThan(_key, value) {
      after = value;
      return query;
    },
    limit(n) {
      limit = n;
      return query;
    },
    find() {
      options.onFind?.();
      const matching = table.filter((row) => after === undefined || row.id > after);
      const ordered = sorted ? matching.toSorted((a, b) => a.id.localeCompare(b.id)) : shuffled(matching);
      return Promise.resolve(ordered.slice(0, limit));
    },
  };
  return query;
}

describe("findAll", () => {
  it("returns every row when the result fits in one page", async () => {
    const rows = rowsOf(3);
    expect(await findAll(fakeQuery(rows), 10)).toEqual(rows);
  });

  it("returns a result of exactly one page, rather than mistaking a full page for a truncated one", async () => {
    const rows = rowsOf(100);
    expect(await findAll(fakeQuery(rows), 100)).toEqual(rows);
  });

  it("pages past a result larger than one page, instead of truncating it", async () => {
    // The bug this guards against: a camp with 140 confirmed registrations against Parse's default
    // page size of 100 lost the last 40 silently, with no error and an advanced watermark.
    const rows = rowsOf(140);
    expect(await findAll(fakeQuery(rows), 100)).toEqual(rows);
  });

  it("returns each row exactly once from a query whose server order changes between pages", async () => {
    const rows = rowsOf(1001);
    expect(await findAll(fakeQuery(rows), 100)).toEqual(rows);
  });

  it("returns each row exactly once when a row is inserted before the current page mid-run", async () => {
    const table = rowsOf(250).filter((row) => row.id !== "obj0010");
    let finds = 0;
    const query = fakeQuery(table, {
      onFind: () => {
        if (++finds === 2) {
          table.push({ id: "obj0010" });
        }
      },
    });

    const ids = (await findAll(query, 100)).map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(249);
  });
});
