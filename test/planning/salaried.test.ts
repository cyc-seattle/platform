import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, offering, pool, position, product, total } from "./fixtures.ts";

function booking(positionId: string, productId: string, hours: number) {
  return {
    id: `booking-${positionId}-${productId}`,
    version_id: "v1",
    key: `booking-${positionId}-${productId}-key`,
    position_id: positionId,
    product_id: productId,
    kind: "management" as const,
    hours,
  };
}

describe("salaried positions", () => {
  it("books the salary to the organization when no hours are charged", () => {
    const data = emptyPlan({ plan_salaried_positions: [position({ annual_salary_cents: 600_000 })] });
    expect(total(computePlan(data), { account_id: A.salaries, cost_center_type: "org" })).toBe(600_000);
  });

  it("charges management hours at the hourly equivalent to the product's offerings", () => {
    const p = product();
    const o = offering(p.id);
    const director = position({ annual_salary_cents: 1_200_000, paid_hours_per_year: 2000 });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_salaried_positions: [director],
      plan_salaried_bookings: [booking(director.id, p.id, 120)],
    });
    const out = computePlan(data);
    // 120 h at 600¢.
    expect(total(out, { line: `salary:${director.key}:management`, cost_center_key: o.key })).toBe(72_000);
    expect(total(out, { line: `salary:${director.key}:remainder` })).toBe(1_200_000 - 72_000);
  });

  it("keeps ga_share off the top, and scales bookings that overrun the rest", () => {
    const p = product();
    const o = offering(p.id);
    const director = position({ annual_salary_cents: 1_200_000, paid_hours_per_year: 2000, ga_share: 0.5 });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_salaried_positions: [director],
      // 1200 h would cost 720000¢; only half of the 1200000¢ salary is free.
      plan_salaried_bookings: [booking(director.id, p.id, 1200)],
    });
    const out = computePlan(data);
    expect(total(out, { line: `salary:${director.key}:management` })).toBe(600_000);
    expect(total(out, { line: `salary:${director.key}:remainder` })).toBe(600_000);
    expect(out.warnings.map((w) => w.code)).toContain("position_overbooked");
  });

  it("sends the rest to its pool, which splits it over the offerings", () => {
    const p = product();
    const o = offering(p.id);
    const admin = pool({ name: "Program admin" });
    const director = position({ annual_salary_cents: 120_000, remainder_pool_id: admin.id });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_pools: [admin],
      plan_salaried_positions: [director],
      plan_budget_lines: [budgetLine({ amount_cents: 1000, cost_center_type: "offering", cost_center_key: o.key })],
    });
    const out = computePlan(data);
    expect(total(out, { account_id: A.salaries, cost_center_key: o.key })).toBe(120_000);
    expect(total(out, { cost_center_type: "pool" })).toBe(0);
  });
});
