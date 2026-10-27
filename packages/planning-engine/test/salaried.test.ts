import { describe, expect, it } from "vitest";
import { computePlan } from "../src/index.ts";
import { A, emptyPlan, metricTotal, offering, pool, poolShare, position, product, total } from "./fixtures.ts";

function booking(
  positionId: string,
  productId: string,
  hours: number,
  window: { starts_on?: string; ends_on?: string } = {},
) {
  return {
    id: `booking-${positionId}-${productId}`,
    version_id: "v1",
    key: `booking-${positionId}-${productId}-key`,
    position_id: positionId,
    product_id: productId,
    starts_on: window.starts_on ?? null,
    ends_on: window.ends_on ?? null,
    kind: "management" as const,
    hours,
  };
}

describe("salaried positions", () => {
  it("books a twelfth of the salary each month it's in effect, to the org with nothing booked", () => {
    const data = emptyPlan({
      plan_salaried_positions: [position({ annual_salary_cents: 600_000, effective_from: "2027-07-01" })],
    });
    const out = computePlan(data);
    expect(total(out, { account_id: A.salaries, cost_center_type: "org" })).toBe(300_000);
    expect(total(out, { month: "2027-06-01" })).toBe(0);
  });

  it("charges management hours at the hourly equivalent to the product's offerings", () => {
    const p = product();
    const o = offering(p.id, { starts_on: "2027-01-01", ends_on: "2027-12-31" });
    const director = position({ annual_salary_cents: 1_200_000, paid_hours_per_year: 2000 });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_salaried_positions: [director],
      plan_salaried_bookings: [booking(director.id, p.id, 120, { starts_on: "2027-03-01", ends_on: "2027-05-31" })],
    });
    const out = computePlan(data);
    // 40 h a month for three months, at 600¢.
    expect(total(out, { line: `salary:${director.key}:management`, cost_center_key: o.key })).toBe(72_000);
    expect(total(out, { line: `salary:${director.key}:remainder` })).toBe(1_200_000 - 72_000);
    expect(metricTotal(out, o.key, "paid_hours")).toBe(120);
    expect(metricTotal(out, o.key, "wages")).toBe(72_000);
  });

  it("keeps ga_share off the top, and scales bookings that overrun the rest", () => {
    const p = product();
    const o = offering(p.id, { starts_on: "2027-01-01", ends_on: "2027-12-31" });
    const director = position({ annual_salary_cents: 1_200_000, paid_hours_per_year: 2000, ga_share: 0.5 });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_salaried_positions: [director],
      // 200 h in January would cost 120000¢; only half of its 100000¢ is free.
      plan_salaried_bookings: [booking(director.id, p.id, 200, { starts_on: "2027-01-01", ends_on: "2027-01-31" })],
    });
    const out = computePlan(data);
    expect(total(out, { line: `salary:${director.key}:management`, month: "2027-01-01" })).toBe(50_000);
    expect(total(out, { line: `salary:${director.key}:remainder`, month: "2027-01-01" })).toBe(50_000);
    expect(out.warnings.map((w) => w.code)).toContain("position_overbooked");
  });

  it("sends the remainder to its pool, which allocates it", () => {
    const p = product();
    const o = offering(p.id, { starts_on: "2027-01-01", ends_on: "2027-12-31", target_enrollment: 1 });
    const admin = pool({ name: "Program admin", method: "fixed_shares" });
    const director = position({ annual_salary_cents: 120_000, remainder_pool_id: admin.id });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_pools: [admin],
      plan_pool_shares: [poolShare(admin.id, o.key, { share: 1 })],
      plan_salaried_positions: [director],
    });
    const out = computePlan(data);
    expect(total(out, { account_id: A.salaries, cost_center_key: o.key })).toBe(120_000);
    expect(total(out, { cost_center_type: "pool" })).toBe(0);
  });
});
