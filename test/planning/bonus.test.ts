import { describe, expect, it } from "vitest";
import { computePlan, type PlanBonusOwner } from "../../src/planning/index.ts";
import { A, area, budgetLine, emptyPlan, offering, pnlOf, pool, product, allocateAll, total } from "./fixtures.ts";

function owner(overrides: Partial<PlanBonusOwner> = {}): PlanBonusOwner {
  return {
    id: "owner",
    plan_id: "v1",
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
      budgetLine({ account_id: A.rent, amount_cents: lossCents, cost_center_type: "offering", cost_center_id: l.id }),
    ],
    plan_bonus_owners: [owner()],
    plan_bonus_owner_products: [
      { id: "bp1", plan_id: "v1", bonus_owner_id: "owner", product_id: gain.id },
      { id: "bp2", plan_id: "v1", bonus_owner_id: "owner", product_id: loss.id },
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
    expect(Math.abs(total(out, { line: "bonus", cost_center_id: g.id }) - 9901)).toBeLessThanOrEqual(1);
    expect(total(out, { line: "bonus" })).toBe(10_000);
    expect(total(out, { line: "bonus", cost_center_id: l.id })).toBeGreaterThan(0);
  });

  it("nets what the pools allocate", () => {
    const { data } = twoProducts(1200);
    const ga = pool();
    data.plan_pools = [ga];
    data.plan_budget_lines.push(
      budgetLine({
        amount_cents: 51_000,
        cost_center_type: "pool",
        cost_center_id: ga.id,
      }),
    );
    // 100000 + 1000 − 1200 − 51000
    expect(total(computePlan(allocateAll(data)), { line: "bonus" })).toBe(4880);
  });
});

describe("bonuses by term", () => {
  // Fall is listed first, but summer starts first. Summer takes in 200000, fall 10000 and loses 50000 on rent, and the
  // offering in no term takes in 30000.
  const fallTerm = {
    id: "fall",
    plan_id: "ops",
    name: "Fall 2027",
    starts_on: "2027-09-01",
    ends_on: "2027-11-30",
  };
  const summerTerm = {
    ...fallTerm,
    id: "summer",
    name: "Summer 2027",
    starts_on: "2027-06-01",
    ends_on: "2027-08-31",
  };
  function terms() {
    const a = area();
    const p = product({ program_area_id: a.id });
    const summer = offering(p.id, { term_id: "summer", target_enrollment: 20, price_cents: 10_000 });
    const fall = offering(p.id, { term_id: "fall", target_enrollment: 1, price_cents: 10_000 });
    const none = offering(p.id, { target_enrollment: 3, price_cents: 10_000 });
    const data = emptyPlan({
      program_areas: [a],
      products: [p],
      plan_terms: [fallTerm, summerTerm],
      plan_offerings: [summer, fall, none],
      plan_budget_lines: [
        budgetLine({
          account_id: A.rent,
          amount_cents: 60_000,
          cost_center_type: "offering",
          cost_center_id: fall.id,
        }),
      ],
      plan_bonus_owners: [owner()],
      plan_bonus_owner_products: [{ id: "bp1", plan_id: "v1", bonus_owner_id: "owner", product_id: p.id }],
    });
    return { a, summer, fall, none, data };
  }

  it("pays each term on its own net, so a term's loss doesn't lower another's bonus", () => {
    const { a, data } = terms();
    const out = computePlan(data);
    expect(out.bonuses.map((b) => [b.term_id, b.net_cents, b.bonus_cents])).toEqual([
      ["summer", 200_000, 20_000],
      ["fall", -50_000, 0],
      [null, 30_000, 3000],
    ]);
    expect(out.bonuses[0]).toMatchObject({ bonus_owner_id: "owner", program_area_id: a.id, bonus_rate: 0.1 });
    expect(total(out, { line: "bonus:" })).toBe(23_000);
  });

  it("charges each term's bonus to that term's offerings", () => {
    const { summer, fall, none, data } = terms();
    const out = computePlan(data);
    expect(total(out, { line: "bonus:", cost_center_id: summer.id })).toBe(20_000);
    expect(total(out, { line: "bonus:", cost_center_id: fall.id })).toBe(0);
    expect(total(out, { line: "bonus:", cost_center_id: none.id })).toBe(3000);
  });

  it("pays a bonus with a term only in that term", () => {
    const { summer, data } = terms();
    data.plan_bonus_owners = [owner({ term_id: "summer" })];
    const out = computePlan(data);
    expect(out.bonuses.map((b) => [b.term_id, b.net_cents, b.bonus_cents])).toEqual([["summer", 200_000, 20_000]]);
    expect(total(out, { line: "bonus:" })).toBe(20_000);
    expect(total(out, { line: "bonus:", cost_center_id: summer.id })).toBe(20_000);
  });

  it("pays nothing in a term with a loss, even when the year makes money", () => {
    const { data } = terms();
    data.plan_bonus_owners = [owner({ term_id: "fall" })];
    const out = computePlan(data);
    expect(out.bonuses.map((b) => [b.term_id, b.net_cents, b.bonus_cents])).toEqual([["fall", -50_000, 0]]);
    expect(total(out, { line: "bonus:" })).toBe(0);
  });

  it("pays nothing, with a warning, when its term isn't in the plan", () => {
    const { data } = terms();
    data.plan_bonus_owners = [owner({ term_id: "winter" })];
    const out = computePlan(data);
    expect(out.bonuses).toEqual([]);
    expect(total(out, { line: "bonus:" })).toBe(0);
    expect(out.warnings.find((w) => w.code === "unknown_bonus_term")).toMatchObject({
      message: "Director's bonus term isn't in the plan, so it isn't paid.",
    });
  });

  it("gives a program area a P&L for each term, in date order, and one for its offerings in no term", () => {
    const { a, data } = terms();
    const out = computePlan(data);
    const rows = out.pnl.filter((p) => p.level === "program_area_term" && p.subject_id === a.id);
    expect(rows.map((r) => [r.term_id, r.revenue_cents, r.net_cents])).toEqual([
      ["summer", 200_000, 180_000],
      ["fall", 10_000, -50_000],
      [null, 30_000, 27_000],
    ]);
    const year = pnlOf(out, a.id, "program_area");
    expect(rows.reduce((t, r) => t + r.net_cents, 0)).toBe(year.net_cents);
  });

  it("counts an offering whose term isn't in the plan as in no term, with a warning", () => {
    const { a, data } = terms();
    data.plan_terms = [summerTerm];
    const out = computePlan(data);
    expect(out.warnings.map((w) => w.code)).toContain("unknown_term");
    const rows = out.pnl.filter((p) => p.level === "program_area_term" && p.subject_id === a.id);
    expect(rows.map((r) => [r.term_id, r.revenue_cents])).toEqual([
      ["summer", 200_000],
      [null, 40_000],
    ]);
  });

  it("puts a cost left on the program area, with no offerings to divide it among, in no term", () => {
    const a = area();
    const out = computePlan(
      emptyPlan({
        program_areas: [a],
        plan_budget_lines: [
          budgetLine({
            account_id: A.rent,
            amount_cents: 5000,
            cost_center_type: "program_area",
            cost_center_id: a.id,
          }),
        ],
      }),
    );
    const rows = out.pnl.filter((p) => p.level === "program_area_term");
    expect(rows.map((r) => [r.term_id, r.expense_cents])).toEqual([[null, 5000]]);
  });
});
