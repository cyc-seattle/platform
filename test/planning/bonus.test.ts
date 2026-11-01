import { describe, expect, it } from "vitest";
import { computePlan, type PlanBonusOwner } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, offering, pool, product, total } from "./fixtures.ts";

function owner(overrides: Partial<PlanBonusOwner> = {}): PlanBonusOwner {
  return {
    id: "owner",
    version_id: "v1",
    key: "owner-key",
    role_name: "Director",
    bonus_rate: 0.1,
    account_id: A.bonus,
    ...overrides,
  };
}

function twoProducts(lossCents: number) {
  const gain = product();
  const loss = product();
  const g = offering(gain.id, { target_enrollment: 10, price_cents: 10_000 });
  const l = offering(loss.id, { target_enrollment: 1, price_cents: 1000 });
  const data = emptyPlan({
    products: [gain, loss],
    plan_offerings: [g, l],
    plan_budget_lines: [
      budgetLine({ account_id: A.rent, amount_cents: lossCents, cost_center_type: "offering", cost_center_key: l.key }),
    ],
    plan_bonus_owners: [owner()],
    plan_bonus_owner_products: [
      { id: "bp1", version_id: "v1", key: "bp1", bonus_owner_id: "owner", product_id: gain.id },
      { id: "bp2", version_id: "v1", key: "bp2", bonus_owner_id: "owner", product_id: loss.id },
    ],
  });
  return { g, l, data };
}

describe("bonus owners", () => {
  it("earns its rate on the combined net, so one product's loss offsets another's gain", () => {
    // Net: 100000 + 1000 − 21000 = 80000.
    const { data } = twoProducts(21_000);
    expect(total(computePlan(data), { line: "bonus", account_id: A.bonus })).toBe(8000);
  });

  it("earns nothing on a combined loss", () => {
    const { data } = twoProducts(200_000);
    expect(total(computePlan(data), { line: "bonus" })).toBe(0);
  });

  it("goes to the owned offerings by revenue", () => {
    const { g, l, data } = twoProducts(1000);
    const out = computePlan(data);
    // 10% of 100000: 100/101 of it to g.
    expect(Math.abs(total(out, { line: "bonus", cost_center_key: g.key }) - 9901)).toBeLessThanOrEqual(1);
    expect(total(out, { line: "bonus" })).toBe(10_000);
    expect(total(out, { line: "bonus", cost_center_key: l.key })).toBeGreaterThan(0);
  });

  it("nets what the pools allocate", () => {
    const { data } = twoProducts(1200);
    const ga = pool();
    data.plan_pools = [ga];
    data.plan_budget_lines.push(
      budgetLine({
        amount_cents: 51_000,
        cost_center_type: "pool",
        cost_center_key: ga.key,
      }),
    );
    // 100000 + 1000 − 1200 − 51000
    expect(total(computePlan(data), { line: "bonus" })).toBe(4880);
  });
});
