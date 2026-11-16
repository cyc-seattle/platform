import { describe, expect, it } from "vitest";
import { computePlan, type PlanBoatRate, type PlanData } from "../../src/planning/index.ts";
import {
  A,
  activity,
  assetList,
  block,
  blocks,
  budgetLine,
  emptyPlan,
  pnlOf,
  offering,
  position,
  product,
  pool,
  program,
  rates,
  staffLevel,
  total,
  trip,
  type Given,
} from "./fixtures.ts";

const codes = (data: PlanData) => computePlan(data).warnings.map((w) => w.code);

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
      { staff: [{ staff_level_id: level.staff_level_id, count: 3 }] },
      { plan_staff_levels: [level] },
    );
    const out = computePlan(data);
    // 3 staff × 2 h × 2500¢
    expect(total(out, { line: "coach_wages", cost_center_key: off.key })).toBe(15_000);
    expect(out.activities[0]?.coaches).toBe(3);
  });

  it("pays volunteers nothing", () => {
    const level = staffLevel({ hourly_rate_cents: 0 });
    const { data } = onePractice(
      { staff: [{ staff_level_id: level.staff_level_id, count: 2 }] },
      { plan_staff_levels: [level] },
    );
    const out = computePlan(data);
    expect(total(out, { line: "coach_wages" })).toBe(0);
    expect(out.activities[0]?.coaches).toBe(2);
  });

  it("costs nothing an activity isn't given, and doesn't warn that it has no staff", () => {
    const p = product();
    const off = offering(p.id, { target_enrollment: 13 });
    const a = activity(off.id, { date: "2027-08-02" });
    const out = computePlan(emptyPlan({ products: [p], plan_offerings: [off], plan_activities: [a] }));
    expect(out.lines.filter((l) => l.line_key.startsWith("coach_wages"))).toEqual([]);
    expect(out.warnings.filter((w) => w.category === "allocation")).toEqual([]);
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
        ...block([ax, ay], { staff: [{ staff_level_id: level.staff_level_id }] }),
      }),
    );
    // 1 coach × (3 h + 30 min + 30 min) × 2000¢
    expect(total(out, { line: "coach_wages" })).toBe(8000);
  });

  it("splits a block's costs among its offerings by their target sailors", () => {
    const p = product();
    const level = staffLevel({ hourly_rate_cents: 2000 });
    const x = offering(p.id, { target_enrollment: 6 });
    const y = offering(p.id, { target_enrollment: 4 });
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
        ...block([ax, ay], { staff: [{ staff_level_id: level.staff_level_id }] }),
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
        ...block(acts, { staff: [{ staff_level_id: level.staff_level_id }] }),
      }),
    );
    // 1 coach × 2 h × 2000¢, half to each offering.
    expect(total(out, { line: "coach_wages", cost_center_key: x.key })).toBe(2000);
    expect(total(out, { line: "coach_wages", cost_center_key: y.key })).toBe(2000);
  });

  /** A class's boat rate for the year. */
  const boatRate = (boat_class_id: string, fields: Partial<PlanBoatRate> = {}): PlanBoatRate => ({
    id: `rate-${boat_class_id}`,
    plan_id: "v1",
    key: `rate-${boat_class_id}`,
    boat_class_id,
    maintenance_per_boat_hour_cents: 0,
    ...fields,
  });

  it("charges fuel and upkeep for the organization's boats, and nothing for boats sailors bring", () => {
    const { data, off } = onePractice(
      { boats: [{ boat_class_id: "opti", count: 4, sailor_owned: 3 }] },
      {
        boat_classes: [{ id: "opti", name: "Opti", max_capacity: 1, footprint_sq_ft: null }],
        plan_boat_rates: [boatRate("opti", { maintenance_per_boat_hour_cents: 50, fuel_per_hour_cents: 25 })],
      },
    );
    const out = computePlan(data);
    // 4 boats × 2 h × (50¢ + 25¢)
    expect(total(out, { line: "boats", account_id: A.boats })).toBe(600);
    expect(out.lines.find((l) => l.line_key.startsWith("boats"))?.line_name).toBe("Boats: Opti");
    expect(pnlOf(out, off.key).mtdc_cents).toBe(600);
    expect(out.activities[0]?.boats).toBe(4);
  });

  it("books a class's fuel and upkeep to its own account, such as coach boats for RIBs", () => {
    const { data } = onePractice(
      { boats: [{ boat_class_id: "rib", count: 2 }] },
      {
        boat_classes: [{ id: "rib", name: "RIB", max_capacity: 0, footprint_sq_ft: null, account_id: A.ribs }],
        plan_boat_rates: [boatRate("rib", { maintenance_per_boat_hour_cents: 800, fuel_per_hour_cents: 1500 })],
      },
    );
    // 2 RIBs × 2 h × (800¢ + 1500¢)
    expect(total(computePlan(data), { line: "boats", account_id: A.ribs })).toBe(9200);
  });

  describe("charters", () => {
    /** RIBs chartered by two blocks on July 13, `first` by the morning one and `second` by one at `times`. */
    function charters(first: number, second: number, times: [string, string], rate: number | null = 15_000) {
      const p = product();
      const [x, y] = [offering(p.id, { name: "Guppies" }), offering(p.id, { name: "Minnows" })];
      const ax = activity(x.id, { date: "2027-07-13", start_time: "09:00", end_time: "12:00" });
      const ay = activity(y.id, { date: "2027-07-13", start_time: times[0], end_time: times[1] });
      const given = (n: number) => ({ boats: [{ boat_class_id: "rib", count: 0, chartered: n }] });
      return emptyPlan({
        products: [p],
        plan_offerings: [x, y],
        plan_activities: [ax, ay],
        boat_classes: [{ id: "rib", name: "RIB", max_capacity: 0, footprint_sq_ft: null }],
        plan_boat_rates: [boatRate("rib", { charter_per_day_cents: rate })],
        ...blocks(block([ax], given(first)), block([ay], given(second))),
      });
    }

    it("charges a class's charter rate once a day, for the most chartered at once", () => {
      const out = computePlan(charters(1, 1, ["13:00", "16:00"]));
      expect(total(out, { line: "charters", account_id: A.resources })).toBe(15_000);
      expect(out.lines.find((l) => l.line_key.startsWith("charters"))?.line_name).toBe("Boat charters: RIB");
      expect(total(computePlan(charters(1, 1, ["10:00", "13:00"])), { line: "charters" })).toBe(30_000);
    });

    it("shares a day's charters among the blocks by how many each charters", () => {
      const data = charters(2, 1, ["10:00", "13:00"]);
      const out = computePlan(data);
      const [x, y] = data.plan_offerings;
      expect(total(out, { line: "charters", cost_center_key: x!.key })).toBe(30_000);
      expect(total(out, { line: "charters", cost_center_key: y!.key })).toBe(15_000);
    });

    it("leaves charters out of MTDC", () => {
      const data = charters(1, 0, ["13:00", "16:00"]);
      expect(pnlOf(computePlan(data), data.plan_offerings[0]!.key).mtdc_cents).toBe(0);
    });

    it("warns about chartered boats whose class has no charter rate", () => {
      const out = computePlan(charters(1, 0, ["13:00", "16:00"], null));
      expect(total(out, { line: "charters" })).toBe(0);
      expect(out.warnings.map((w) => w.code)).toContain("no_charter_rate");
    });
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

  describe("program settings and boat classes", () => {
    const L1 = staffLevel();

    function guppies(given: Given) {
      const p = product({ name: "Guppies" });
      const off = offering(p.id, { name: "Guppies Week 2", target_enrollment: 14 });
      const a = activity(off.id);
      return emptyPlan({
        products: [p],
        plan_programs: [program(p.id, { staff_level_id: L1.staff_level_id, sailors_per_coach: 10 })],
        plan_offerings: [off],
        plan_activities: [a],
        plan_staff_levels: [L1],
        ...block([a], given, { name: "Guppies" }),
      });
    }

    it("doesn't warn about a program with no settings, which needs no coach boats", () => {
      const data = guppies({ staff: [{ staff_level_id: L1.staff_level_id }] });
      data.plan_programs = [];
      expect(codes(data)).not.toContain("no_program_settings");
    });

    it("warns when a class has no max capacity", () => {
      const data = guppies({
        staff: [{ staff_level_id: L1.staff_level_id }],
        boats: [{ boat_class_id: "x", count: 1 }],
      });
      data.boat_classes = [{ id: "x", name: "X", max_capacity: null, footprint_sq_ft: null }];
      expect(codes(data)).toContain("no_max_capacity");
    });
  });

  describe("boats for a full program", () => {
    const L1 = staffLevel();
    const classes = [
      { id: "sailqube", name: "Sailqube", max_capacity: 2, footprint_sq_ft: null },
      { id: "fj", name: "FJ", max_capacity: 2, footprint_sq_ft: null },
      { id: "rib", name: "RIB", max_capacity: 0, footprint_sq_ft: null },
    ];

    /** Guppies Week 2, for up to 16 sailors and expecting 10, a coach for every 5, in a block given `given`. */
    function guppies(given: Given, owned: Parameters<typeof assetList>[0]) {
      const p = product({ name: "Guppies" });
      const off = offering(p.id, { name: "Guppies Week 2", capacity: 16, target_enrollment: 10 });
      const a = activity(off.id, { date: "2027-07-13", start_time: "09:00", end_time: "12:00" });
      return emptyPlan({
        products: [p],
        plan_programs: [program(p.id, { staff_level_id: L1.staff_level_id, sailors_per_coach: 5 })],
        plan_offerings: [off],
        plan_activities: [a],
        plan_staff_levels: [L1],
        boat_classes: classes,
        ...assetList(owned),
        ...block([a], { staff: [{ staff_level_id: L1.staff_level_id, count: 2 }], ...given }, { name: "Guppies" }),
      });
    }
    const sailqubes = (count: number) => [{ boat_class_id: "sailqube", count }];
    const short = (data: PlanData) => computePlan(data).warnings.filter((w) => w.code === "short_of_boats");

    it("warns when the organization hasn't enough sailboats to seat every sailor of a full program", () => {
      // 5 Sailqubes seat 10; 16 sailors need 8.
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 5 }] }, sailqubes(6));
      expect(short(data)).toEqual([
        expect.objectContaining({
          category: "allocation",
          date: "2027-07-13",
          plan_id: "v1",
          message:
            "Guppies Week 2 needs 8 Sailqubes out at once when it's full, but A club has only 6, so it's 2 short",
        }),
      ]);
      expect(short(guppies({ boats: [{ boat_class_id: "sailqube", count: 5 }] }, sailqubes(8)))).toEqual([]);
    });

    it("doesn't warn about coaches, since more can be hired", () => {
      const data = guppies({ staff: [{ staff_level_id: L1.staff_level_id, count: 1 }] }, []);
      expect(computePlan(data).warnings.filter((w) => w.category === "allocation")).toEqual([]);
    });

    it("counts the seats a block is short across its classes, and adds the fewest boats to seat them", () => {
      // A Harpoon and a Venture seat 12, so 16 sailors are 4 short: 1 more Harpoon, not 2 of each.
      const given = {
        boats: [
          { boat_class_id: "harpoon", count: 1 },
          { boat_class_id: "venture", count: 1 },
        ],
      };
      const data = guppies(given, [
        { boat_class_id: "harpoon", count: 2 },
        { boat_class_id: "venture", count: 1 },
      ]);
      data.boat_classes = [
        ...classes,
        { id: "harpoon", name: "Harpoon", max_capacity: 6, footprint_sq_ft: null },
        { id: "venture", name: "Venture", max_capacity: 6, footprint_sq_ft: null },
      ];
      expect(short(data)).toEqual([]);
      data.boats.splice(1, 1);
      expect(short(data)[0]?.message).toMatch(/needs 2 Harpoons out at once when it's full/);
    });

    it("keeps the boats sailors bring as they are", () => {
      // 2 of theirs seat 4, so 5 of the organization's seating 10 need to seat 12: 6.
      const given = { boats: [{ boat_class_id: "sailqube", count: 5, sailor_owned: 2 }] };
      expect(short(guppies(given, sailqubes(6)))).toEqual([]);
      expect(short(guppies(given, sailqubes(5)))[0]?.message).toMatch(/needs 6 Sailqubes/);
    });

    it("keeps charters as given, so the organization's own boats make up the rest", () => {
      // 5 seat 10, so 16 sailors need 8, and 2 are chartered.
      const given = { boats: [{ boat_class_id: "sailqube", count: 3, chartered: 2 }] };
      expect(short(guppies(given, sailqubes(6)))).toEqual([]);
      expect(short(guppies(given, sailqubes(5)))[0]?.message).toMatch(
        /needs 6 Sailqubes .* has only 5, so it's 1 short$/,
      );
    });

    it("doesn't warn about a class the organization has none of, since more can be chartered", () => {
      const data = guppies({ boats: [{ boat_class_id: "fj", count: 0, chartered: 5 }] }, sailqubes(6));
      expect(codes(data)).not.toContain("short_of_boats");
    });

    it("needs a coach boat for each coach a full program needs", () => {
      // 16 sailors at 5 a coach need 4 coaches.
      const given = {
        boats: [
          { boat_class_id: "sailqube", count: 8 },
          { boat_class_id: "rib", count: 2 },
        ],
      };
      const owned = (ribs: number) => [
        ...sailqubes(8),
        { boat_class_id: "rib", count: ribs, kind: "powerboat" as const },
      ];
      expect(short(guppies(given, owned(4)))).toEqual([]);
      expect(short(guppies(given, owned(3))).map((w) => w.message)).toEqual([
        "Guppies Week 2 needs 4 coach boats out at once when it's full, but A club has only 3, so it's 1 short",
      ]);
    });

    it("counts every class that seats no sailors as a coach boat, such as a RIB or a support boat", () => {
      const given = {
        boats: [
          { boat_class_id: "sailqube", count: 8 },
          { boat_class_id: "rib", count: 2 },
          { boat_class_id: "support", count: 1 },
        ],
      };
      const data = guppies(given, [
        ...sailqubes(8),
        { boat_class_id: "rib", count: 2, kind: "powerboat" as const },
        { boat_class_id: "support", count: 2, kind: "powerboat" as const },
      ]);
      data.boat_classes = [...classes, { id: "support", name: "Support", max_capacity: 0, footprint_sq_ft: null }];
      expect(codes(data)).not.toContain("over_inventory_boats");
      expect(short(data)).toEqual([]);
      data.boats.pop();
      expect(short(data).map((w) => w.message)).toEqual([
        "Guppies Week 2 needs 4 coach boats out at once when it's full, but A club has only 3, so it's 1 short",
      ]);
    });

    /** Lets Guppies sail `ids`, in the catalog. */
    const sails = (data: PlanData, ids: string[]) => {
      data.programs = [{ id: "guppies", product_id: data.products[0]!.id }];
      data.program_boat_classes = ids.map((id) => ({ program_id: "guppies", boat_class_id: id }));
      return data;
    };

    it("covers a class that runs short with spare boats of another class its programs can sail", () => {
      // 16 sailors need 8 Sailqubes, and the organization has 6, so 2 FJs stand in.
      const owned = [...sailqubes(6), { boat_class_id: "fj", count: 2 }];
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 5 }] }, owned);
      expect(short(data)).toHaveLength(1);
      expect(short(sails(data, ["sailqube", "fj"]))).toEqual([]);
      data.boats.pop();
      expect(short(data)[0]?.message).toMatch(/needs 8 Sailqubes out at once when it's full/);
    });

    it("counts only the stand-ins no other block has out at the same time", () => {
      const data = sails(
        guppies({ boats: [{ boat_class_id: "sailqube", count: 5 }] }, [
          ...sailqubes(6),
          { boat_class_id: "fj", count: 2 },
        ]),
        ["sailqube", "fj"],
      );
      const p = product({ name: "Minnows" });
      const off = offering(p.id, { name: "Minnows Week 2", capacity: 2, target_enrollment: 2 });
      const a = activity(off.id, { date: "2027-07-13", start_time: "10:00", end_time: "11:00" });
      const other = block([a], { boats: [{ boat_class_id: "fj", count: 1 }] }, { name: "Minnows" });
      data.products.push(p);
      data.plan_offerings.push(off);
      data.plan_activities.push(a);
      data.plan_activity_blocks.push(...other.plan_activity_blocks);
      data.plan_block_boats.push(...other.plan_block_boats);
      expect(short(data)[0]?.message).toMatch(/needs 8 Sailqubes out at once when it's full/);
    });

    it("covers boats given beyond what the organization has, too", () => {
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 7 }] }, [
        ...sailqubes(6),
        { boat_class_id: "fj", count: 1 },
      ]);
      expect(codes(data)).toContain("over_inventory_boats");
      expect(codes(sails(data, ["sailqube", "fj"]))).not.toContain("over_inventory_boats");
    });

    it("is a warning when the organization's boats run short only if every offering fills", () => {
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 5 }] }, sailqubes(6));
      expect(short(data)[0]?.severity).toBe("warning");
    });

    it("is an error when the organization's boats run short even for the sailors expected", () => {
      // 4 Sailqubes seat 8; the 10 expected need 5, and a full 16 need 8.
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 4 }] }, sailqubes(4));
      expect(short(data)).toEqual([
        expect.objectContaining({
          severity: "error",
          message:
            "Guppies Week 2 needs 5 Sailqubes out at once for the sailors expected, but A club has only 4, so it's 1 short",
        }),
      ]);
    });

    it("adds up the blocks out at once, and names their offerings", () => {
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 5 }] }, sailqubes(12));
      const p = product({ name: "Minnows" });
      const off = offering(p.id, { name: "Minnows Week 2", capacity: 8, target_enrollment: 4 });
      const a = activity(off.id, { date: "2027-07-13", start_time: "10:00", end_time: "11:00" });
      const other = block([a], { boats: [{ boat_class_id: "sailqube", count: 2 }] }, { name: "Minnows" });
      data.products.push(p);
      data.plan_offerings.push(off);
      data.plan_activities.push(a);
      data.plan_activity_blocks.push(...other.plan_activity_blocks);
      data.plan_block_boats.push(...other.plan_block_boats);
      // 8 for Guppies and 4 for Minnows.
      expect(short(data)).toEqual([]);
      data.boats.pop();
      expect(short(data).map((w) => w.message)).toEqual([
        "Guppies Week 2 and Minnows Week 2 need 12 Sailqubes out at once when they're full, but A club has only 11, so they're 1 short",
      ]);
      a.start_time = "13:00";
      a.end_time = "14:00";
      expect(short(data)).toEqual([]);
    });

    it("warns only that too many are out when the boats given are already more than the organization has", () => {
      const data = guppies({ boats: [{ boat_class_id: "sailqube", count: 7 }] }, sailqubes(6));
      expect(codes(data)).toContain("over_inventory_boats");
      expect(codes(data)).not.toContain("short_of_boats");
    });
  });

  describe("inventory", () => {
    /** Two blocks on July 13, with `first` and `second` Sailqubes, at the given times. */
    function twoBlocks(first: number, second: number, times: [string, string][], sailorOwned = 0, chartered = 0) {
      const [guppies, minnows] = [product({ name: "Guppies" }), product({ name: "Minnows" })];
      const [x, y] = [
        offering(guppies.id, { name: "Week 3", target_enrollment: 1 }),
        offering(minnows.id, { name: "Week 3", target_enrollment: 1 }),
      ];
      const ax = activity(x.id, { date: "2027-07-13", start_time: times[0]![0], end_time: times[0]![1] });
      const ay = activity(y.id, { date: "2027-07-13", start_time: times[1]![0], end_time: times[1]![1] });
      const given = (n: number) => ({
        boats: [{ boat_class_id: "sailqube", count: n, sailor_owned: sailorOwned, chartered }],
      });
      return emptyPlan({
        products: [guppies, minnows],
        plan_offerings: [x, y],
        plan_activities: [ax, ay],
        boat_classes: [{ id: "sailqube", name: "Sailqube", max_capacity: 2, footprint_sq_ft: null }],
        ...assetList([{ boat_class_id: "sailqube", count: 12 }]),
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
          plan_id: "v1",
          message: "14 Sailqubes out at once, but A club has only 12: 9 for Guppies Week 3 and 5 for Minnows Week 3",
        }),
      );
    });

    it("names the offerings of the one block that's over", () => {
      const out = computePlan(twoBlocks(14, 0, morning));
      expect(out.warnings.map((w) => w.message)).toContain(
        "14 Sailqubes out at once for Guppies Week 3, but A club has only 12",
      );
    });

    it("uses a boat class's name as given unless it's one word", () => {
      const data = twoBlocks(9, 5, morning);
      data.boat_classes[0]!.name = "Laser Radial";
      expect(computePlan(data).warnings.map((w) => w.message)).toContain(
        "14 Laser Radial out at once, but A club has only 12: 9 for Guppies Week 3 and 5 for Minnows Week 3",
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

    it("counts a boat from the day the organization gets it until the day it disposes of it", () => {
      const data = twoBlocks(9, 5, morning);
      const sailqubes = (boats: Parameters<typeof assetList>[0]) => Object.assign(data, assetList(boats));
      sailqubes([
        { boat_class_id: "sailqube", count: 12 },
        { boat_class_id: "sailqube", count: 2, acquired_on: "2027-07-13" },
      ]);
      expect(codes(data)).not.toContain("over_inventory_boats");
      sailqubes([
        { boat_class_id: "sailqube", count: 12 },
        { boat_class_id: "sailqube", count: 2, acquired_on: "2027-07-14" },
      ]);
      expect(codes(data)).toContain("over_inventory_boats");
      sailqubes([
        { boat_class_id: "sailqube", count: 12 },
        { boat_class_id: "sailqube", count: 2, disposed_on: "2027-07-14" },
      ]);
      expect(codes(data)).not.toContain("over_inventory_boats");
      sailqubes([
        { boat_class_id: "sailqube", count: 12 },
        { boat_class_id: "sailqube", count: 2, disposed_on: "2027-07-13" },
      ]);
      expect(codes(data)).toContain("over_inventory_boats");
    });

    it("says the organization has none of a boat class with no boats that day", () => {
      const data = Object.assign(twoBlocks(9, 5, morning), assetList([{ boat_class_id: "opti", count: 12 }]));
      expect(computePlan(data).warnings.map((w) => w.message)).toContain(
        "14 Sailqubes out at once, but A club has none: 9 for Guppies Week 3 and 5 for Minnows Week 3",
      );
    });

    it("counts powerboats of a class the same way, such as RIBs", () => {
      const data = twoBlocks(4, 3, morning);
      data.boat_classes[0]!.name = "RIB";
      Object.assign(data, assetList([{ boat_class_id: "sailqube", count: 6, kind: "powerboat" }]));
      expect(computePlan(data).warnings.map((w) => w.message)).toContain(
        "7 RIBs out at once, but A club has only 6: 4 for Guppies Week 3 and 3 for Minnows Week 3",
      );
    });

    it("doesn't count chartered boats against the organization's", () => {
      expect(codes(twoBlocks(6, 6, morning, 0, 4))).not.toContain("over_inventory_boats");
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
      ...block([travel], { staff: [{ staff_level_id: level.staff_level_id, count: 2 }] }),
    });
    // 2 × 30000 + 2 × 2 × 10000 + 100 × 70
    expect(total(computePlan(data), { line: "trip", account_id: A.travel })).toBe(107_000);
    // Both coaches travel, though the 4 sailors expected need only one of them, at one to every 4.
    data.plan_programs = [program(p.id, { staff_level_id: level.staff_level_id, sailors_per_coach: 4 })];
    expect(total(computePlan(data), { line: "trip" })).toBe(107_000);
    data.plan_programs = [];
    data.plan_block_staff = [];
    const out = computePlan(data);
    expect(total(out, { line: "trip" })).toBe(7000);
    expect(out.warnings).toContainEqual(
      expect.objectContaining({ code: "trip_without_staff", category: "data", plan_id: "v1", date: "2027-06-11" }),
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
        block([regatta], { staff: [{ staff_level_id: level.staff_level_id, count: 3 }] }),
        block([travel], { staff: [{ staff_level_id: level.staff_level_id, count: 1 }] }),
      ),
    });
    expect(total(computePlan(data), { line: "trip" })).toBe(30_000);
  });

  it("names the plan and the date of a warning about one block's rows", () => {
    const { data } = onePractice({ staff: [{ staff_level_id: "missing" }] });
    expect(computePlan(data).warnings).toContainEqual(
      expect.objectContaining({ code: "unknown_staff_level", category: "data", plan_id: "v1", date: "2027-06-01" }),
    );
  });
});

