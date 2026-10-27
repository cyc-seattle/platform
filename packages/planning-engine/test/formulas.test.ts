import { describe, expect, it } from "vitest";
import { computePlan, EngineError, type PlanAssumption } from "../src/index.ts";
import {
  A,
  budgetLine,
  emptyPlan,
  formula,
  metricTotal,
  offering,
  product,
  rule,
  staffLevel,
  total,
} from "./fixtures.ts";

function assumption(name: string, value: number, effective_from: string | null = null): PlanAssumption {
  return {
    id: `a-${name}-${effective_from}`,
    version_id: "v1",
    key: `a-${name}-${effective_from}`,
    name,
    value,
    unit: null,
    effective_from,
    note: null,
  };
}

function coached() {
  const p = product();
  const level = staffLevel({ hourly_rate_cents: 2000 });
  const o = offering(p.id, { target_enrollment: 6, sailors_per_coach: 6, coach_level_key: level.key });
  const data = emptyPlan({
    products: [p],
    plan_offerings: [o],
    plan_schedule_rules: [rule(o.id, { starts_on: "2027-06-01", ends_on: "2027-06-01", uses_boats: false })],
    plan_staff_levels: [level],
  });
  return { p, o, data };
}

describe("formulas", () => {
  it("books a per-offering formula, such as payroll tax on wages, into the offering's MTDC", () => {
    const { o, data } = coached();
    data.plan_assumptions = [assumption("payroll_tax_rate", 0.1)];
    data.plan_formulas = [
      formula({
        name: "payroll_tax",
        dimension: "offering",
        expression: "wages * payroll_tax_rate",
        account_id: A.payrollTax,
      }),
    ];
    const out = computePlan(data);
    // 1 coach × 2 h × 2000¢ = 4000¢ of wages.
    expect(total(out, { account_id: A.payrollTax, cost_center_key: o.key })).toBe(400);
    expect(metricTotal(out, o.key, "mtdc")).toBe(4400);
  });

  it("keeps an excluded formula out of MTDC", () => {
    const { o, data } = coached();
    data.plan_formulas = [
      formula({
        name: "fee",
        dimension: "offering",
        expression: "100",
        account_id: A.insurance,
        excluded_from_base: true,
      }),
    ];
    expect(metricTotal(computePlan(data), o.key, "mtdc")).toBe(4000);
  });

  it("reads assumptions in effect in each month", () => {
    const data = emptyPlan({
      plan_assumptions: [assumption("rent", 1000), assumption("rent", 2000, "2027-07-01")],
      plan_formulas: [formula({ name: "monthly_rent", dimension: "month", expression: "rent", account_id: A.rent })],
    });
    const out = computePlan(data);
    expect(total(out, { month: "2027-06-01" })).toBe(1000);
    expect(total(out, { month: "2027-07-01" })).toBe(2000);
    expect(total(out)).toBe(18_000);
  });

  it("chains formulas in dependency order, and lets a line read a formula of assumptions", () => {
    const data = emptyPlan({
      plan_assumptions: [assumption("boats", 10)],
      plan_formulas: [
        formula({ name: "insured_value", expression: "fleet * 2" }),
        formula({ name: "fleet", expression: "boats * 500" }),
      ],
      plan_budget_lines: [budgetLine({ amount_cents: null, formula: "insured_value / 100" })],
    });
    expect(total(computePlan(data))).toBe(100);
  });

  it("books a none formula evenly over the year to the org", () => {
    const data = emptyPlan({
      plan_formulas: [formula({ name: "audit", expression: "12000", account_id: A.insurance })],
    });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "org", month: "2027-03-01" })).toBe(1000);
  });

  it("evaluates a product formula over the product's offerings and spreads it by MTDC", () => {
    const { p, o, data } = coached();
    data.plan_formulas = [
      formula({
        name: "per_head",
        dimension: "product",
        expression: "enrollment * 50",
        account_id: A.insurance,
        applies_to_filter: { product_ids: [p.id] },
      }),
    ];
    expect(total(computePlan(data), { line: "formula", cost_center_key: o.key })).toBe(300);
  });

  it("applies only to offerings its filter matches", () => {
    const { o, data } = coached();
    data.plan_formulas = [
      formula({
        name: "fee",
        dimension: "offering",
        expression: "100",
        account_id: A.insurance,
        applies_to_filter: { exclude_offering_keys: [o.key] },
      }),
    ];
    expect(total(computePlan(data), { line: "formula" })).toBe(0);
  });

  it("rejects a cycle, an unknown name, and a read across dimensions", () => {
    const cycle = emptyPlan({
      plan_formulas: [formula({ name: "a", expression: "b + 1" }), formula({ name: "b", expression: "a + 1" })],
    });
    expect(() => computePlan(cycle)).toThrow(/cycle/);
    const unknown = emptyPlan({ plan_formulas: [formula({ name: "a", expression: "nothing" })] });
    expect(() => computePlan(unknown)).toThrow(EngineError);
    const across = emptyPlan({
      plan_formulas: [
        formula({ name: "per_offering", dimension: "offering", expression: "1" }),
        formula({ name: "yearly", dimension: "none", expression: "per_offering" }),
      ],
    });
    expect(() => computePlan(across)).toThrow(/can't read/);
  });

  it("warns when plan_formula_deps doesn't list what a formula reads", () => {
    const data = emptyPlan({
      plan_assumptions: [assumption("x", 1)],
      plan_formulas: [formula({ name: "a", expression: "x" })],
    });
    expect(computePlan(data).warnings.map((w) => w.code)).toContain("undeclared_formula_deps");
  });
});
