import { describe, expect, it } from "vitest";
import { computePlan, type Account, type PlanData } from "../../src/planning/index.ts";
import { A, area, budgetLine, emptyPlan, offering, pnlOf, position, product, total } from "./fixtures.ts";

const capitalAccount: Account = {
  id: "acct-boats-owned",
  number: "1500",
  name: "Equipment",
  type: "asset",
  form_990_part: null,
  form_990_line: null,
  default_function: null,
  parent_id: null,
  contra_account_id: null,
  retired: false,
};
const donations: Account = { ...capitalAccount, id: "acct-donations", number: "4500", type: "revenue" };

/** A program area with two programs, each with one offering whose direct costs are `costs` cents. */
function twoOfferings(costs: readonly [number, number]) {
  const summer = area({ id: "summer" });
  const products = [0, 1].map((i) => product({ id: `p${i}`, program_area_id: summer.id }));
  const offerings = products.map((p, i) =>
    offering(p.id, { key: `o${i}`, target_enrollment: 10, price_cents: 100_000 }),
  );
  const direct = offerings.map((o, i) =>
    budgetLine({ cost_center_type: "offering", cost_center_key: o.key, amount_cents: costs[i] ?? 0 }),
  );
  const data = emptyPlan({
    program_areas: [summer],
    products,
    plan_offerings: offerings,
    plan_budget_lines: direct,
  });
  return { summer, products, offerings, data };
}

describe("program areas", () => {
  it("divide a cost charged to the area among its offerings by MTDC", () => {
    const { summer, data } = twoOfferings([200_000, 100_000]);
    data.plan_budget_lines.push(
      budgetLine({
        key: "storage",
        account_id: A.rent,
        cost_center_type: "program_area",
        cost_center_key: summer.id,
        amount_cents: 300_000,
        excluded_from_mtdc: true,
      }),
    );
    const out = computePlan(data);
    expect(total(out, { line: "budget:storage", cost_center_key: "o0" })).toBe(200_000);
    expect(total(out, { line: "budget:storage", cost_center_key: "o1" })).toBe(100_000);
  });

  it("give each area a P&L that adds up its offerings", () => {
    const { summer, data } = twoOfferings([100_000, 100_000]);
    data.plan_budget_lines.push(
      budgetLine({ account_id: A.rent, cost_center_type: "program_area", cost_center_key: summer.id, amount_cents: 1 }),
    );
    const out = computePlan(data);
    const pnl = pnlOf(out, summer.id, "program_area");
    expect(pnl.revenue_cents).toBe(2_000_000);
    expect(pnl.expense_cents).toBe(200_001);
    expect(pnl.enrollment).toBe(20);
  });

  it("keep a cost on an area with no offerings, and warn", () => {
    const empty = area();
    const data = emptyPlan({
      program_areas: [empty],
      plan_budget_lines: [
        budgetLine({ cost_center_type: "program_area", cost_center_key: empty.id, amount_cents: 5_000 }),
      ],
    });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "program_area", cost_center_key: empty.id })).toBe(5_000);
    expect(out.warnings.map((w) => w.code)).toContain("program_area_without_offerings");
  });

  it("share a salaried booking on the area among its offerings", () => {
    const { summer, data } = twoOfferings([100_000, 100_000]);
    const director = position({ annual_salary_cents: 10_000_000, paid_hours_per_year: 2000 });
    data.plan_salaried_positions = [director];
    data.plan_salaried_bookings = [
      {
        id: "b",
        version_id: "v1",
        key: "b",
        position_id: director.id,
        product_id: null,
        program_area_id: summer.id,
        kind: "management",
        hours: 100,
      },
    ];
    const out = computePlan(data);
    for (const key of ["o0", "o1"]) {
      expect(total(out, { line: `salary:${director.key}:management`, cost_center_key: key })).toBe(250_000);
    }
  });

  it("leave out a booking that names both a product and an area, and warn", () => {
    const { summer, products, data } = twoOfferings([100_000, 100_000]);
    const director = position();
    data.plan_salaried_positions = [director];
    data.plan_salaried_bookings = [
      {
        id: "b",
        version_id: "v1",
        key: "b",
        position_id: director.id,
        product_id: products[0]!.id,
        program_area_id: summer.id,
        kind: "management",
        hours: 100,
      },
    ];
    const out = computePlan(data);
    expect(out.warnings.map((w) => w.code)).toContain("booking_cost_center");
    expect(total(out, { line: `salary:${director.key}:management` })).toBe(0);
  });
});

