import { describe, expect, it } from "vitest";
import { computePlan } from "../src/index.ts";
import { A, budgetLine, emptyPlan, laborLine, metricTotal, offering, product, staffLevel, total } from "./fixtures.ts";

function twoOfferings() {
  const p = product();
  const spring = offering(p.id, {
    starts_on: "2027-04-01",
    ends_on: "2027-05-31",
    target_enrollment: 10,
    price_cents: 30_000,
  });
  const summer = offering(p.id, {
    starts_on: "2027-06-01",
    ends_on: "2027-08-31",
    target_enrollment: 10,
    price_cents: 10_000,
  });
  return { p, spring, summer, data: emptyPlan({ products: [p], plan_offerings: [spring, summer] }) };
}

describe("budget lines", () => {
  it("splits an annual amount evenly over the fiscal year by default", () => {
    const data = emptyPlan({ plan_budget_lines: [budgetLine({ amount_cents: 120_000 })] });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "org", account_id: A.insurance })).toBe(120_000);
    expect(total(out, { month: "2027-02-01" })).toBe(10_000);
  });

  it("phases an annual split by its shares", () => {
    const data = emptyPlan({
      plan_budget_lines: [
        budgetLine({
          amount_cents: 100_000,
          phasing_mode: "annual_split",
          phasing: { "2027-01": 0.75, "2027-07": 0.25 },
        }),
      ],
    });
    const out = computePlan(data);
    expect(total(out, { month: "2027-01-01" })).toBe(75_000);
    expect(total(out, { month: "2027-07-01" })).toBe(25_000);
  });

  it("books a monthly rate in each month named", () => {
    const data = emptyPlan({
      plan_budget_lines: [budgetLine({ phasing_mode: "monthly_rate", phasing: { "2027-06": 5000, "2027-07": 7000 } })],
    });
    expect(total(computePlan(data))).toBe(12_000);
  });

  it("skips another fiscal year's lines", () => {
    const data = emptyPlan({ plan_budget_lines: [budgetLine({ amount_cents: 1000, fiscal_year: 2028 })] });
    expect(computePlan(data).plan_results).toEqual([]);
  });

  it("evaluates a line's formula against the assumptions", () => {
    const data = emptyPlan({
      plan_budget_lines: [budgetLine({ amount_cents: null, formula: "boats * per_boat" })],
      plan_assumptions: [
        {
          id: "a1",
          version_id: "v1",
          key: "a1",
          name: "boats",
          value: 12,
          unit: null,
          effective_from: null,
          note: null,
        },
        {
          id: "a2",
          version_id: "v1",
          key: "a2",
          name: "per_boat",
          value: 1000,
          unit: "cents",
          effective_from: null,
          note: null,
        },
      ],
    });
    expect(total(computePlan(data))).toBe(12_000);
  });

  it("keeps non-cash lines off the cash basis, and capital lines off accrual", () => {
    const data = emptyPlan({
      plan_budget_lines: [
        budgetLine({ account_id: A.depreciation, amount_cents: 12_000, is_non_cash: true }),
        budgetLine({ account_id: A.equipment, amount_cents: 24_000, is_capital: true }),
      ],
    });
    const out = computePlan(data);
    expect(total(out, { account_id: A.depreciation })).toBe(12_000);
    expect(total(out, { account_id: A.depreciation, basis: "cash" })).toBe(0);
    expect(total(out, { account_id: A.equipment })).toBe(0);
    expect(total(out, { account_id: A.equipment, basis: "cash" })).toBe(24_000);
  });

  it("spreads a product's line to its offerings by months, revenue, or evenly", () => {
    const { p, spring, summer, data } = twoOfferings();
    const line = budgetLine({
      amount_cents: 50_000,
      cost_center_type: "product",
      cost_center_key: p.id,
      spread: "by_months",
    });
    data.plan_budget_lines = [line];
    let out = computePlan(data);
    expect(total(out, { line: "budget", cost_center_key: spring.key })).toBe(20_000);
    expect(total(out, { line: "budget", cost_center_key: summer.key })).toBe(30_000);

    line.spread = "by_revenue";
    out = computePlan(data);
    expect(total(out, { line: "budget", cost_center_key: spring.key })).toBe(37_500);

    line.spread = "even";
    out = computePlan(data);
    expect(total(out, { line: "budget", cost_center_key: summer.key })).toBe(25_000);
  });

  it("spreads by MTDC, which leaves out participant support", () => {
    const { p, spring, summer, data } = twoOfferings();
    data.plan_budget_lines = [
      budgetLine({
        account_id: A.rent,
        amount_cents: 30_000,
        cost_center_type: "offering",
        cost_center_key: spring.key,
      }),
      budgetLine({
        account_id: A.rent,
        amount_cents: 10_000,
        cost_center_type: "offering",
        cost_center_key: summer.key,
      }),
      budgetLine({
        account_id: A.scholarships,
        amount_cents: 90_000,
        cost_center_type: "offering",
        cost_center_key: summer.key,
        is_participant_support: true,
      }),
      budgetLine({ amount_cents: 8000, cost_center_type: "product", cost_center_key: p.id, spread: "by_mtdc" }),
    ];
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: spring.key })).toBe(6000);
    expect(total(out, { account_id: A.insurance, cost_center_key: summer.key })).toBe(2000);
    expect(metricTotal(out, summer.key, "mtdc")).toBeCloseTo(10_000 + 2000);
  });

  it("keeps a product's line at the product when it has no offering in the year", () => {
    const p = product();
    const data = emptyPlan({
      products: [p],
      plan_budget_lines: [budgetLine({ amount_cents: 1200, cost_center_type: "product", cost_center_key: p.id })],
    });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "product", cost_center_key: p.id })).toBe(1200);
    expect(out.warnings.map((w) => w.code)).toContain("product_without_offerings");
  });

  it("warns about, and skips, a line to a missing cost center", () => {
    const data = emptyPlan({
      plan_budget_lines: [budgetLine({ amount_cents: 100, cost_center_type: "offering", cost_center_key: "nope" })],
    });
    const out = computePlan(data);
    expect(out.plan_results).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toContain("unknown_cost_center");
  });
});

