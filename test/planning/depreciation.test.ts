// Every figure here is made up.
import { describe, expect, it } from "vitest";
import {
  computePlan,
  type Boat,
  type BoatClass,
  type BoatStageChange,
  type PlanData,
} from "../../src/planning/index.ts";
import { activity, block, blocks, emptyPlan, offering, pnlOf, product } from "./fixtures.ts";

const opti: BoatClass = { id: "opti", name: "Opti", sailors_per_boat: 1, footprint_sq_ft: null, depreciation_years: 5 };

function boat(overrides: Partial<Boat> = {}): Boat {
  return {
    id: `boat-${Math.random()}`,
    boat_class_id: "opti",
    value_cents: 365_000,
    acquired_on: null,
    in_service_on: "2025-01-01",
    ...overrides,
  };
}

/** Two offerings that sail Optis: the first with 4 boats for 2 h, the second with 2 boats for 2 h. */
function sailed(extra: Partial<PlanData> = {}) {
  const p = product();
  const first = offering(p.id, { target_enrollment: 4 });
  const second = offering(p.id, { target_enrollment: 2 });
  const a = activity(first.id, { date: "2027-06-01" });
  const b = activity(second.id, { date: "2027-06-02" });
  const data = emptyPlan({
    products: [p],
    plan_offerings: [first, second],
    plan_activities: [a, b],
    boat_classes: [opti],
    ...blocks(
      block([a], { boats: [{ boat_class_id: "opti", count: 4 }] }),
      block([b], { boats: [{ boat_class_id: "opti", count: 2, sailor_owned: 3 }] }),
    ),
    ...extra,
  });
  return { p, first, second, data };
}

describe("the boat replacement reserve", () => {
  it("depreciates each boat straight-line over its class's years, and splits it by boat-hours", () => {
    const { p, first, second, data } = sailed({ boats: [boat(), boat()] });
    const out = computePlan(data);
    // 2 boats × 365000¢ ÷ 5 years, split 8 boat-hours to 4
    expect(pnlOf(out, first.key).boat_reserve_cents).toBe(97_333);
    expect(pnlOf(out, second.key).boat_reserve_cents).toBe(48_667);
    expect(pnlOf(out, p.id, "product").boat_reserve_cents).toBe(146_000);
    expect(out.organization.boat_reserve_cents).toBe(146_000);
    expect(out.reserve.map((r) => r.line_name)).toEqual([
      "Boat replacement reserve: Opti",
      "Boat replacement reserve: Opti",
    ]);
  });

  it("stays out of every net and total", () => {
    const { first, data } = sailed({ boats: [boat()] });
    const out = computePlan(data);
    expect(out.lines).toEqual([]);
    expect(pnlOf(out, first.key).net_cents).toBe(0);
    expect(out.organization.operating.net_cents).toBe(0);
    expect(out.organization.total_cents).toBe(0);
  });

  it("counts only the days of the year a boat is in service and worth something, used or not", () => {
    const changes: BoatStageChange[] = [
      { boat_id: "retires", stage: "charter", changed_on: "2025-01-01" },
      { boat_id: "retires", stage: "retired", changed_on: "2027-04-11" },
    ];
    const reserve = (b: Boat, boat_stage_changes: BoatStageChange[] = []) =>
      computePlan(sailed({ boats: [b], boat_stage_changes }).data).organization.boat_reserve_cents;
    // 73000¢ a year, for July 2 to December 31: 183 days
    expect(reserve(boat({ in_service_on: "2027-07-02" }))).toBe(36_600);
    // Acquired, with no in-service date
    expect(reserve(boat({ in_service_on: null, acquired_on: "2027-07-02" }))).toBe(36_600);
    // Retired on April 11: 100 days
    expect(reserve(boat({ id: "retires" }), changes)).toBe(20_000);
    // Worth nothing after July 1, 5 years on: 182 days
    expect(reserve(boat({ in_service_on: "2022-07-02" }))).toBe(36_400);
    expect(reserve(boat({ in_service_on: "2028-01-01" }))).toBe(0);
    expect(reserve(boat({ in_service_on: "2015-01-01" }))).toBe(0);
  });

  it("keeps a class no offering sails on the organization, with a warning", () => {
    const out = computePlan(emptyPlan({ boat_classes: [opti], boats: [boat()] }));
    expect(out.reserve).toEqual([
      expect.objectContaining({ cost_center_type: "org", cost_center_key: null, amount_cents: 73_000 }),
    ]);
    expect(out.organization.boat_reserve_cents).toBe(73_000);
    expect(out.warnings.map((w) => w.message)).toContain(
      "No offering sails CSC's Opti boats this year, so their boat replacement reserve stays with the organization",
    );
  });

  it("warns once about a class with no years, and about a boat with no dates", () => {
    const { data } = sailed({
      boat_classes: [{ ...opti, depreciation_years: null }],
      boats: [boat(), boat()],
    });
    const out = computePlan(data);
    expect(out.reserve).toEqual([]);
    expect(out.warnings.filter((w) => w.code === "no_depreciation_years")).toHaveLength(1);

    const undated = computePlan(sailed({ boats: [boat({ in_service_on: null })] }).data);
    expect(undated.warnings.map((w) => w.code)).toContain("boat_without_date");
    expect(undated.organization.boat_reserve_cents).toBe(0);
  });

  it("is nothing when the boats are left out", () => {
    const out = computePlan(sailed().data);
    expect(out.reserve).toEqual([]);
    expect(out.organization.boat_reserve_cents).toBe(0);
  });
});
