import { describe, expect, it } from "vitest";
import { computePlan, type PlanData, type PlanResource } from "../../src/planning/index.ts";
import {
  A,
  activity,
  block,
  blocks,
  emptyPlan,
  pnlOf,
  offering,
  position,
  product,
  program,
  rates,
  staffLevel,
  total,
  trip,
  type Given,
} from "./fixtures.ts";

const codes = (data: PlanData) => computePlan(data).warnings.map((w) => w.code);

function resource(key: string, overrides: Partial<PlanResource> = {}): PlanResource {
  return {
    id: key,
    version_id: "v1",
    key,
    resource_kind_id: "kind-rib",
    name: key,
    quantity: null,
    cost_per_hour_cents: null,
    cost_per_day_cents: null,
    fuel_per_hour_cents: null,
    maintenance_per_hour_cents: null,
    excluded_from_mtdc: false,
    ...overrides,
  };
}

/** One offering of 13 sailors with one practice, 4pm to 6pm, in a block given `given`. */
function onePractice(given: Given = {}, extra: Partial<PlanData> = {}) {
  const p = product();
  const off = offering(p.id, { target_enrollment: 13 });
  const a = activity(off.id);
  const data = emptyPlan({
    products: [p],
    plan_offerings: [off],
    plan_activities: [a],
    ...block([a], given),
    ...extra,
  });
  return { p, off, a, data };
}