describe("labor lines", () => {
  it("prices hours at the staff level's rate in each month, counting them as wages", () => {
    const { spring, data } = twoOfferings();
    const level = staffLevel({ hourly_rate_cents: 2000 });
    data.plan_staff_levels = [
      level,
      staffLevel({ name: level.name, hourly_rate_cents: 3000, effective_from: "2027-05-01" }),
    ];
    data.plan_labor_lines = [
      laborLine(level.key, {
        hours: 40,
        cost_center_type: "offering",
        cost_center_key: spring.key,
        phasing: { "2027-04": 0.5, "2027-05": 0.5 },
      }),
    ];
    const out = computePlan(data);
    // 20 h × 2000¢ in April, 20 h × 3000¢ in May.
    expect(total(out, { line: "labor", month: "2027-04-01" })).toBe(40_000);
    expect(total(out, { line: "labor", month: "2027-05-01" })).toBe(60_000);
    expect(metricTotal(out, spring.key, "wages")).toBe(100_000);
    expect(metricTotal(out, spring.key, "paid_hours")).toBe(40);
  });

  it("takes hours from hours_formula", () => {
    const level = staffLevel({ hourly_rate_cents: 1000 });
    const data = emptyPlan({
      plan_staff_levels: [level],
      plan_labor_lines: [laborLine(level.key, { hours: null, hours_formula: "weeks * 40" })],
      plan_assumptions: [
        {
          id: "a1",
          version_id: "v1",
          key: "a1",
          name: "weeks",
          value: 3,
          unit: null,
          effective_from: null,
          note: null,
        },
      ],
    });
    expect(total(computePlan(data), { line: "labor" })).toBe(120_000);
  });
});
