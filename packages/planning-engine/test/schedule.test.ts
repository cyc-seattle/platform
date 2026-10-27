import { describe, expect, it } from "vitest";
import { computePlan } from "../src/index.ts";
import { activity, emptyPlan, offering, product, rule, trip } from "./fixtures.ts";

function setup() {
  const p = product();
  const o = offering(p.id, { starts_on: "2027-06-01", ends_on: "2027-06-30", target_enrollment: 6 });
  return { p, o };
}

describe("the schedule", () => {
  it("expands a rule on its weekdays inside the offering's dates, less its skip dates", () => {
    const { p, o } = setup();
    // Tuesdays and Thursdays in June 2027, less Thursday the 17th.
    const r = rule(o.id, { weekdays: [2, 4], skip_dates: ["2027-06-17"] });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_schedule_rules: [r] }));
    expect(out.activities.map((a) => a.date)).toEqual([
      "2027-06-01",
      "2027-06-03",
      "2027-06-08",
      "2027-06-10",
      "2027-06-15",
      "2027-06-22",
      "2027-06-24",
      "2027-06-29",
    ]);
  });

  it("narrows to the rule's own dates", () => {
    const { p, o } = setup();
    const r = rule(o.id, { weekdays: [2], starts_on: "2027-06-10", ends_on: "2027-06-23" });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_schedule_rules: [r] }));
    expect(out.activities.map((a) => a.date)).toEqual(["2027-06-15", "2027-06-22"]);
  });

  it("pays setup and put-away, and puts only the on-water fraction on the water", () => {
    const { p, o } = setup();
    const r = rule(o.id, {
      start_time: "16:00",
      end_time: "18:00",
      setup_minutes: 30,
      putaway_minutes: 15,
      on_water_fraction: 0.75,
      starts_on: "2027-06-01",
      ends_on: "2027-06-01",
    });
    const [a] = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_schedule_rules: [r] })).activities;
    expect(a?.paid_minutes).toBe(165);
    expect(a?.on_water_minutes).toBe(90);
  });

  it("puts nothing on the water for a rule that uses no boats", () => {
    const { p, o } = setup();
    const r = rule(o.id, { uses_boats: false, ends_on: "2027-06-01" });
    const [a] = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_schedule_rules: [r] })).activities;
    expect(a?.on_water_minutes).toBe(0);
    expect(a?.uses_boats).toBe(false);
  });

  it("lets an overridden stored activity replace the generated one, and ignores stale copies", () => {
    const { p, o } = setup();
    const r = rule(o.id, { weekdays: [2], ends_on: "2027-06-08" });
    const override = activity(o.id, {
      schedule_rule_id: r.id,
      date: "2027-06-08",
      start_time: "15:00",
      end_time: "19:00",
      kind: "practice",
      fixed_coaches: 3,
      overridden: true,
    });
    const stale = activity(o.id, {
      schedule_rule_id: r.id,
      date: "2027-06-01",
      start_time: "08:00",
      end_time: "20:00",
    });
    const out = computePlan(
      emptyPlan({ products: [p], plan_offerings: [o], plan_schedule_rules: [r], plan_activities: [override, stale] }),
    );
    expect(out.activities).toHaveLength(2);
    expect(out.activities[0]?.paid_minutes).toBe(120);
    expect(out.activities[1]).toMatchObject({
      date: "2027-06-08",
      paid_minutes: 240,
      coaches: 3,
      activity_id: override.id,
    });
  });

  it("keeps a one-off stored activity", () => {
    const { p, o } = setup();
    const oneOff = activity(o.id, { date: "2027-06-05", kind: "clinic" });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_activities: [oneOff] }));
    expect(out.activities).toMatchObject([
      { date: "2027-06-05", kind: "clinic", paid_minutes: 180, on_water_minutes: 180 },
    ]);
  });

  it("generates a trip's travel days, loading on the first day out and unloading on the last day back", () => {
    const { p, o } = setup();
    const t = trip(o.id, {
      starts_on: "2027-06-12",
      ends_on: "2027-06-13",
      pre_travel_days: 2,
      post_travel_days: 1,
      travel_hours_per_day: 5,
      load_minutes: 60,
      unload_minutes: 30,
    });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_trips: [t] }));
    expect(out.activities.map((a) => [a.date, a.kind, a.paid_minutes])).toEqual([
      ["2027-06-10", "travel", 360],
      ["2027-06-11", "travel", 300],
      ["2027-06-14", "travel", 330],
    ]);
  });

  it("loads on the event's first day when there's no travel day", () => {
    const { p, o } = setup();
    const t = trip(o.id, { starts_on: "2027-06-12", ends_on: "2027-06-13", load_minutes: 45, unload_minutes: 45 });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_trips: [t] }));
    expect(out.activities.map((a) => [a.date, a.paid_minutes])).toEqual([
      ["2027-06-12", 45],
      ["2027-06-13", 45],
    ]);
  });
});