describe("staffing", () => {
  it("pays a block's staff for its paid hours at their level's rate", () => {
    const level = staffLevel({ hourly_rate_cents: 2500 });
    const { data, off } = onePractice(
      { staff: [{ staff_level_key: level.key, count: 3 }] },
      { plan_staff_levels: [level] },
    );
    const out = computePlan(data);
    // 3 staff × 2 h × 2500¢
    expect(total(out, { line: "coach_wages", cost_center_key: off.key })).toBe(15_000);
    expect(out.activities[0]?.coaches).toBe(3);
  });

  it("pays volunteers nothing", () => {
    const level = staffLevel({ pay_type: "volunteer" });
    const { data } = onePractice({ staff: [{ staff_level_key: level.key, count: 2 }] }, { plan_staff_levels: [level] });
    const out = computePlan(data);
    expect(total(out, { line: "coach_wages" })).toBe(0);
    expect(out.activities[0]?.coaches).toBe(2);
  });

  it("costs nothing an activity isn't given, and warns that it has no staff", () => {
    const p = product();
    const off = offering(p.id, { target_enrollment: 13 });
    const a = activity(off.id, { date: "2027-08-02" });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [off], plan_activities: [a] }));
    expect(out.lines.filter((l) => l.line_key.startsWith("coach_wages"))).toEqual([]);
    expect(out.warnings).toContainEqual(
      expect.objectContaining({
        code: "unallocated_activity",
        category: "allocation",
        version_id: "v1",
        date: "2027-08-02",
        key: a.key,
      }),
    );
  });

  it("warns about an activity in a block with no staff, but not about a travel day", () => {
    const level = staffLevel();
    const { data, off } = onePractice({ boats: [{ boat_class_id: "opti", count: 1 }] });
    expect(codes(data)).toContain("unallocated_activity");
    const t = trip(off.id);
    data.plan_trips = [t];
    data.plan_activities = [activity(off.id, { kind: "travel", trip_id: t.id })];
    data.plan_staff_levels = [level];
    expect(codes(data)).not.toContain("unallocated_activity");
  });

  it("runs a block from its first start to its last end, plus its longest setup and put-away", () => {
    const p = product();
    const level = staffLevel({ hourly_rate_cents: 2000 });
    const [x, y] = [offering(p.id, { target_enrollment: 5 }), offering(p.id, { target_enrollment: 5 })];
    const ax = activity(x.id, { start_time: "09:00", end_time: "11:00", setup_minutes: 30 });
    const ay = activity(y.id, { start_time: "10:00", end_time: "12:00", setup_minutes: 15, putaway_minutes: 30 });
    const out = computePlan(
      emptyPlan({
        products: [p],
        plan_offerings: [x, y],
        plan_activities: [ax, ay],
        plan_staff_levels: [level],
        ...block([ax, ay], { staff: [{ staff_level_key: level.key }] }),
      }),
    );
    // 1 coach × (3 h + 30 min + 30 min) × 2000¢
    expect(total(out, { line: "coach_wages" })).toBe(8000);
  });

  it("splits a block's costs among its offerings by their sailors, from capacity × fill_rate if no target", () => {
    const p = product();
    const level = staffLevel({ hourly_rate_cents: 2000 });
    const x = offering(p.id, { target_enrollment: 6 });
    const y = offering(p.id, { target_enrollment: null, capacity: 10, fill_rate: 0.4 });
    const [ax, ay] = [
      activity(x.id, { start_time: "09:00", end_time: "12:00" }),
      activity(y.id, { start_time: "09:00", end_time: "12:00" }),
    ];
    const out = computePlan(
      emptyPlan({
        products: [p],
        plan_offerings: [x, y],
        plan_activities: [ax, ay],
        plan_staff_levels: [level],
        ...block([ax, ay], { staff: [{ staff_level_key: level.key }] }),
      }),
    );
    expect(total(out, { line: "coach_wages", cost_center_key: x.key })).toBe(3600);
    expect(total(out, { line: "coach_wages", cost_center_key: y.key })).toBe(2400);
    expect(out.activities.map((a) => a.coaches)).toEqual([0.6, 0.4]);
  });

  it("counts an offering's sailors once in a block, however many of its activities are in it", () => {
    const p = product();
    const level = staffLevel({ hourly_rate_cents: 2000 });
    const x = offering(p.id, { target_enrollment: 5 });
    const y = offering(p.id, { target_enrollment: 5 });
    const acts = [
      activity(x.id, { start_time: "09:00", end_time: "10:00" }),
      activity(x.id, { start_time: "10:00", end_time: "11:00" }),
      activity(y.id, { start_time: "09:00", end_time: "11:00" }),
    ];
    const out = computePlan(
      emptyPlan({
        products: [p],
        plan_offerings: [x, y],
        plan_activities: acts,
        plan_staff_levels: [level],
        ...block(acts, { staff: [{ staff_level_key: level.key }] }),
      }),
    );
    // 1 coach × 2 h × 2000¢, half to each offering.
    expect(total(out, { line: "coach_wages", cost_center_key: x.key })).toBe(2000);
    expect(total(out, { line: "coach_wages", cost_center_key: y.key })).toBe(2000);
  });

  it("prices RIBs for the block's time on the water, unless the block sets their hours", () => {
    const rib = resource("rib", { cost_per_day_cents: 100, fuel_per_hour_cents: 400, maintenance_per_hour_cents: 100 });
    const { data } = onePractice({ resources: [{ resource_key: "rib", quantity: 2 }] }, { plan_resources: [rib] });
    let out = computePlan(data);
    expect(out.activities[0]?.ribs).toBe(2);
    // 2 RIBs × (2 h × 500¢ + 100¢)
    expect(total(out, { line: "ribs" })).toBe(2200);
    data.plan_activities[0]!.on_water_minutes = 60;
    expect(total(computePlan(data), { line: "ribs" })).toBe(1200);
    data.plan_block_resources[0]!.hours = 3;
    out = computePlan(data);
    expect(total(out, { line: "ribs" })).toBe(3200);
  });

  it("leaves a rented RIB's cost out of MTDC", () => {
    const owned = resource("owned", { cost_per_hour_cents: 500 });
    const rented = resource("rented", { cost_per_hour_cents: 500, excluded_from_mtdc: true });
    const { data, off } = onePractice(
      {
        resources: [
          { resource_key: "owned", quantity: 1 },
          { resource_key: "rented", quantity: 1 },
        ],
      },
      { plan_resources: [owned, rented] },
    );
    const out = computePlan(data);
    expect(total(out, { line: "ribs" })).toBe(2000);
    expect(pnlOf(out, off.key).mtdc_cents).toBe(1000);
  });

  it("prices other resources for the block's paid hours, or their own", () => {
    const crane = resource("crane", {
      resource_kind_id: "kind-crane",
      cost_per_hour_cents: 1000,
      cost_per_day_cents: 500,
    });
    const { data, off } = onePractice(
      { resources: [{ resource_key: "crane", quantity: 2 }] },
      { plan_resources: [crane] },
    );
    // 2 × (2 h × 1000¢ + 500¢)
    expect(total(computePlan(data), { line: "resource" })).toBe(5000);
    data.plan_block_resources[0]!.hours = 3;
    expect(total(computePlan(data), { line: "resource", cost_center_key: off.key })).toBe(7000);
  });

  it("charges upkeep for the organization's boats, and nothing for boats sailors bring", () => {
    const { data } = onePractice(
      { boats: [{ boat_class_id: "opti", count: 4, sailor_owned: 3 }] },
      {
        boat_classes: [{ id: "opti", name: "Opti", sailors_per_boat: 1, footprint_sq_ft: null }],
        plan_boat_rates: [
          {
            id: "br",
            version_id: "v1",
            key: "br",
            boat_class_id: "opti",
            maintenance_per_boat_hour_cents: 50,
            quantity: null,
          },
        ],
      },
    );
    const out = computePlan(data);
    // 4 boats × 2 h × 50¢
    expect(total(out, { line: "boats" })).toBe(400);
    expect(out.activities[0]?.boats).toBe(4);
  });

  describe("salaried staff", () => {
    function coached(pay: "salary" | "hourly" | null, rate: number | null = null) {
      const director = position({
        annual_salary_cents: 1_200_000,
        paid_hours_per_year: 2000,
        hourly_coaching_rate_cents: rate,
      });
      const { data, off } = onePractice(
        { staff: [{ position_key: director.key, pay }] },
        { plan_salaried_positions: [director] },
      );
      return { data, off, director };
    }

    it("charges a salaried coach's hours on a block to its offerings out of the salary", () => {
      const { data, director } = coached(null);
      const out = computePlan(data);
      // 2 h at 600¢ an hour; the rest of the salary goes to the organization.
      expect(total(out, { line: `salary:${director.key}:coaching` })).toBe(1200);
      expect(total(out, { line: `salary:${director.key}:remainder`, cost_center_type: "org" })).toBe(1_198_800);
      expect(total(out, { line: "coach_wages" })).toBe(0);
    });

    it("pays a salaried coach paid by the hour their own rate, on top of the salary", () => {
      const { data, director } = coached("hourly", 3000);
      const out = computePlan(data);
      expect(total(out, { line: "coach_wages" })).toBe(6000);
      expect(total(out, { line: `salary:${director.key}:coaching` })).toBe(0);
      expect(out.positions[0]).toMatchObject({ hourly_coaching_hours: 2, hourly_coaching_cents: 6000 });
    });

    it("pays nothing for the hours of a salaried coach paid by the hour with no rate, and warns", () => {
      const { data } = coached("hourly");
      const out = computePlan(data);
      expect(total(out, { line: "coach_wages" })).toBe(0);
      expect(out.warnings.map((w) => w.code)).toContain("no_hourly_rate");
    });

    it("warns when a salaried coach is on two blocks at once, with the hours another coach needs", () => {
      const director = position();
      const p = product();
      const [x, y] = [offering(p.id, { target_enrollment: 1 }), offering(p.id, { target_enrollment: 1 })];
      const ax = activity(x.id, { start_time: "09:00", end_time: "12:00" });
      const ay = activity(y.id, { start_time: "10:00", end_time: "14:00" });
      const on = { staff: [{ position_key: director.key }] };
      const data = emptyPlan({
        products: [p],
        plan_offerings: [x, y],
        plan_activities: [ax, ay],
        plan_salaried_positions: [director],
        ...blocks(block([ax], on), block([ay], on)),
      });
      let out = computePlan(data);
      expect(out.warnings).toContainEqual(
        expect.objectContaining({ code: "position_double_booked", category: "allocation", date: "2027-06-01" }),
      );
      expect(out.positions[0]).toMatchObject({ double_booked_hours: 2, double_booked_dates: 1 });
      ay.start_time = "13:00";
      out = computePlan(data);
      expect(out.warnings.map((w) => w.code)).not.toContain("position_double_booked");
    });
  });

  describe("capacity", () => {
    const L1 = staffLevel({ name: "Level 1 Instructor", qualifications: ["q-l1"] });
    const L2 = staffLevel({ name: "Level 2 Instructor", qualifications: ["q-l2"] });
    const junior = staffLevel({ name: "Junior Instructor", qualifications: ["q-junior"] });

    function guppies(sailors: number, given: Given, perCoach = 10) {
      const p = product({ name: "Guppies" });
      const off = offering(p.id, { target_enrollment: sailors });
      const a = activity(off.id, { uses_boats: false });
      return emptyPlan({
        products: [p],
        plan_programs: [program(p.id, { staff_level_key: L1.key, sailors_per_coach: perCoach })],
        plan_offerings: [off],
        plan_activities: [a],
        plan_staff_levels: [L1, L2, junior],
        qualification_covers: [{ qualification_id: "q-l2", covers_id: "q-l1" }],
        ...block([a], given, { name: "Guppies" }),
      });
    }

    it("warns when a block's sailors are more than its staff can take", () => {
      const out = computePlan(guppies(14, { staff: [{ staff_level_key: L1.key }] }));
      expect(out.warnings).toContainEqual(
        expect.objectContaining({
          code: "over_capacity",
          category: "allocation",
          message: "2027-06-01, Guppies: 14 sailors, but its staff can take 10",
        }),
      );
      expect(codes(guppies(10, { staff: [{ staff_level_key: L1.key }] }))).not.toContain("over_capacity");
    });

    it("counts a coach qualified for the program's staff level, and not one who isn't", () => {
      expect(codes(guppies(10, { staff: [{ staff_level_key: L2.key }] }))).not.toContain("over_capacity");
      const out = computePlan(guppies(10, { staff: [{ staff_level_key: junior.key }] }));
      expect(out.warnings.map((w) => w.message)).toContain("2027-06-01, Guppies: 10 sailors, but its staff can take 0");
    });

    it("counts each program's sailors against its own sailors per coach", () => {
      const [g, m] = [product(), product()];
      const [og, om] = [offering(g.id, { target_enrollment: 5 }), offering(m.id, { target_enrollment: 5 })];
      const acts = [activity(og.id, { uses_boats: false }), activity(om.id, { uses_boats: false })];
      const data = emptyPlan({
        products: [g, m],
        plan_programs: [
          program(g.id, { staff_level_key: L1.key, sailors_per_coach: 10 }),
          program(m.id, { staff_level_key: L1.key, sailors_per_coach: 5 }),
        ],
        plan_offerings: [og, om],
        plan_activities: acts,
        plan_staff_levels: [L1],
        ...block(acts, { staff: [{ staff_level_key: L1.key, count: 1 }] }),
      });
      expect(codes(data)).toContain("over_capacity");
      data.plan_block_staff[0]!.count = 2;
      expect(codes(data)).not.toContain("over_capacity");
    });

    it("warns about a program with no settings, and doesn't check its sailors against staff", () => {
      const data = guppies(14, { staff: [{ staff_level_key: L1.key }] });
      data.plan_programs = [];
      expect(codes(data)).toEqual(expect.arrayContaining(["no_program_settings"]));
      expect(codes(data)).not.toContain("over_capacity");
    });

    it("warns when a block's sailors are more than its boats can take, counting the boats sailors bring", () => {
      const data = guppies(14, {
        staff: [{ staff_level_key: L1.key, count: 2 }],
        boats: [{ boat_class_id: "sailqube", count: 5 }],
      });
      data.plan_activities[0]!.uses_boats = true;
      data.boat_classes = [{ id: "sailqube", name: "Sailqube", sailors_per_boat: 2, footprint_sq_ft: null }];
      expect(computePlan(data).warnings.map((w) => w.message)).toContain(
        "2027-06-01, Guppies: 14 sailors, but its boats can take 10",
      );
      data.plan_block_boats[0]!.sailor_owned = 2;
      expect(codes(data)).not.toContain("over_capacity");
    });

    it("warns when a class has no sailors per boat", () => {
      const data = guppies(1, { staff: [{ staff_level_key: L1.key }], boats: [{ boat_class_id: "x", count: 1 }] });
      data.plan_activities[0]!.uses_boats = true;
      data.boat_classes = [{ id: "x", name: "X", sailors_per_boat: null, footprint_sq_ft: null }];
      expect(codes(data)).toContain("no_sailors_per_boat");
    });
  });

  describe("inventory", () => {
    /** Two blocks on July 13, with `first` and `second` Sailqubes and RIBs, at the given times. */
    function twoBlocks(first: number, second: number, times: [string, string][], sailorOwned = 0) {
      const p = product();
      const [x, y] = [offering(p.id, { target_enrollment: 1 }), offering(p.id, { target_enrollment: 1 })];
      const ax = activity(x.id, { date: "2027-07-13", start_time: times[0]![0], end_time: times[0]![1] });
      const ay = activity(y.id, { date: "2027-07-13", start_time: times[1]![0], end_time: times[1]![1] });
      const given = (n: number) => ({
        boats: [{ boat_class_id: "sailqube", count: n, sailor_owned: sailorOwned }],
        resources: [{ resource_key: "rib", quantity: n }],
      });
      return emptyPlan({
        products: [p],
        plan_offerings: [x, y],
        plan_activities: [ax, ay],
        boat_classes: [{ id: "sailqube", name: "Sailqubes", sailors_per_boat: 2, footprint_sq_ft: null }],
        plan_boat_rates: [
          {
            id: "br",
            version_id: "ops",
            key: "br",
            boat_class_id: "sailqube",
            maintenance_per_boat_hour_cents: 0,
            quantity: 12,
          },
        ],
        plan_resources: [resource("rib", { name: "RIBs", quantity: 12 })],
        ...blocks(block([ax], given(first), { name: "Guppies" }), block([ay], given(second), { name: "Minnows" })),
      });
    }
    const morning: [string, string][] = [
      ["09:00", "12:00"],
      ["09:30", "11:30"],
    ];

    it("warns when more of the organization's boats are out at once than it has", () => {
      const out = computePlan(twoBlocks(9, 5, morning));
      expect(out.warnings).toContainEqual(
        expect.objectContaining({
          code: "over_inventory_boats",
          category: "allocation",
          date: "2027-07-13",
          version_id: "v1",
          message: "2027-07-13: 14 Sailqubes out, but the organization has 12 (Guppies 9, Minnows 5)",
        }),
      );
    });

    it("lets a morning block and an afternoon block use the same boats", () => {
      expect(
        codes(
          twoBlocks(9, 5, [
            ["09:00", "12:00"],
            ["13:00", "16:00"],
          ]),
        ),
      ).not.toContain("over_inventory_boats");
    });

    it("doesn't count boats sailors bring against the organization's", () => {
      expect(codes(twoBlocks(6, 5, morning, 4))).not.toContain("over_inventory_boats");
    });

    it("warns when more of a resource, such as RIBs, is out at once than the organization has", () => {
      const out = computePlan(twoBlocks(9, 5, morning));
      expect(out.warnings.map((w) => w.message)).toContain(
        "2027-07-13: 14 RIBs out, but the organization has 12 (Guppies 9, Minnows 5)",
      );
    });

    it("warns when the Operations Plan doesn't say how many of a boat class the organization has", () => {
      const data = twoBlocks(9, 5, morning);
      data.plan_boat_rates[0]!.quantity = null;
      let out = computePlan(data);
      expect(out.warnings.map((w) => w.code)).not.toContain("over_inventory_boats");
      expect(out.warnings).toContainEqual(
        expect.objectContaining({ code: "no_fleet_quantity", category: "data", version_id: "v1", date: "2027-07-13" }),
      );
      data.plan_boat_rates = [];
      out = computePlan(data);
      expect(out.warnings.map((w) => w.code)).toContain("no_fleet_quantity");
    });

    it("counts a block with no times as out all day", () => {
      const data = twoBlocks(9, 5, [
        ["09:00", "12:00"],
        ["13:00", "16:00"],
      ]);
      data.plan_activities[1]!.start_time = null;
      data.plan_activities[1]!.end_time = null;
      expect(codes(data)).toContain("over_inventory_boats");
    });
  });

  it("warns about an activity in a block on another date, and one in a missing block", () => {
    const { data, a } = onePractice();
    a.date = "2027-06-02";
    expect(codes(data)).toContain("block_date_mismatch");
    a.block_id = "missing";
    expect(codes(data)).toContain("unknown_block");
  });

  it("books a trip's airfare and lodging for each coach on its travel day's block, and its miles once", () => {
    const level = staffLevel();
    const p = product();
    const off = offering(p.id, { target_enrollment: 4 });
    const t = trip(off.id, { nights: 2, airfare_cents: 30_000, miles: 100 });
    const travel = activity(off.id, { date: "2027-06-11", kind: "travel", trip_id: t.id });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [off],
      plan_trips: [t],
      plan_activities: [travel],
      plan_staff_levels: [level],
      plan_rates: [rates({ lodging_per_night_cents: 10_000, mileage_rate_cents: 70 })],
      ...block([travel], { staff: [{ staff_level_key: level.key, count: 2 }] }),
    });
    // 2 × 30000 + 2 × 2 × 10000 + 100 × 70
    expect(total(computePlan(data), { line: "trip", account_id: A.travel })).toBe(107_000);
    data.plan_block_staff = [];
    const out = computePlan(data);
    expect(total(out, { line: "trip" })).toBe(7000);
    expect(out.warnings).toContainEqual(
      expect.objectContaining({ code: "trip_without_staff", category: "data", version_id: "v1", date: "2027-06-11" }),
    );
  });

  it("takes a trip's coaches only from its travel days' blocks", () => {
    const level = staffLevel();
    const p = product();
    const off = offering(p.id, { target_enrollment: 4 });
    const t = trip(off.id, { airfare_cents: 30_000 });
    // A regatta on the trip, staffed by 3, and a travel day staffed by 1.
    const regatta = activity(off.id, { date: "2027-06-12", kind: "regatta", trip_id: t.id });
    const travel = activity(off.id, { date: "2027-06-11", kind: "travel", trip_id: t.id });
    const data = emptyPlan({
      products: [p],
      plan_offerings: [off],
      plan_trips: [t],
      plan_activities: [regatta, travel],
      plan_staff_levels: [level],
      ...blocks(
        block([regatta], { staff: [{ staff_level_key: level.key, count: 3 }] }),
        block([travel], { staff: [{ staff_level_key: level.key, count: 1 }] }),
      ),
    });
    expect(total(computePlan(data), { line: "trip" })).toBe(30_000);
  });

  it("names the plan and the date of a warning about one block's rows", () => {
    const { data } = onePractice({ staff: [{ staff_level_key: "missing" }] });
    expect(computePlan(data).warnings).toContainEqual(
      expect.objectContaining({ code: "unknown_staff_level", category: "data", version_id: "v1", date: "2027-06-01" }),
    );
  });
});
