import { describe, expect, it } from "vitest";
import { computePlan, type PlanBonusOwner, type PlanData } from "../../src/planning/index.ts";
import {
  A,
  activity,
  area,
  blockRule,
  budgetLine,
  emptyPlan,
  offering,
  pnlOf,
  pool,
  position,
  product,
  rates,
  staffLevel,
  total,
} from "./fixtures.ts";

function owner(overrides: Partial<PlanBonusOwner> = {}): PlanBonusOwner {
  return {
    id: "owner",
    version_id: "v1",
    key: "owner-key",
    role_name: "Director",
    bonus_rate: 0.5,
    account_id: A.bonus,
    basis: null,
    position_key: null,
    ...overrides,
  };
}

function owns(productId: string, ownerId = "owner") {
  return {
    id: `bp-${productId}`,
    version_id: "v1",
    key: `bp-${productId}`,
    bonus_owner_id: ownerId,
    product_id: productId,
  };
}

/** One program with offerings that each take in `revenue` and cost `cost`. */
function programs(rows: { revenue: number; cost: number }[], extra: Partial<PlanData> = {}) {
  const p = product();
  const offerings = rows.map((r) => offering(p.id, { target_enrollment: 1, price_cents: r.revenue }));
  return emptyPlan({
    products: [p],
    plan_offerings: offerings,
    plan_budget_lines: rows.map((r, i) =>
      budgetLine({
        account_id: A.rent,
        amount_cents: r.cost,
        cost_center_type: "offering",
        cost_center_key: offerings[i]!.key,
      }),
    ),
    plan_bonus_owner_products: [owns(p.id)],
    ...extra,
  });
}

describe("bonus bases", () => {
  // Takes in 3000000, costs 2000000, and takes all of a 600000 pool.
  function withPool(basis: "after_shared_costs" | "before_shared_costs" | null) {
    const ga = pool();
    const data = programs([{ revenue: 3_000_000, cost: 2_000_000 }], {
      plan_bonus_owners: [owner({ basis })],
      plan_pools: [ga],
    });
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 600_000, cost_center_type: "pool", cost_center_key: ga.key }),
    );
    return computePlan(data);
  }

  it("counts the net after shared costs by default", () => {
    expect(total(withPool(null), { line: "bonus:" })).toBe(200_000);
  });

  it("counts the net before shared costs when the plan says so", () => {
    expect(total(withPool("before_shared_costs"), { line: "bonus:" })).toBe(500_000);
  });

  it("never counts one bonus in another's base", () => {
    const data = programs([{ revenue: 1_000_000, cost: 0 }], {
      plan_bonus_owners: [owner(), owner({ id: "second", key: "second-key" })],
    });
    data.plan_bonus_owner_products.push(owns(data.products[0]!.id, "second"));
    data.plan_bonus_owner_products[1]!.id = "bp-second";
    const out = computePlan(data);
    expect(total(out, { line: "bonus:owner-key" })).toBe(500_000);
    expect(total(out, { line: "bonus:second-key" })).toBe(500_000);
  });
});

describe("payroll tax on a bonus", () => {
  it("is the year's rate on the bonus, on the same offerings", () => {
    const data = programs([{ revenue: 1_000_000, cost: 0 }], {
      plan_bonus_owners: [owner()],
      plan_rates: [rates({ payroll_tax_rate: 0.1 })],
    });
    const out = computePlan(data);
    expect(total(out, { line: "bonus_payroll_tax:owner-key", account_id: A.payrollTax })).toBe(50_000);
  });

  it("doesn't count toward MTDC", () => {
    const p = product();
    const q = product();
    const ga = pool();
    const first = offering(p.id, { target_enrollment: 1, price_cents: 1_000_000 });
    const second = offering(q.id, { target_enrollment: 1, price_cents: 0 });
    const data = emptyPlan({
      products: [p, q],
      plan_offerings: [first, second],
      plan_pools: [ga],
      plan_rates: [rates({ payroll_tax_rate: 0.1 })],
      plan_bonus_owners: [owner()],
      plan_bonus_owner_products: [owns(p.id)],
      plan_budget_lines: [
        ...[first, second].map((o) =>
          budgetLine({
            account_id: A.rent,
            amount_cents: 100_000,
            cost_center_type: "offering",
            cost_center_key: o.key,
          }),
        ),
        budgetLine({ amount_cents: 100_000, cost_center_type: "pool", cost_center_key: ga.key }),
      ],
    });
    const out = computePlan(data);
    expect(pnlOf(out, first.key).mtdc_cents).toBe(pnlOf(out, second.key).mtdc_cents);
    expect(total(out, { line: "pool:", cost_center_key: first.key })).toBe(50_000);
  });
});

describe("a bonus on an area's plan", () => {
  it("counts only that area's products, and warns about another's", () => {
    const mine = area();
    const theirs = area();
    const own = product({ program_area_id: mine.id });
    const other = product({ program_area_id: theirs.id });
    const data = emptyPlan({
      program_areas: [mine, theirs],
      products: [own, other],
      plans: [{ id: "plan", kind: "program_area", program_area_id: mine.id }],
      plan_versions: [{ id: "v1", plan_id: "plan" }],
      plan_offerings: [
        offering(own.id, { target_enrollment: 1, price_cents: 100_000 }),
        offering(other.id, { target_enrollment: 1, price_cents: 900_000, version_id: "v2" }),
      ],
      plan_bonus_owners: [owner()],
      plan_bonus_owner_products: [owns(own.id), owns(other.id)],
    });
    const out = computePlan(data);
    expect(total(out, { line: "bonus:" })).toBe(50_000);
    expect(out.warnings.map((w) => w.code)).toContain("bonus_outside_area");
  });
});

