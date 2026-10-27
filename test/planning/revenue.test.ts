import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { A, emptyPlan, offering, pnlOf, product, rates, total } from "./fixtures.ts";

function setup(o: Partial<Parameters<typeof offering>[1]> = {}) {
  const p = product();
  const off = offering(p.id, { target_enrollment: 10, price_cents: 50_000, ...o });
  return { p, off, data: emptyPlan({ products: [p], plan_offerings: [off] }) };
}

describe("revenue", () => {
  it("books price × enrollment to the product's revenue account", () => {
    const { off, data } = setup();
    const out = computePlan(data);
    expect(total(out, { line: "revenue", account_id: A.programRevenue, cost_center_key: off.key })).toBe(500_000);
  });

  it("rounds enrollment to whole kids", () => {
    const { off, data } = setup({ target_enrollment: null, capacity: 15, fill_rate: 0.75 });
    const out = computePlan(data);
    expect(pnlOf(out, off.key).enrollment).toBe(11);
    expect(total(out, { line: "revenue" })).toBe(11 * 50_000);
  });

  it("counts an offering whole in the plan year it starts in", () => {
    const { data } = setup({ starts_on: "2027-11-01", ends_on: "2028-02-29" });
    expect(total(computePlan(data), { line: "revenue" })).toBe(500_000);
    data.plan_offerings[0]!.starts_on = "2026-11-01";
    data.plan_offerings[0]!.ends_on = "2027-02-28";
    expect(computePlan(data).lines).toEqual([]);
  });

  it("books COGS as a share of revenue", () => {
    const { data } = setup({ cogs_rate: 0.4 });
    expect(total(computePlan(data), { line: "cogs", account_id: A.cogs })).toBe(200_000);
  });

  it("books card fees at the year's rate", () => {
    const { data } = setup();
    data.plan_rates = [rates({ card_fee_rate: 0.03 })];
    expect(total(computePlan(data), { line: "card_fees", account_id: A.cardFees })).toBe(15_000);
  });

  it("warns when the product has no revenue account", () => {
    const { p, data } = setup();
    p.revenue_account_id = null;
    const out = computePlan(data);
    expect(out.warnings.map((w) => w.code)).toContain("no_revenue_account");
    expect(total(out)).toBe(0);
  });
});
