import { describe, expect, it } from "vitest";
import { computePlan } from "../src/index.ts";
import { A, emptyPlan, metricTotal, offering, product, rule, total } from "./fixtures.ts";

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
    expect(total(out, { line: "revenue", basis: "cash" })).toBe(500_000);
  });

  it("blends price tiers by share, paying list price for the rest", () => {
    const { off, data } = setup();
    data.plan_offering_prices = [
      { id: "t1", version_id: "v1", key: "t1", offering_id: off.id, tier: "member", price_cents: 40_000, share: 0.5 },
      { id: "t2", version_id: "v1", key: "t2", offering_id: off.id, tier: "aid", price_cents: 10_000, share: 0.25 },
    ];
    // 10 × (0.5 × 40000 + 0.25 × 10000 + 0.25 × 50000)
    expect(total(computePlan(data), { line: "revenue" })).toBe(350_000);
  });

  it("prices per session, by month of the sessions", () => {
    const { off, data } = setup({
      price_cents: 2000,
      price_basis: "per_session",
      starts_on: "2027-06-01",
      ends_on: "2027-07-31",
    });
    // Tuesdays: 5 in June 2027 and 4 in July.
    data.plan_schedule_rules = [rule(off.id, { weekdays: [2] })];
    const out = computePlan(data);
    expect(total(out, { line: "revenue", month: "2027-06-01" })).toBe(100_000);
    expect(total(out, { line: "revenue", month: "2027-07-01" })).toBe(80_000);
  });

  it("prices per month, evenly over the offering's months", () => {
    const { data } = setup({
      price_cents: 10_000,
      price_basis: "per_month",
      starts_on: "2027-03-01",
      ends_on: "2027-05-31",
    });
    const out = computePlan(data);
    expect(total(out, { line: "revenue" })).toBe(300_000);
    expect(total(out, { line: "revenue", month: "2027-04-01" })).toBe(100_000);
  });

  it("prices per unit, ignoring enrollment", () => {
    const { data } = setup({ price_cents: 25_000, price_basis: "per_unit", units: 4 });
    expect(total(computePlan(data), { line: "revenue" })).toBe(100_000);
  });

  it("collects cash on the registration curve, even before the fiscal year's months it falls in", () => {
    const { off, data } = setup({ registration_curve: { "2027-03": 0.6, "2027-05": 0.4 } });
    const out = computePlan(data);
    expect(total(out, { line: "revenue", basis: "cash", month: "2027-03-01" })).toBe(300_000);
    expect(total(out, { line: "revenue", basis: "cash", month: "2027-05-01" })).toBe(200_000);
    expect(total(out, { line: "revenue", basis: "accrual", month: "2027-06-01" })).toBe(500_000);
    expect(metricTotal(out, off.key, "enrollment", "2027-03-01")).toBe(6);
  });

  it("drops months outside the fiscal year", () => {
    const { data } = setup({
      price_basis: "per_month",
      price_cents: 1000,
      starts_on: "2026-11-01",
      ends_on: "2027-02-28",
    });
    expect(total(computePlan(data), { line: "revenue" })).toBe(20_000);
  });

  it("books COGS as a share of revenue", () => {
    const { data } = setup({ cogs_rate: 0.4 });
    expect(total(computePlan(data), { line: "cogs", account_id: A.cogs })).toBe(200_000);
  });

  it("warns when the product has no revenue account", () => {
    const { p, data } = setup();
    p.revenue_account_id = null;
    const out = computePlan(data);
    expect(out.warnings.map((w) => w.code)).toContain("no_revenue_account");
    expect(total(out)).toBe(0);
  });
});