describe("a block costs what it's given", () => {
  const coach = staffLevel({ hourly_rate_cents: 2000 });
  const director = position({ name: "Sailing Director" });

  /** An offering for up to `max` sailors, expecting `expected`, with one practice, 4pm to 6pm, in a block given `given`. */
  function full(max: number, expected: number, given: Given, extra: Partial<PlanData> = {}, perCoach = 5) {
    const p = product({ name: "Guppies" });
    const off = offering(p.id, { name: "Guppies Week 2", capacity: max, target_enrollment: expected });
    const a = activity(off.id);
    const data = emptyPlan({
      products: [p],
      plan_programs: [program(p.id, { staff_level_id: coach.staff_level_id, sailors_per_coach: perCoach })],
      plan_offerings: [off],
      plan_activities: [a],
      plan_staff_levels: [coach],
      plan_salaried_positions: [director],
      ...block([a], given),
      ...extra,
    });
    return { off, data };
  }

  it("pays every coach it's given, however many sailors are expected", () => {
    const wages = (expected: number) => {
      const { data, off } = full(20, expected, { staff: [{ staff_level_id: coach.staff_level_id, count: 4 }] });
      const out = computePlan(data);
      expect(out.activities[0]?.coaches).toBe(4);
      return total(out, { line: "coach_wages", cost_center_key: off.key });
    };
    // 4 coaches × 2 h × 2000¢
    expect(wages(5)).toBe(16_000);
    expect(wages(20)).toBe(16_000);
  });

  it("pays a salaried coach on salary, and the hourly coaches beside them", () => {
    const { data } = full(10, 5, {
      staff: [{ position_key: director.key }, { staff_level_id: coach.staff_level_id, count: 1 }],
    });
    const out = computePlan(data);
    expect(total(out, { line: "coach_wages" })).toBe(4000);
    expect(out.positions[0]?.salaried_coaching_hours).toBe(2);
  });

  it("costs every boat it's given, own and chartered, however many sailors are expected", () => {
    const rate = (boat_class_id: string, fields: Partial<PlanBoatRate>): PlanBoatRate => ({
      id: boat_class_id,
      plan_id: "v1",
      key: boat_class_id,
      boat_class_id,
      maintenance_per_boat_hour_cents: 0,
      ...fields,
    });
    const { data } = full(
      16,
      10,
      {
        staff: [{ staff_level_id: coach.staff_level_id, count: 4 }],
        boats: [
          { boat_class_id: "fj", count: 8, chartered: 4 },
          { boat_class_id: "rib", count: 3 },
        ],
      },
      {
        boat_classes: [
          { id: "fj", name: "FJ", max_capacity: 2, footprint_sq_ft: null },
          { id: "rib", name: "RIB", max_capacity: 0, footprint_sq_ft: null, account_id: A.ribs },
        ],
        plan_boat_rates: [
          rate("fj", { maintenance_per_boat_hour_cents: 100, charter_per_day_cents: 5000 }),
          rate("rib", { fuel_per_hour_cents: 1000 }),
        ],
      },
    );
    const out = computePlan(data);
    // 8 boats × 2 h × 100¢
    expect(total(out, { line: "boats", account_id: A.boats })).toBe(1600);
    // 3 RIBs × 2 h × 1000¢
    expect(total(out, { line: "boats", account_id: A.ribs })).toBe(6000);
    // 4 chartered × 5000¢
    expect(total(out, { line: "charters" })).toBe(20_000);
    expect(out.activities[0]).toMatchObject({ boats: 15 });
  });

  it("gives the most sailors the block can take, by its coaches or its boats", () => {
    const { data, off } = full(
      16,
      10,
      { staff: [{ staff_level_id: coach.staff_level_id, count: 4 }], boats: [{ boat_class_id: "q", count: 6 }] },
      { boat_classes: [{ id: "q", name: "Sailqube", max_capacity: 2, footprint_sq_ft: null }] },
    );
    data.plan_activities[0]!.uses_boats = true;
    expect(pnlOf(computePlan(data), off.key)).toMatchObject({ max_enrollment: 16, allocation_holds: 12 });
    data.plan_block_boats[0]!.count = 20;
    expect(pnlOf(computePlan(data), off.key).allocation_holds).toBe(20);
  });

  it("leaves room in a shared block for the other offering's most", () => {
    const [g, m] = [product(), product()];
    const og = offering(g.id, { capacity: 10, target_enrollment: 4 });
    const om = offering(m.id, { capacity: 5, target_enrollment: 2 });
    const acts = [activity(og.id, { uses_boats: false }), activity(om.id, { uses_boats: false })];
    const out = computePlan(
      emptyPlan({
        products: [g, m],
        plan_programs: [
          program(g.id, { staff_level_id: coach.staff_level_id, sailors_per_coach: 10 }),
          program(m.id, { staff_level_id: coach.staff_level_id, sailors_per_coach: 5 }),
        ],
        plan_offerings: [og, om],
        plan_activities: acts,
        plan_staff_levels: [coach],
        ...block(acts, { staff: [{ staff_level_id: coach.staff_level_id, count: 3 }] }),
      }),
    );
    expect(pnlOf(out, og.key).allocation_holds).toBe(20);
    expect(pnlOf(out, om.key).allocation_holds).toBe(10);
  });

  it("takes the fewest sailors any of the offering's blocks can take", () => {
    const p = product();
    const off = offering(p.id, { capacity: 16 });
    const [a, b] = [
      activity(off.id, { uses_boats: false }),
      activity(off.id, { date: "2027-06-02", uses_boats: false }),
    ];
    const out = computePlan(
      emptyPlan({
        products: [p],
        plan_programs: [program(p.id, { staff_level_id: coach.staff_level_id, sailors_per_coach: 8 })],
        plan_offerings: [off],
        plan_activities: [a, b],
        plan_staff_levels: [coach],
        ...blocks(
          block([a], { staff: [{ staff_level_id: coach.staff_level_id, count: 2 }] }),
          block([b], { staff: [{ staff_level_id: coach.staff_level_id, count: 1 }] }),
        ),
      }),
    );
    expect(pnlOf(out, off.key).allocation_holds).toBe(8);
  });

  describe("breakeven", () => {
    const withCosts = (capacity: number | null, price: number, costs: number) => {
      const p = product();
      const off = offering(p.id, { capacity, target_enrollment: 1, price_cents: price });
      const data = emptyPlan({
        products: [p],
        plan_offerings: [off],
        plan_budget_lines: [
          budgetLine({ cost_center_type: "offering", cost_center_key: off.key, amount_cents: costs }),
        ],
      });
      return pnlOf(computePlan(data), off.key).breakeven_enrollment;
    };

    it("is the fewest sailors at which the offering covers its costs", () => {
      expect(withCosts(16, 50_000, 300_000)).toBe(6);
      expect(withCosts(16, 50_000, 0)).toBe(1);
    });

    it("is null when the offering doesn't cover its costs even when full, or has no capacity", () => {
      expect(withCosts(10, 10_000, 200_000)).toBeNull();
      expect(withCosts(null, 50_000, 300_000)).toBeNull();
    });

    it("counts the offering's indirect cost rate on its own fees, which grow with its sailors", () => {
      const p = product();
      const ga = pool();
      const off = offering(p.id, { capacity: 16, target_enrollment: 1, price_cents: 10_000, cogs_rate: 0.5 });
      const data = emptyPlan({
        products: [p],
        plan_offerings: [off],
        plan_pools: [ga],
        plan_programs: [program(p.id, { indirect_cost_rate: 0.25 })],
        plan_budget_lines: [
          budgetLine({ cost_center_type: "offering", cost_center_key: off.key, amount_cents: 10_000 }),
          budgetLine({ cost_center_type: "pool", cost_center_key: ga.key, amount_cents: 1_000_000 }),
        ],
      });
      // Each sailor brings 10_000¢, less 5000¢ of COGS and 2500¢ of indirect costs: 2500¢ toward the
      // 10_000¢ line.
      expect(pnlOf(computePlan(data), off.key).breakeven_enrollment).toBe(4);
    });

    it("counts every coach the block is given, whoever signs up", () => {
      const { data, off } = full(10, 10, { staff: [{ staff_level_id: coach.staff_level_id, count: 2 }] });
      data.plan_offerings[0]!.price_cents = 2000;
      // Two coaches cost 2 × 2 h × 2000¢ = 8000¢, which 4 sailors pay.
      expect(pnlOf(computePlan(data), off.key).breakeven_enrollment).toBe(4);
      data.plan_budget_lines = [
        budgetLine({ cost_center_type: "offering", cost_center_key: off.key, amount_cents: 10_000 }),
      ];
      // 9 sailors pay 18_000¢ against the coaches' 8000¢ + 10_000¢.
      expect(pnlOf(computePlan(data), off.key).breakeven_enrollment).toBe(9);
    });
  });
});
