import { describe, expect, it } from "vitest";
import { type BackfillRows, planBackfill } from "../scripts/catalog-backfill.ts";

function ids(): () => string {
  let next = 0;
  return () => `new-${++next}`;
}

function rows(overrides: Partial<BackfillRows>): BackfillRows {
  return { programs: [], products: [], accounts: [], camps: [], ...overrides };
}

describe("planBackfill", () => {
  it("adds an account per distinct code, and a program product booked to its program's account", () => {
    const plan = planBackfill(
      rows({
        programs: [
          { id: "guppies", name: "Guppies", revenue_account: " 4000 ", product_id: null },
          { id: "j-pod", name: "J-Pod", revenue_account: "4000", product_id: null },
          { id: "adults", name: "Adults", revenue_account: null, product_id: null },
        ],
        camps: [{ clubspot_sales_account: "4100" }, { clubspot_sales_account: "" }, { clubspot_sales_account: null }],
      }),
      ids(),
    );

    expect(plan.accounts).toEqual([
      { id: "new-1", number: "4000", name: "4000", type: "revenue" },
      { id: "new-2", number: "4100", name: "4100", type: "revenue" },
    ]);
    expect(plan.products).toEqual([
      { id: "new-3", name: "Guppies", kind: "program", revenue_account_id: "new-1" },
      { id: "new-4", name: "J-Pod", kind: "program", revenue_account_id: "new-1" },
      { id: "new-5", name: "Adults", kind: "program", revenue_account_id: null },
    ]);
    expect(plan.programs).toEqual([
      { id: "guppies", product_id: "new-3" },
      { id: "j-pod", product_id: "new-4" },
      { id: "adults", product_id: "new-5" },
    ]);
  });

  it("reuses an account that has the code as its number", () => {
    const plan = planBackfill(
      rows({
        programs: [{ id: "guppies", name: "Guppies", revenue_account: "4000", product_id: null }],
        accounts: [{ id: "youth", number: "4000" }],
      }),
      ids(),
    );

    expect(plan.accounts).toEqual([]);
    expect(plan.products).toMatchObject([{ revenue_account_id: "youth" }]);
  });

  it("books a linked product with no account, and leaves one booked elsewhere", () => {
    const plan = planBackfill(
      rows({
        programs: [
          { id: "guppies", name: "Guppies", revenue_account: "4000", product_id: "unbooked" },
          { id: "j-pod", name: "J-Pod", revenue_account: "4000", product_id: "elsewhere" },
        ],
        products: [
          { id: "unbooked", kind: "program", revenue_account_id: null },
          { id: "elsewhere", kind: "program", revenue_account_id: "adult" },
        ],
        accounts: [
          { id: "youth", number: "4000" },
          { id: "adult", number: "4100" },
        ],
      }),
      ids(),
    );

    expect(plan.products).toEqual([]);
    expect(plan.productAccounts).toEqual([{ id: "unbooked", revenue_account_id: "youth" }]);
    expect(plan.conflicts).toBe(1);
  });

  it("counts a program whose product isn't a program, and leaves it", () => {
    const plan = planBackfill(
      rows({
        programs: [{ id: "guppies", name: "Guppies", revenue_account: null, product_id: "charter" }],
        products: [{ id: "charter", kind: "charter", revenue_account_id: null }],
      }),
      ids(),
    );

    expect(plan.wrongKind).toBe(1);
    expect(plan.products).toEqual([]);
  });

  it("plans nothing once everything is backfilled", () => {
    const plan = planBackfill(
      rows({
        programs: [{ id: "guppies", name: "Guppies", revenue_account: "4000", product_id: "p" }],
        products: [{ id: "p", kind: "program", revenue_account_id: "youth" }],
        accounts: [{ id: "youth", number: "4000" }],
        camps: [{ clubspot_sales_account: "4000" }],
      }),
      ids(),
    );

    expect(plan).toEqual({ accounts: [], products: [], programs: [], productAccounts: [], conflicts: 0, wrongKind: 0 });
  });
});
