import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, laborLine, pnlOf, offering, product, rates, staffLevel, total } from "./fixtures.ts";

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
  it("books a line's amount for the plan year", () => {
    const data = emptyPlan({ plan_budget_lines: [budgetLine({ amount_cents: 120_000 })] });
    const out = computePlan(data);
    expect(out.lines).toHaveLength(1);
    expect(total(out, { cost_center_type: "org", account_id: A.insurance })).toBe(120_000);
  });

  it("skips another fiscal year's lines", () => {
    const data = emptyPlan({ plan_budget_lines: [budgetLine({ amount_cents: 1000, fiscal_year: 2028 })] });
    expect(computePlan(data).lines).toEqual([]);
  });

  it("books a capital purchase as a cost in the year it's bought, outside MTDC when flagged", () => {
    const { spring, data } = twoOfferings();
    data.plan_budget_lines = [
      budgetLine({
        account_id: A.equipment,
        amount_cents: 2_400_000,
        excluded_from_mtdc: true,
        cost_center_type: "offering",
        cost_center_key: spring.key,
      }),
    ];
    const out = computePlan(data);
    expect(total(out, { account_id: A.equipment })).toBe(2_400_000);
    expect(pnlOf(out, spring.key).mtdc_cents).toBe(0);
  });

  it("spreads a product's line to its offerings by MTDC, which leaves out lines excluded from it", () => {
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
        excluded_from_mtdc: true,
      }),
      budgetLine({ amount_cents: 8000, cost_center_type: "product", cost_center_key: p.id }),
    ];
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: spring.key })).toBe(6000);
    expect(total(out, { account_id: A.insurance, cost_center_key: summer.key })).toBe(2000);
    expect(pnlOf(out, summer.key).mtdc_cents).toBe(10_000 + 2000);
  });

  it("keeps a product's line at the product when it has no offering in the year", () => {
    const p = product();
    const data = emptyPlan({
      products: [p],
      plan_budget_lines: [budgetLine({ amount_cents: 1200, cost_center_type: "product", cost_center_key: p.id })],
    });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "product", cost_center_key: p.id })).toBe(1200);
    expect(pnlOf(out, p.id, "product").expense_cents).toBe(1200);
    expect(out.warnings.map((w) => w.code)).toContain("product_without_offerings");
  });

  it("warns about, and skips, a line to a missing cost center", () => {
    const data = emptyPlan({
      plan_budget_lines: [budgetLine({ amount_cents: 100, cost_center_type: "offering", cost_center_key: "nope" })],
    });
    const out = computePlan(data);
    expect(out.lines).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toContain("unknown_cost_center");
  });
});

describe("labor lines", () => {
  it("prices hours at the staff level's rate", () => {
    const { spring, data } = twoOfferings();
    const level = staffLevel({ hourly_rate_cents: 2500 });
    data.plan_staff_levels = [level];
    data.plan_labor_lines = [
      laborLine(level.key, { hours: 40, cost_center_type: "offering", cost_center_key: spring.key }),
    ];
    expect(total(computePlan(data), { line: "labor", cost_center_key: spring.key })).toBe(100_000);
  });
});

describe("payroll tax", () => {
  it("charges the year's rate on every wage, where the wage is booked", () => {
    const { spring, data } = twoOfferings();
    const level = staffLevel({ hourly_rate_cents: 2500 });
    data.plan_staff_levels = [level];
    data.plan_labor_lines = [
      laborLine(level.key, { hours: 40, cost_center_type: "offering", cost_center_key: spring.key }),
      laborLine(level.key, { hours: 10 }),
    ];
    data.plan_budget_lines = [
      budgetLine({ amount_cents: 50_000, cost_center_type: "offering", cost_center_key: spring.key }),
    ];
    data.plan_rates = [rates({ payroll_tax_rate: 0.1 })];
    const out = computePlan(data);
    expect(total(out, { line: "payroll_tax", account_id: A.payrollTax, cost_center_key: spring.key })).toBe(10_000);
    expect(total(out, { line: "payroll_tax", cost_center_type: "org" })).toBe(2500);
    expect(pnlOf(out, spring.key).mtdc_cents).toBe(100_000 + 10_000 + 50_000);
  });
});