describe("an offering's salaried coach", () => {
  // 10 practices of 3 hours, one coach, at a 3000¢ level.
  function coached(pay: "salary" | "hourly" | null, extra: Partial<PlanData> = {}) {
    const p = product();
    const level = staffLevel({ hourly_rate_cents: 3000 });
    const coach = position({ name: "Head coach", annual_salary_cents: 2_000_000, paid_hours_per_year: 500 });
    const o = offering(p.id, {
      min_coaches: 1,
      coach_level_key: level.key,
      coach_position_key: coach.key,
      coach_position_pay: pay,
      target_enrollment: 1,
      price_cents: 2_000_000,
    });
    const days = Array.from({ length: 10 }, (_, i) =>
      activity(o.id, { date: `2027-06-${String(i + 1).padStart(2, "0")}`, start_time: "16:00", end_time: "19:00" }),
    );
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_activities: days,
      plan_staff_levels: [level],
      plan_salaried_positions: [coach],
      ...extra,
    });
    return { o, coach, data };
  }

  it("coaches out of their salary by default", () => {
    const { o, coach, data } = coached(null);
    const out = computePlan(data);
    // 30 hours at 4000¢, the salary's hourly equivalent.
    expect(total(out, { line: `salary:${coach.key}:coaching`, cost_center_key: o.key })).toBe(120_000);
    expect(total(out, { account_id: A.coachWages })).toBe(0);
  });

  it("can be paid by the hour, on top of the salary", () => {
    const { o, coach, data } = coached("hourly");
    const out = computePlan(data);
    expect(total(out, { account_id: A.coachWages, cost_center_key: o.key })).toBe(90_000);
    expect(total(out, { line: `salary:${coach.key}:coaching` })).toBe(0);
  });

  it("adds up a position's salary, hourly coaching and bonus", () => {
    const { coach, data } = coached("hourly", { plan_rates: [rates({ payroll_tax_rate: 0.1 })] });
    data.plan_bonus_owners = [owner({ position_key: coach.key, bonus_rate: 0.1 })];
    data.plan_bonus_owner_products = [owns(data.products[0]!.id)];
    const out = computePlan(data);
    const summary = out.positions.find((p) => p.position_key === coach.key);
    // Net: 2000000 − 90000 wages − 9000 tax on them = 1901000; 10% of it.
    expect(summary).toMatchObject({
      salary_cents: 2_000_000,
      hourly_coaching_hours: 30,
      hourly_coaching_cents: 90_000,
      bonus_cents: 190_100,
      total_pay_cents: 2_280_100,
      payroll_tax_cents: 228_010,
    });
  });
});

describe("one salaried coach in two places", () => {
  function twoGroups(first: [string, string], second: [string, string]) {
    const director = position();
    const [p, q] = [product(), product()];
    const a = offering(p.id, { name: "J Pod", min_coaches: 1, coach_position_key: director.key });
    const b = offering(q.id, { name: "K Pod", min_coaches: 1, coach_position_key: director.key });
    return computePlan(
      emptyPlan({
        products: [p, q],
        plan_offerings: [a, b],
        plan_salaried_positions: [director],
        plan_activities: [
          activity(a.id, { start_time: first[0], end_time: first[1] }),
          activity(b.id, { start_time: second[0], end_time: second[1] }),
        ],
      }),
    );
  }

  it("warns when their times overlap", () => {
    expect(twoGroups(["16:00", "19:00"], ["16:00", "19:00"]).warnings.map((w) => w.code)).toContain(
      "position_double_booked",
    );
  });

  it("doesn't warn about a morning and an afternoon", () => {
    expect(twoGroups(["09:00", "12:00"], ["13:00", "16:00"]).warnings.map((w) => w.code)).not.toContain(
      "position_double_booked",
    );
  });
});

describe("blocks compare times", () => {
  // Four sailors each, one coach per eight, sharing on the same day.
  function block(second: [string, string]) {
    const [p, q] = [product(), product()];
    const level = staffLevel({ hourly_rate_cents: 1000 });
    const a = offering(p.id, { target_enrollment: 4, sailors_per_coach: 8, coach_level_key: level.key });
    const b = offering(q.id, { target_enrollment: 4, sailors_per_coach: 8, coach_level_key: level.key });
    const out = computePlan(
      emptyPlan({
        products: [p, q],
        plan_offerings: [a, b],
        plan_staff_levels: [level],
        plan_activity_block_rules: [blockRule([a.key, b.key])],
        plan_activities: [
          activity(a.id, { start_time: "09:00", end_time: "12:00" }),
          activity(b.id, { start_time: second[0], end_time: second[1] }),
        ],
      }),
    );
    return out.activities.map((x) => x.coaches);
  }

  it("shares coaches when the practices overlap", () => {
    expect(block(["09:00", "12:00"])).toEqual([0.5, 0.5]);
  });

  it("doesn't share coaches when they don't", () => {
    expect(block(["13:00", "16:00"])).toEqual([1, 1]);
  });
});

describe("closed dates", () => {
  it("warns about an activity on a day the club is closed, but not a travel day", () => {
    const p = product();
    const o = offering(p.id, { starts_on: "2027-09-01", ends_on: "2027-09-30" });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_closed_dates: [{ id: "c", version_id: "v1", key: "c", date: "2027-09-06", name: "Labor Day" }],
      plan_activities: [activity(o.id, { date: "2027-09-06" })],
    });
    expect(computePlan(data).warnings.map((w) => w.code)).toContain("closed_date");
    data.plan_activities = [activity(o.id, { date: "2027-09-06", kind: "travel" })];
    expect(computePlan(data).warnings.map((w) => w.code)).not.toContain("closed_date");
  });
});
