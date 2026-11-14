import { describe, expect, it } from "vitest";
import { computePlan, type PlanBonusOwner } from "../../src/planning/index.ts";
import { A, area, budgetLine, emptyPlan, offering, pnlOf, pool, product, total } from "./fixtures.ts";

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
  it("earns its rate on the combined net in a season, so one product's loss offsets another's gain", () => {
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

describe("bonuses by season", () => {
  // Summer takes in 200000, fall 10000 and loses 50000 on rent, no season takes in 30000.
  function seasons() {
    const a = area();
    const p = product({ program_area_id: a.id });
    const summer = offering(p.id, { season_term: "summer", target_enrollment: 20, price_cents: 10_000 });
    const fall = offering(p.id, { season_term: "fall", target_enrollment: 1, price_cents: 10_000 });
    const none = offering(p.id, { target_enrollment: 3, price_cents: 10_000 });
    const data = emptyPlan({
      program_areas: [a],
      products: [p],
      plan_offerings: [summer, fall, none],
      plan_budget_lines: [
        budgetLine({
          account_id: A.rent,
          amount_cents: 60_000,
          cost_center_type: "offering",
          cost_center_key: fall.key,
        }),
      ],
      plan_bonus_owners: [owner()],
      plan_bonus_owner_products: [
        { id: "bp1", version_id: "v1", key: "bp1", bonus_owner_id: "owner", product_id: p.id },
      ],
    });
    return { a, summer, fall, none, data };
  }

  it("pays each season on its own net, so a season's loss doesn't lower another's bonus", () => {
    const { a, data } = seasons();
    const out = computePlan(data);
    expect(out.bonuses.map((b) => [b.season, b.net_cents, b.bonus_cents])).toEqual([
      ["summer", 200_000, 20_000],
      ["fall", -50_000, 0],
      [null, 30_000, 3000],
    ]);
    expect(out.bonuses[0]).toMatchObject({ bonus_owner_key: "owner-key", program_area_id: a.id, bonus_rate: 0.1 });
    expect(total(out, { line: "bonus:" })).toBe(23_000);
  });

  it("charges each season's bonus to that season's offerings", () => {
    const { summer, fall, none, data } = seasons();
    const out = computePlan(data);
    expect(total(out, { line: "bonus:", cost_center_key: summer.key })).toBe(20_000);
    expect(total(out, { line: "bonus:", cost_center_key: fall.key })).toBe(0);
    expect(total(out, { line: "bonus:", cost_center_key: none.key })).toBe(3000);
  });

  it("gives a program area a P&L for each season, and one for its offerings in no season", () => {
    const { a, data } = seasons();
    const out = computePlan(data);
    const rows = out.pnl.filter((p) => p.level === "program_area_season" && p.key === a.id);
    expect(rows.map((r) => [r.season, r.revenue_cents, r.net_cents])).toEqual([
      ["summer", 200_000, 180_000],
      ["fall", 10_000, -50_000],
      [null, 30_000, 27_000],
    ]);
    const year = pnlOf(out, a.id, "program_area");
    expect(rows.reduce((t, r) => t + r.net_cents, 0)).toBe(year.net_cents);
  });

  it("puts a cost left on the program area, with no offerings to divide it among, in no season", () => {
    const a = area();
    const out = computePlan(
      emptyPlan({
        program_areas: [a],
        plan_budget_lines: [
          budgetLine({
            account_id: A.rent,
            amount_cents: 5000,
            cost_center_type: "program_area",
            cost_center_key: a.id,
          }),
        ],
      }),
    );
    const rows = out.pnl.filter((p) => p.level === "program_area_season");
    expect(rows.map((r) => [r.season, r.expense_cents])).toEqual([[null, 5000]]);
  });
});
