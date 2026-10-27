import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, offering, pool, product, total } from "./fixtures.ts";

function twoOfferings() {
  const p = product();
  const charters = product({ kind: "charter" });
  const big = offering(p.id);
  const small = offering(charters.id);
  const data = emptyPlan({
    products: [p, charters],
    plan_offerings: [big, small],
    plan_budget_lines: [
      budgetLine({ account_id: A.rent, amount_cents: 30_000, cost_center_type: "offering", cost_center_key: big.key }),
      budgetLine({
        account_id: A.rent,
        amount_cents: 10_000,
        cost_center_type: "offering",
        cost_center_key: small.key,
      }),
    ],
  });
  return { big, small, data };
}

describe("pools", () => {
  it("splits a pool over every offering by MTDC, keeping its accounts", () => {
    const { big, small, data } = twoOfferings();
    const ga = pool();
    data.plan_pools = [ga];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 12_000, cost_center_type: "pool", cost_center_key: ga.key }),
    );
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: big.key })).toBe(9000);
    expect(total(out, { account_id: A.insurance, cost_center_key: small.key })).toBe(3000);
    expect(total(out, { line: `pool:${ga.key}:budget` })).toBe(12_000);
    expect(total(out, { cost_center_type: "pool" })).toBe(0);
  });

  it("counts no pool's split in another pool's base", () => {
    const { big, data } = twoOfferings();
    const first = pool({ name: "First" });
    const second = pool({ name: "Second" });
    data.plan_pools = [first, second];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 1_000_000, cost_center_type: "pool", cost_center_key: first.key }),
      budgetLine({ amount_cents: 1000, cost_center_type: "pool", cost_center_key: second.key }),
    );
    expect(total(computePlan(data), { line: `pool:${second.key}`, cost_center_key: big.key })).toBe(750);
  });

  it("leaves a pool with the organization when no offering has MTDC", () => {
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
