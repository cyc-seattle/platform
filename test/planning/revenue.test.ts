import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { A, area, charge, emptyPlan, offering, pnlOf, product, total } from "./fixtures.ts";

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

  it("books a charge set as a share of revenue on each offering of the kinds it names", () => {
    const { data } = setup();
    const fees = charge({ rate: 0.03 });
    data.plan_revenue_charges = [fees, charge({ rate: 0.5, product_kinds: ["merchandise"] })];
    const out = computePlan(data);
    expect(total(out, { line: `charge:${fees.key}`, account_id: A.cardFees })).toBe(15_000);
    expect(total(out, { line: "charge:" })).toBe(15_000);
  });

  it("books a charge on a revenue account as revenue", () => {
    const { off: o, data } = setup();
    data.plan_revenue_charges = [charge({ rate: 0.03, account_id: A.charterRevenue })];
    const out = computePlan(data);
    expect(pnlOf(out, o.key).revenue_cents).toBe(515_000);
    expect(pnlOf(out, o.key).mtdc_cents).toBe(0);
  });

  it("leaves a charge out of MTDC when it says so", () => {
    const { off: o, data } = setup();
    data.plan_revenue_charges = [charge({ rate: 0.02, excluded_from_mtdc: true }), charge({ rate: 0.03 })];
    expect(pnlOf(computePlan(data), o.key).mtdc_cents).toBe(15_000);
  });

  it("books revenue to the program area's account", () => {
    const { p, data } = setup();
    const summer = area({ revenue_account_id: A.charterRevenue });
    data.program_areas = [summer];
    p.program_area_id = summer.id;
    p.revenue_account_id = null;
    expect(total(computePlan(data), { line: "revenue", account_id: A.charterRevenue })).toBe(500_000);
    p.revenue_account_id = A.programRevenue;
    const out = computePlan(data);
    expect(total(out, { line: "revenue", account_id: A.charterRevenue })).toBe(500_000);
    expect(out.warnings.map((w) => w.code)).toContain("revenue_account_differs");
  });

  it("warns when the product has no revenue account", () => {
    const { p, data } = setup();
    p.revenue_account_id = null;
    const out = computePlan(data);
    expect(out.warnings.map((w) => w.code)).toContain("no_revenue_account");
    expect(total(out)).toBe(0);
  });
});
