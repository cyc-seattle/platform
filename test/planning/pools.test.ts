import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, offering, pnlOf, pool, product, total } from "./fixtures.ts";

/** Two programs' offerings with 30,000 and 10,000 of MTDC, and a charter that has `charter` revenue and costs. */
function plan(charter: { revenue?: number; costs?: number } = {}) {
  const camp = product();
  const racing = product();
  const charters = product({ kind: "charter" });
  const big = offering(camp.id);
  const small = offering(racing.id);
  const hire = offering(charters.id);
  const on = (key: string) => ({ cost_center_type: "offering" as const, cost_center_key: key });
  const data = emptyPlan({
    products: [camp, racing, charters],
    plan_offerings: [big, small, hire],
    plan_budget_lines: [
      budgetLine({ account_id: A.rent, amount_cents: 30_000, ...on(big.key) }),
      budgetLine({ account_id: A.rent, amount_cents: 10_000, ...on(small.key) }),
      budgetLine({ account_id: A.charterRevenue, amount_cents: charter.revenue ?? 0, ...on(hire.key) }),
      budgetLine({ account_id: A.rent, amount_cents: charter.costs ?? 0, ...on(hire.key) }),
    ],
  });
  return { big, small, hire, data };
}

function withPool(data: ReturnType<typeof plan>["data"], amount: number, name = "G&A") {
  const p = pool({ name });
  data.plan_pools.push(p);
  data.plan_budget_lines.push(budgetLine({ amount_cents: amount, cost_center_type: "pool", cost_center_key: p.key }));
  return p;
}

describe("pools", () => {
  it("splits a pool over the programs' offerings by MTDC, keeping its accounts", () => {
    const { big, small, hire, data } = plan();
    const ga = withPool(data, 12_000);
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: big.key })).toBe(9000);
    expect(total(out, { account_id: A.insurance, cost_center_key: small.key })).toBe(3000);
    expect(total(out, { account_id: A.insurance, cost_center_key: hire.key })).toBe(0);
    expect(total(out, { line: `pool:${ga.key}:budget` })).toBe(12_000);
    expect(total(out, { cost_center_type: "pool" })).toBe(0);
  });

  it("takes non-program's gain off the pool, onto the organization, before the programs share it", () => {
    const { big, small, hire, data } = plan({ revenue: 5000, costs: 1000 });
    const ga = withPool(data, 12_000);
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: big.key })).toBe(6000);
    expect(total(out, { account_id: A.insurance, cost_center_key: small.key })).toBe(2000);
    expect(total(out, { cost_center_type: "org", line: `offset:${ga.key}:budget` })).toBe(4000);
    expect(pnlOf(out, hire.key).net_cents).toBe(4000);
  });

  it("adds non-program's loss to what the programs share, as a credit on the organization", () => {
    const { big, small, hire, data } = plan({ costs: 3000 });
    const ga = withPool(data, 12_000);
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: big.key })).toBe(11_250);
    expect(total(out, { account_id: A.insurance, cost_center_key: small.key })).toBe(3750);
    expect(total(out, { cost_center_type: "org", line: `offset:${ga.key}:budget` })).toBe(-3000);
    expect(pnlOf(out, hire.key).net_cents).toBe(-3000);
  });

  it("offsets every pool in proportion to its size", () => {
    const { data } = plan({ revenue: 6000 });
    const ga = withPool(data, 9000);
    const admin = withPool(data, 3000, "Program admin");
    const out = computePlan(data);
    expect(total(out, { line: `offset:${ga.key}` })).toBe(4500);
    expect(total(out, { line: `offset:${admin.key}` })).toBe(1500);
  });

  it("leaves every pool with the organization, with a warning, when non-program makes more than them all", () => {
    const { big, data } = plan({ revenue: 20_000 });
    withPool(data, 12_000);
    const out = computePlan(data);
    expect(total(out, { cost_center_key: big.key, account_id: A.insurance })).toBe(0);
    expect(total(out, { cost_center_type: "org", account_id: A.insurance })).toBe(12_000);
    expect(out.warnings.map((w) => w.code)).toContain("non_program_exceeds_pools");
  });

  it("counts no pool's split in another pool's base", () => {
    const { big, data } = plan();
    withPool(data, 1_000_000, "First");
    const second = withPool(data, 1000, "Second");
    expect(total(computePlan(data), { line: `pool:${second.key}`, cost_center_key: big.key })).toBe(750);
  });

  it("leaves a pool with the organization when no program's offering has MTDC", () => {
    const ga = pool();
    const data = emptyPlan({
      plan_pools: [ga],
      plan_budget_lines: [budgetLine({ amount_cents: 500, cost_center_type: "pool", cost_center_key: ga.key })],
    });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "org" })).toBe(500);
    expect(out.warnings.map((w) => w.code)).toContain("no_mtdc");
  });
});