describe("the plans an offering belongs in", () => {
  function plans(data: PlanData, kind: "program_area" | "operations", areaId: string | null) {
    data.plans = [{ id: "plan", kind, program_area_id: areaId }];
    data.plan_versions = [{ id: "v1", plan_id: "plan" }];
  }

  it("warn about a program in another area's plan", () => {
    const { data } = twoOfferings([0, 0]);
    plans(data, "program_area", "winter");
    expect(computePlan(data).warnings.map((w) => w.code)).toContain("offering_in_wrong_plan");
    plans(data, "program_area", "summer");
    expect(computePlan(data).warnings).toEqual([]);
  });

  it("warn about a program in the Operations Plan, but not merchandise", () => {
    const { data } = twoOfferings([0, 0]);
    plans(data, "operations", null);
    expect(computePlan(data).warnings.map((w) => w.code)).toContain("offering_in_wrong_plan");
    const merch = product({ id: "merch", kind: "merchandise" });
    const data2 = emptyPlan({
      products: [merch],
      plan_offerings: [offering(merch.id, { target_enrollment: 1, price_cents: 100 })],
    });
    plans(data2, "operations", null);
    expect(computePlan(data2).warnings).toEqual([]);
  });

  it("warn about a program with no area, and an area on another kind of product", () => {
    const p = product();
    const m = product({ kind: "merchandise", program_area_id: "summer" });
    const data = emptyPlan({
      program_areas: [area({ id: "summer" })],
      products: [p, m],
      plan_offerings: [offering(p.id), offering(m.id)],
    });
    expect(computePlan(data).warnings.map((w) => w.code)).toEqual(["program_without_area", "area_on_non_program"]);
  });
});

describe("the organization's totals", () => {
  it("show operating net, then fundraising and capital, then the total", () => {
    const p = product();
    const data = emptyPlan({
      accounts: [...emptyPlan().accounts, capitalAccount, donations],
      products: [p],
      plan_offerings: [offering(p.id, { key: "o", target_enrollment: 10, price_cents: 1_000_000 })],
      plan_budget_lines: [
        budgetLine({ cost_center_type: "offering", cost_center_key: "o", amount_cents: 9_000_000 }),
        budgetLine({ account_id: donations.id, function: "fundraising", amount_cents: 3_000_000 }),
        budgetLine({ account_id: A.insurance, function: "fundraising", amount_cents: 500_000 }),
        budgetLine({ account_id: capitalAccount.id, amount_cents: 2_000_000 }),
      ],
    });
    expect(computePlan(data).organization).toEqual({
      operating: { revenue_cents: 10_000_000, expense_cents: 9_000_000, net_cents: 1_000_000 },
      fundraising: { revenue_cents: 3_000_000, expense_cents: 500_000, net_cents: 2_500_000 },
      capital_cents: 2_000_000,
      total_cents: 1_500_000,
    });
  });

  it("move capital charged to a program area to the organization, and warn", () => {
    const { summer, data } = twoOfferings([100_000, 100_000]);
    data.accounts.push(capitalAccount);
    data.plan_budget_lines.push(
      budgetLine({
        account_id: capitalAccount.id,
        cost_center_type: "program_area",
        cost_center_key: summer.id,
        amount_cents: 2_000_000,
      }),
    );
    const out = computePlan(data);
    expect(total(out, { account_id: capitalAccount.id, cost_center_type: "org" })).toBe(2_000_000);
    expect(pnlOf(out, summer.id, "program_area").by_account.map((a) => a.account_id)).not.toContain(capitalAccount.id);
    expect(out.organization.capital_cents).toBe(2_000_000);
    expect(out.warnings.map((w) => w.code)).toContain("capital_off_org");
  });
});
