import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import {
  A,
  activity,
  block,
  emptyPlan,
  laborLine,
  offering,
  payrollTax,
  position,
  product,
  staffLevel,
  total,
} from "./fixtures.ts";

function oneOffering() {
  const p = product();
  const o = offering(p.id, { target_enrollment: 10, price_cents: 30_000 });
  return { o, data: emptyPlan({ products: [p], plan_offerings: [o] }) };
}

describe("payroll taxes", () => {
  it("charges each tax as its own line, named for it", () => {
    const { o, data } = oneOffering();
    const level = staffLevel({ hourly_rate_cents: 2500 });
    const social = payrollTax({ name: "Social Security", wage_share: 0.062 });
    const medicare = payrollTax({ name: "Medicare", wage_share: 0.0145 });
    data.plan_staff_levels = [level];
    data.plan_payroll_taxes = [social, medicare];
    data.plan_labor_lines = [
      laborLine(level.staff_level_id, { hours: 40, cost_center_type: "offering", cost_center_key: o.key }),
    ];
    const out = computePlan(data);
    const taxes = out.lines.filter((l) => l.line_key.startsWith("payroll_tax:"));
    expect(taxes.map((l) => [l.line_name, l.amount_cents, l.account_id])).toEqual([
      ["Social Security", 6200, A.payrollTax],
      ["Medicare", 1450, A.payrollTax],
    ]);
  });

  it("charges a tax by the hour on a labor line's hours, but not a volunteer's", () => {
    const { o, data } = oneOffering();
    const paid = staffLevel({ hourly_rate_cents: 2500 });
    const volunteer = staffLevel({ hourly_rate_cents: 0 });
    data.plan_staff_levels = [paid, volunteer];
    data.plan_payroll_taxes = [payrollTax({ name: "L&I", hourly_cents: 45.235 })];
    data.plan_labor_lines = [
      laborLine(paid.staff_level_id, { hours: 40, cost_center_type: "offering", cost_center_key: o.key }),
      laborLine(volunteer.staff_level_id, { hours: 100, cost_center_type: "offering", cost_center_key: o.key }),
    ];
    const out = computePlan(data);
    expect(total(out, { line: "payroll_tax:", cost_center_key: o.key })).toBe(Math.round(40 * 45.235));
  });

  it("charges a tax by the hour on a block's paid staff hours", () => {
    const { o, data } = oneOffering();
    const paid = staffLevel({ hourly_rate_cents: 2000 });
    const volunteer = staffLevel({ hourly_rate_cents: 0 });
    const practice = activity(o.id, { start_time: "16:00", end_time: "18:00" });
    Object.assign(data, {
      plan_activities: [practice],
      plan_staff_levels: [paid, volunteer],
      plan_payroll_taxes: [payrollTax({ name: "L&I", hourly_cents: 50 })],
      ...block([practice], {
        staff: [
          { staff_level_id: paid.staff_level_id, count: 3 },
          { staff_level_id: volunteer.staff_level_id, count: 2 },
        ],
      }),
    });
    const out = computePlan(data);
    expect(total(out, { line: "payroll_tax:", cost_center_key: o.key })).toBe(3 * 2 * 50);
  });

  it("charges a tax by the hour on a salary's paid hours, where its salary goes", () => {
    const { o, data } = oneOffering();
    const director = position({ annual_salary_cents: 1_200_000, paid_hours_per_year: 2000 });
    const practice = activity(o.id, { start_time: "16:00", end_time: "18:00" });
    Object.assign(data, {
      plan_activities: [practice],
      plan_salaried_positions: [director],
      plan_payroll_taxes: [payrollTax({ name: "L&I", hourly_cents: 50 })],
      ...block([practice], { staff: [{ position_key: director.key }] }),
    });
    const out = computePlan(data);
    expect(total(out, { line: "payroll_tax:", cost_center_key: o.key })).toBe(2 * 50);
    expect(total(out, { line: "payroll_tax:", cost_center_type: "org" })).toBe(1998 * 50);
    expect(out.positions[0]?.payroll_tax_cents).toBe(2000 * 50);
  });

  it("warns when a salary has no paid hours to charge a tax by the hour on", () => {
    const { data } = oneOffering();
    data.plan_salaried_positions = [position({ name: "Director", paid_hours_per_year: null })];
    data.plan_payroll_taxes = [payrollTax({ name: "L&I", hourly_cents: 50 })];
    const out = computePlan(data);
    expect(out.warnings).toContainEqual(
      expect.objectContaining({
        code: "no_paid_hours_for_tax",
        message: "Director has no paid hours per year, so L&I isn't charged on its salary",
      }),
    );
    expect(total(out, { line: "payroll_tax:" })).toBe(0);
  });

  it("leaves out a tax with both a share of wages and an amount an hour, or neither, and says so", () => {
    const { o, data } = oneOffering();
    const level = staffLevel({ hourly_rate_cents: 2500 });
    data.plan_staff_levels = [level];
    data.plan_payroll_taxes = [
      payrollTax({ name: "Both", wage_share: 0.1, hourly_cents: 50 }),
      payrollTax({ name: "Neither", wage_share: null }),
    ];
    data.plan_labor_lines = [
      laborLine(level.staff_level_id, { hours: 40, cost_center_type: "offering", cost_center_key: o.key }),
    ];
    const out = computePlan(data);
    expect(total(out, { line: "payroll_tax:" })).toBe(0);
    expect(out.warnings.filter((w) => w.code === "payroll_tax_basis").map((w) => w.message)).toEqual([
      "Both needs a share of wages or an amount an hour, but not both, so it's left out",
      "Neither needs a share of wages or an amount an hour, but not both, so it's left out",
    ]);
  });
});
