import { describe, expect, it } from "vitest";
import { computePlan } from "../../src/planning/index.ts";
import { activity, emptyPlan, offering, pnlOf, product } from "./fixtures.ts";

function setup(activities: (offeringId: string) => ReturnType<typeof activity>[]) {
  const p = product();
  const o = offering(p.id, { target_enrollment: 6 });
  return { o, out: computePlan(emptyPlan({ products: [p], plan_offerings: [o], plan_activities: activities(o.id) })) };
}

describe("activities", () => {
  it("pays start to end plus setup and put-away, and puts the given minutes on the water", () => {
    const { out } = setup((id) => [
      activity(id, {
        start_time: "16:00",
        end_time: "18:00",
        setup_minutes: 30,
        putaway_minutes: 15,
        on_water_minutes: 90,
      }),
    ]);
    expect(out.activities[0]?.paid_minutes).toBe(165);
    expect(out.activities[0]?.on_water_minutes).toBe(90);
  });

  it("puts the whole span on the water when no on-water minutes are given", () => {
    const { out } = setup((id) => [activity(id)]);
    expect(out.activities[0]?.on_water_minutes).toBe(120);
  });

  it("puts nothing on the water for an activity without boats, or a travel day", () => {
    const { out } = setup((id) => [
      activity(id, { uses_boats: false }),
      activity(id, { date: "2027-06-02", kind: "travel" }),
    ]);
    expect(out.activities.map((a) => a.on_water_minutes)).toEqual([0, 0]);
  });

  it("counts an offering's days: the dates it has an activity other than travel", () => {
    const { o, out } = setup((id) => [
      activity(id, { date: "2027-06-01" }),
      activity(id, { date: "2027-06-01", start_time: "18:00", end_time: "19:00" }),
      activity(id, { date: "2027-06-02" }),
      activity(id, { date: "2027-06-03", kind: "travel" }),
    ]);
    expect(pnlOf(out, o.key).days).toBe(2);
    expect(pnlOf(out, o.key).sailor_days).toBe(12);
  });

  it("leaves out an offering that starts in another plan year", () => {
    const p = product();
    const o = offering(p.id, { starts_on: "2026-12-01", ends_on: "2027-01-31", target_enrollment: 6 });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [o],
      plan_activities: [activity(o.id, { date: "2027-01-05" })],
    });
    expect(computePlan(data).activities).toEqual([]);
  });
});
