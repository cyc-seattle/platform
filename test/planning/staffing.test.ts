import { describe, expect, it } from "vitest";
import { computePlan, type PlanData } from "../../src/planning/index.ts";
import {
  A,
  activity,
  blockRule,
  emptyPlan,
  pnlOf,
  nextId,
  offering,
  position,
  product,
  rates,
  staffLevel,
  total,
  trip,
} from "./fixtures.ts";

function onePractice(o: Partial<Parameters<typeof offering>[1]> = {}, extra: Partial<PlanData> = {}) {
  const p = product();
  const level = staffLevel({ hourly_rate_cents: 2500 });
  const off = offering(p.id, { target_enrollment: 13, coach_level_key: level.key, ...o });
  const a = activity(off.id);
  const data = emptyPlan({
    products: [p],
    plan_offerings: [off],
    plan_activities: [a],
    plan_staff_levels: [level],
    ...extra,
  });
  return { p, off, a, level, data };
}

describe("staffing", () => {
  it("staffs one coach per sailors_per_coach, at least min_coaches", () => {
    const { data } = onePractice({ sailors_per_coach: 6, min_coaches: 1 });
    expect(computePlan(data).activities[0]?.coaches).toBe(3);
    const { data: small } = onePractice({ target_enrollment: 2, sailors_per_coach: 6, min_coaches: 2 });
    expect(computePlan(small).activities[0]?.coaches).toBe(2);
  });

  it("takes enrollment from capacity × fill_rate when no target is set", () => {
    const { data } = onePractice({ target_enrollment: null, capacity: 20, fill_rate: 0.6, sailors_per_coach: 4 });
    expect(computePlan(data).activities[0]?.coaches).toBe(3);
  });

  it("prefers the activity's fixed count, then the offering's", () => {
    const { data, a } = onePractice({ sailors_per_coach: 6, fixed_coaches: 4 });
    expect(computePlan(data).activities[0]?.coaches).toBe(4);
    a.fixed_coaches = 1;
    expect(computePlan(data).activities[0]?.coaches).toBe(1);
  });

  it("pays hourly coaches for paid hours at their level's rate", () => {
    const { data, off } = onePractice({ sailors_per_coach: 6 });
    const out = computePlan(data);
    // 3 coaches × 2 h × 2500¢
    expect(total(out, { line: "coach_wages", cost_center_key: off.key })).toBe(15_000);
  });

  it("pays volunteers nothing", () => {
    const { data, level } = onePractice({ sailors_per_coach: 6 });
    level.pay_type = "volunteer";
    const out = computePlan(data);
    expect(total(out, { line: "coach_wages" })).toBe(0);
    expect(out.activities[0]?.coaches).toBe(3);
  });

  it("warns when a level lacks the offering's qualification, accepting one that covers it", () => {
    const { data, level } = onePractice({ sailors_per_coach: 6, required_qualification: "q-instructor" });
    level.qualifications = ["q-senior"];
    expect(computePlan(data).warnings.map((w) => w.code)).toContain("unqualified_level");
    data.qualification_covers = [{ qualification_id: "q-senior", covers_id: "q-instructor" }];
    expect(computePlan(data).warnings.map((w) => w.code)).not.toContain("unqualified_level");
  });

  it("puts RIBs on the water per coach, priced by the RIB resource", () => {
    const { data } = onePractice({ sailors_per_coach: 6, ribs_per_coach: 0.5 });
    data.plan_resources = [
      {
        id: "r1",
        version_id: "v1",
        key: "r1-key",
        resource_kind_id: "kind-rib",
        name: "RIB",
        quantity: 2,
        cost_per_hour_cents: 0,
        cost_per_day_cents: 100,
        fuel_per_hour_cents: 400,
        maintenance_per_hour_cents: 100,
        excluded_from_mtdc: false,
      },
    ];
    const out = computePlan(data);
    expect(out.activities[0]?.ribs).toBe(2);
    // 2 RIBs × (2 h × 500¢ + 100¢)
    expect(total(out, { line: "ribs" })).toBe(2200);
  });

  it("puts sailors on club boats by class, less those who bring their own, and prices maintenance", () => {
    const { data, off } = onePractice({ target_enrollment: 10, byob_share: 0.2 });
    data.boat_classes = [
      { id: "opti", name: "Opti", sailors_per_boat: 1, footprint_sq_ft: null },
      { id: "420", name: "420", sailors_per_boat: 2, footprint_sq_ft: null },
    ];
    data.plan_offering_boat_classes = [
      { id: nextId("obc"), version_id: "v1", key: "k1", offering_id: off.id, boat_class_id: "opti", share: 0.5 },
      { id: nextId("obc"), version_id: "v1", key: "k2", offering_id: off.id, boat_class_id: "420", share: 0.5 },
    ];
    data.plan_boat_rates = [
      {
        id: "br1",
        version_id: "v1",
        key: "br1",
        boat_class_id: "opti",
        maintenance_per_boat_hour_cents: 50,
      },
    ];
    const out = computePlan(data);
    // 8 sailors on club boats: 4 Optis, and 2 420s.
    expect(out.activities[0]?.boats).toBe(6);
    // Only the Opti has a rate: 4 boats × 2 h × 50¢.
    expect(total(out, { line: "boats" })).toBe(400);
  });

  it("warns when a class has no sailors_per_boat", () => {
    const { data, off } = onePractice();
    data.boat_classes = [{ id: "x", name: "X", sailors_per_boat: null, footprint_sq_ft: null }];
    data.plan_offering_boat_classes = [
      { id: "o1", version_id: "v1", key: "o1", offering_id: off.id, boat_class_id: "x", share: 1 },
    ];
    expect(computePlan(data).warnings.map((w) => w.code)).toContain("no_sailors_per_boat");
  });

  it("prices a stored activity's resources", () => {
    const { data, off } = onePractice();
    const a = activity(off.id, { date: "2027-06-05", start_time: "09:00", end_time: "13:00" });
    data.plan_activities = [a];
    data.plan_resources = [
      {
        id: "crane",
        version_id: "v1",
        key: "crane-key",
        resource_kind_id: "kind-crane",
        name: "Crane",
        quantity: 1,
        cost_per_hour_cents: 1000,
        cost_per_day_cents: 500,
        fuel_per_hour_cents: null,
        maintenance_per_hour_cents: null,
        excluded_from_mtdc: false,
      },
    ];
    data.plan_activity_resources = [
      { id: "ar1", version_id: "v1", key: "ar1", activity_id: a.id, resource_key: "crane-key", quantity: 2, hours: 3 },
    ];
    // 2 × (3 h × 1000¢ + 500¢)
    let out = computePlan(data);
    expect(total(out, { line: "resource" })).toBe(7000);
    expect(pnlOf(out, off.key).mtdc_cents).toBe(7000);

    data.plan_resources[0]!.excluded_from_mtdc = true;
    out = computePlan(data);
    expect(total(out, { line: "resource" })).toBe(7000);
    expect(pnlOf(out, off.key).mtdc_cents).toBe(0);
  });

  it("leaves the share of RIB cost from RIBs excluded from MTDC, such as rentals, out of MTDC", () => {
    const { data, off } = onePractice({ sailors_per_coach: 6, ribs_per_coach: 0.5 });
    const rib = (key: string, quantity: number, excluded_from_mtdc: boolean) => ({
      id: key,
      version_id: "v1",
      key,
      resource_kind_id: "kind-rib",
      name: key,
      quantity,
      cost_per_hour_cents: 500,
      cost_per_day_cents: 0,
      fuel_per_hour_cents: null,
      maintenance_per_hour_cents: null,
      excluded_from_mtdc,
    });
    data.plan_resources = [rib("owned", 3, false), rib("rented", 1, true)];
    const out = computePlan(data);
    // 2 RIBs × 2 h × 500¢, a quarter of it rented.
    expect(total(out, { line: "ribs" })).toBe(2000);
    expect(pnlOf(out, off.key).mtdc_cents).toBe(15_000 + 1500);
  });

  it("books a trip's airfare and lodging per coach, and its miles once", () => {
    const { data, off } = onePractice({ fixed_coaches: 2 });
    const t = trip(off.id, { nights: 2, airfare_cents: 30_000, miles: 100 });
    data.plan_trips = [t];
    data.plan_activities.push(activity(off.id, { date: "2027-06-11", kind: "travel", trip_id: t.id }));
    data.plan_rates = [rates({ lodging_per_night_cents: 10_000, mileage_rate_cents: 70 })];
    // 2 × 30000 + 2 × 2 × 10000 + 100 × 70
    expect(total(computePlan(data), { line: "trip", account_id: A.travel })).toBe(107_000);
  });

  describe("activity blocks", () => {
    function block() {
      const p = product();
      const level = staffLevel({ hourly_rate_cents: 2000 });
      const a = offering(p.id, {
        target_enrollment: 5,
        sailors_per_coach: 6,
        coach_level_key: level.key,
        ribs_per_coach: 1,
      });
      const b = offering(p.id, {
        target_enrollment: 5,
        sailors_per_coach: 6,
        coach_level_key: level.key,
        ribs_per_coach: 1,
      });
      const activities = [a, b].map((o) => activity(o.id, { uses_boats: false }));
      const data = emptyPlan({
        products: [p],
        plan_offerings: [a, b],
        plan_activities: activities,
        plan_staff_levels: [level],
        plan_activity_block_rules: [blockRule([a.key, b.key], { weekdays: [2] })],
      });
      return { a, b, data };
    }

    it("staffs the block's sailors together and splits the coaches by enrollment", () => {
      const { data } = block();
      const out = computePlan(data);
      // 10 sailors at 6 per coach need 2 coaches, 1 for each offering's 5.
      expect(out.activities.map((x) => x.coaches)).toEqual([1, 1]);
      data.plan_offerings[0]!.target_enrollment = 4;
      data.plan_offerings[1]!.target_enrollment = 2;
      expect(computePlan(data).activities.map((x) => x.coaches)).toEqual([2 / 3, 1 / 3]);
      data.plan_offerings[0]!.target_enrollment = 3;
      data.plan_offerings[1]!.target_enrollment = 3;
      // Apart, each needs a coach; together, 6 sailors need one.
      expect(computePlan(data).activities.reduce((t, x) => t + x.coaches, 0)).toBe(1);
    });

    it("applies only on its weekdays", () => {
      const { data } = block();
      data.plan_activity_block_rules[0]!.weekdays = [3];
      data.plan_offerings[0]!.target_enrollment = 3;
      data.plan_offerings[1]!.target_enrollment = 3;
      expect(computePlan(data).activities.reduce((t, x) => t + x.coaches, 0)).toBe(2);
    });

    it("fills its first slots with its salaried positions, paying fewer hourly coaches", () => {
      const { data } = block();
      const director = position({ annual_salary_cents: 1_200_000, paid_hours_per_year: 2000 });
      data.plan_salaried_positions = [director];
      data.plan_activity_block_rules[0]!.salaried_positions = [director.key];
      const out = computePlan(data);
      // 2 coaches, 1 salaried: 1 hourly coach × 2 h × 2000¢ across the two offerings.
      expect(total(out, { line: "coach_wages" })).toBe(4000);
      // The director's 2 h at 600¢ an hour go to the offerings; the rest of the salary goes to the org.
      expect(total(out, { line: `salary:${director.key}:coaching` })).toBe(1200);
      expect(total(out, { line: `salary:${director.key}:remainder`, cost_center_type: "org" })).toBe(1_198_800);
    });
  });
});
