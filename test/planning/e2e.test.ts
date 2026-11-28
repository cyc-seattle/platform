// One plan shaped like a club's year: invented programs, rates and costs, every figure made up.
import { describe, expect, it } from "vitest";
import { perDay, perSailorDay, type CostLine, type OfferingInPlan, type PlanData } from "../../src/planning/index.ts";
import {
  A,
  activity,
  area,
  assetList,
  block,
  blocks,
  budgetLine,
  charge,
  emptyPlan,
  laborLine,
  offering,
  pnlOf,
  pool,
  position,
  product,
  program,
  payrollTax,
  rates,
  staffLevel,
  trip,
  weekly,
  withRate,
  computePlan,
} from "./fixtures.ts";

const v = (id: string) => ({ id, plan_id: "v1" });

function realisticPlan(): PlanData {
  const youth = area({ id: "youth", name: "Youth" });
  const adults = area({ id: "adults", name: "Adults" });
  const racing = product({ id: "youth-racing", name: "Youth Racing", program_area_id: youth.id });
  const camp = product({ id: "summer-camp", name: "Summer Camp", program_area_id: youth.id });
  const adult = product({ id: "adult-lts", name: "Adult Learn to Sail", program_area_id: adults.id });
  const charters = product({ id: "charters", name: "Charters", kind: "charter", revenue_account_id: A.charterRevenue });
  const storage = product({
    id: "storage",
    name: "Storage",
    kind: "storage_lease",
    revenue_account_id: A.charterRevenue,
  });
  const merch = product({ id: "merch", name: "Merchandise", kind: "merchandise" });

  const instructor1 = staffLevel({ ...v("level-i"), staff_level_id: "instructor", hourly_rate_cents: 2000 });
  const instructor2 = staffLevel({
    ...v("level-ii"),
    staff_level_id: "senior-instructor",
    hourly_rate_cents: 2600,
  });

  const fall = offering(racing.id, {
    ...v("racing-fall"),
    name: "Youth Racing Fall",
    starts_on: "2026-09-08",
    ends_on: "2026-11-15",
    capacity: 24,
    target_enrollment: 18,
    price_cents: 85_000,
  });
  const spring = offering(racing.id, {
    ...v("racing-spring"),
    name: "Youth Racing Spring",
    starts_on: "2027-03-02",
    ends_on: "2027-05-30",
    target_enrollment: 16,
    price_cents: 85_000,
  });
  const development = offering(racing.id, {
    ...v("racing-dev"),
    name: "Youth Development Spring",
    starts_on: "2027-03-02",
    ends_on: "2027-05-30",
    target_enrollment: 5,
    price_cents: 60_000,
  });
  const lts = offering(adult.id, {
    ...v("adult-lts-spring"),
    name: "Adult Learn to Sail",
    starts_on: "2027-05-01",
    ends_on: "2027-06-30",
    target_enrollment: 8,
    price_cents: 45_000,
  });
  const campWeeks = ["2027-06-14", "2027-06-21"].map((monday, i) =>
    offering(camp.id, {
      ...v(`camp-week-${i + 1}`),
      name: `Summer Camp week ${i + 1}`,
      starts_on: monday,
      ends_on: `2027-06-${String(Number(monday.slice(8)) + 4).padStart(2, "0")}`,
      capacity: 30,
      target_enrollment: 27,
      price_cents: 42_000,
    }),
  );
  const charterYear = offering(charters.id, {
    ...v("charters-year"),
    starts_on: "2026-07-01",
    ends_on: "2027-06-30",
    target_enrollment: 40,
    price_cents: 15_000,
  });
  const storageYear = offering(storage.id, {
    ...v("storage-year"),
    starts_on: "2026-07-01",
    ends_on: "2027-06-30",
    target_enrollment: 50,
    price_cents: 48_000,
  });
  const merchYear = offering(merch.id, {
    ...v("merch-year"),
    starts_on: "2026-07-01",
    ends_on: "2027-06-30",
    target_enrollment: 200,
    price_cents: 2500,
    cogs_rate: 0.5,
  });

  // A scheduling tool would enter these; here, every listed weekday in the offering's dates.
  const practice = (
    o: { id: string; starts_on: string; ends_on: string },
    weekdays: number[],
    start: string,
    end: string,
    extra: Parameters<typeof activity>[1] & { skip?: string[] } = {},
  ) => {
    const { skip = [], ...overrides } = extra;
    return weekly(o.id, weekdays, o.starts_on, o.ends_on, {
      start_time: start,
      end_time: end,
      setup_minutes: 30,
      putaway_minutes: 30,
      ...overrides,
    }).filter((a) => !skip.includes(a.date));
  };

  const director = position({
    ...v("director"),
    name: "Program Director",
    annual_salary_cents: 7_000_000,
    paid_hours_per_year: 2080,
    ga_share: 0.2,
  });
  const facilities = position({
    ...v("facilities"),
    name: "Facilities Manager",
    annual_salary_cents: 5_200_000,
    paid_hours_per_year: 2080,
  });

  // What the planner, or their AI, gives each block: staff, powerboats, equipment and boats.
  const staff = (level: string, count: number) => ({ staff_level_id: level, count });
  const boats = (boat_class_id: string, count: number, sailor_owned: number | null = null) => ({
    boat_class_id,
    count,
    sailor_owned,
  });
  const ribs = (count: number, chartered: number | null = null) => ({ ...boats("rib", count), chartered });
  // Each block is given what a full program would use, and costs what its expected sailors use.
  const fallGiven = {
    staff: [staff(instructor2.staff_level_id, 4)],
    boats: [boats("opti", 12, 2), boats("420", 4, 1), ribs(2)],
  };
  const fallPractices = practice(fall, [2, 4], "16:00", "18:30", { on_water_minutes: 120 });
  const regattas = ["2026-10-17", "2026-10-18"].map((date) =>
    activity(fall.id, { date, start_time: "09:00", end_time: "16:00", on_water_minutes: 294, kind: "regatta" }),
  );
  const travelDays = ["2026-10-16", "2026-10-19"].map((date) =>
    activity(fall.id, {
      date,
      start_time: "08:00",
      end_time: "12:00",
      setup_minutes: 60,
      kind: "travel",
      trip_id: "fall-trip",
    }),
  );
  const springSkip = { on_water_minutes: 120, skip: ["2027-04-13", "2027-04-15"] };
  const springPractices = practice(spring, [2, 4], "16:00", "18:30", springSkip);
  const devPractices = practice(development, [2, 4], "16:00", "18:30", springSkip);
  const ltsPractices = practice(lts, [6], "09:00", "13:00", {
    on_water_minutes: 192,
    setup_minutes: 15,
    putaway_minutes: 15,
  });
  const campDays = campWeeks.flatMap((w) => practice(w, [1, 2, 3, 4, 5], "09:00", "15:00", { on_water_minutes: 216 }));
  const activities = [
    ...fallPractices,
    ...regattas,
    ...travelDays,
    ...springPractices,
    ...devPractices,
    ...ltsPractices,
    ...campDays,
  ];
  const allocations = blocks(
    ...fallPractices.map((a) => block([a], fallGiven, { name: "Fall racing" })),
    ...regattas.map((a) =>
      block([a], { ...fallGiven, boats: [boats("opti", 12, 2), boats("420", 4, 1), ribs(1, 1)] }, { name: "Regatta" }),
    ),
    ...travelDays.map((a) => block([a], { staff: [staff(instructor2.staff_level_id, 3)] }, { name: "Travel" })),
    // Spring racing and development share their coaches, with the director among them.
    ...springPractices.map((a) =>
      block(
        [a, devPractices.find((d) => d.date === a.date)!],
        {
          staff: [{ position_id: director.id, count: 1 }, staff(instructor2.staff_level_id, 3)],
          boats: [boats("opti", 11, 2), boats("420", 3, 1), ribs(2)],
        },
        { name: "Spring youth" },
      ),
    ),
    ...ltsPractices.map((a) =>
      block(
        [a],
        { staff: [staff(instructor1.staff_level_id, 2)], boats: [boats("keelboat", 2), ribs(1)] },
        { name: "Adult" },
      ),
    ),
    ...campDays.map((a) =>
      block(
        [a],
        { staff: [staff(instructor1.staff_level_id, 4)], boats: [boats("opti", 30), ribs(2)] },
        { name: "Camp" },
      ),
    ),
  );

  const ga = pool({ ...v("pool-ga"), name: "G&A" });
  const admin = pool({ ...v("pool-admin"), name: "Program admin" });
  director.remainder_pool_id = admin.id;
  facilities.remainder_pool_id = ga.id;

  return emptyPlan({
    fiscal_year: 2027,
    organization: { id: "org", name: "A club", fiscal_year_start_month: 7 },
    products: [racing, camp, adult, charters, storage, merch],
    program_areas: [youth, adults],
    boat_classes: [
      { id: "opti", name: "Opti", max_capacity: 1, footprint_sq_ft: 40 },
      { id: "420", name: "420", max_capacity: 2, footprint_sq_ft: 90 },
      { id: "keelboat", name: "Keelboat", max_capacity: 4, footprint_sq_ft: 300 },
      { id: "rib", name: "RIB", max_capacity: 0, footprint_sq_ft: null, account_id: A.ribs },
    ],
    ...assetList([
      { boat_class_id: "opti", count: 30 },
      { boat_class_id: "420", count: 10 },
      { boat_class_id: "keelboat", count: 3 },
      { boat_class_id: "rib", count: 4, kind: "powerboat" },
    ]),
    qualifications: [{ id: "q-race", name: "Race coach" }],
    plan_offerings: [fall, spring, development, lts, ...campWeeks, charterYear, storageYear, merchYear],
    plan_programs: [
      program(racing.id, { ...v("racing-settings"), staff_level_id: instructor2.staff_level_id, sailors_per_coach: 6 }),
      program(camp.id, { ...v("camp-settings"), staff_level_id: instructor1.staff_level_id, sailors_per_coach: 8 }),
      program(adult.id, { ...v("adult-settings"), staff_level_id: instructor1.staff_level_id, sailors_per_coach: 4 }),
    ],
    plan_activities: activities,
    ...allocations,
    plan_trips: [
      trip(fall.id, { ...v("fall-trip"), name: "Fall championship", nights: 2, miles: 300, airfare_cents: 0 }),
    ],
    plan_rates: [
      rates({
        ...v("rates"),
        lodging_per_night_cents: 15_000,
        mileage_rate_cents: 67,
      }),
    ],
    plan_payroll_taxes: [
      payrollTax({ ...v("social-security"), name: "Social Security", wage_share: 0.062 }),
      payrollTax({ ...v("medicare"), name: "Medicare", wage_share: 0.0145 }),
      payrollTax({ ...v("wa-unemployment"), name: "WA unemployment", wage_share: 0.0027 }),
      payrollTax({ ...v("l-and-i"), name: "L&I", hourly_cents: 45.235 }),
    ],
    plan_revenue_charges: [
      charge({
        ...v("card-fees"),
        name: "Card fees",
        rate: 0.03,
        product_kinds: ["program", "charter", "storage_lease", "merchandise", "event_hosting", "other"],
      }),
    ],
    staff_roles: [{ id: "instructor-role", name: "Instructor", sort: 1 }],
    staff_levels: [
      { id: "instructor", name: "Instructor", role_id: "instructor-role", grade: "standard" },
      { id: "senior-instructor", name: "Senior Instructor", role_id: "instructor-role", grade: "senior" },
    ],
    plan_staff_levels: [instructor1, instructor2],
    plan_salaried_positions: [director, facilities],
    plan_salaried_bookings: [
      {
        ...v("director-camp"),
        position_id: director.id,
        product_id: camp.id,
        program_area_id: null,
        hours: 80,
      },
    ],
    plan_boat_rates: [
      { ...v("rate-opti"), boat_class_id: "opti", maintenance_per_boat_hour_cents: 35 },
      { ...v("rate-420"), boat_class_id: "420", maintenance_per_boat_hour_cents: 60 },
      { ...v("rate-keelboat"), boat_class_id: "keelboat", maintenance_per_boat_hour_cents: 250 },
      {
        ...v("rate-rib"),
        boat_class_id: "rib",
        maintenance_per_boat_hour_cents: 150,
        fuel_per_hour_cents: 600,
        charter_per_day_cents: 30_000,
      },
    ],
    plan_labor_lines: [
      laborLine(instructor2.staff_level_id, {
        ...v("camp-prep"),
        name: "Camp head instructor prep",
        hours: 60,
        cost_center_type: "product",
        cost_center_id: camp.id,
      }),
      laborLine(instructor1.staff_level_id, {
        ...v("fleet-maintenance"),
        name: "Fleet maintenance labor",
        hours: 120,
        cost_center_type: "pool",
        cost_center_id: ga.id,
        account_id: A.boats,
      }),
    ],
    plan_budget_lines: [
      budgetLine({
        ...v("insurance"),
        name: "Insurance",
        amount_cents: 2_400_000,
        cost_center_type: "pool",
        cost_center_id: ga.id,
      }),
      budgetLine({
        ...v("clubhouse"),
        name: "Clubhouse fee",
        account_id: A.rent,
        amount_cents: 1_800_000,
        cost_center_type: "pool",
        cost_center_id: ga.id,
      }),
      budgetLine({
        ...v("gala"),
        name: "Fundraising gala",
        account_id: A.rent,
        function: "fundraising",
        amount_cents: 300_000,
      }),
      budgetLine({
        ...v("rib-purchase"),
        name: "New RIB",
        account_id: A.equipment,
        amount_cents: 2_500_000,
        in_mtdc: false,
      }),
      budgetLine({
        ...v("depreciation"),
        name: "Fleet depreciation",
        account_id: A.depreciation,
        amount_cents: 600_000,
        cost_center_type: "product",
        cost_center_id: racing.id,
      }),
      budgetLine({
        ...v("scholarships"),
        name: "Camp scholarships",
        account_id: A.scholarships,
        amount_cents: 400_000,
        in_mtdc: false,
        cost_center_type: "offering",
        cost_center_id: campWeeks[0]!.id,
      }),
    ],
    plan_pools: [admin, ga],
    plan_bonus_owners: [
      {
        ...v("owner-racing"),
        role_name: "Youth racing director",
        bonus_rate: 0.05,
        account_id: A.bonus,
      },
    ],
    plan_bonus_owner_products: [
      { ...v("owner-racing-product"), bonus_owner_id: "owner-racing", product_id: racing.id },
    ],
  });
}

function sum(lines: CostLine[], test: (l: CostLine) => boolean): number {
  return lines.filter(test).reduce((t, l) => t + l.amount_cents, 0);
}

describe("a realistic plan, end to end", () => {
  const data = withRate(realisticPlan(), 0.25);
  const out = computePlan(data);
  const { lines } = out;
  const offeringsOf = (productId: string) =>
    new Set((data.plan_offerings as OfferingInPlan[]).filter((o) => o.product_id === productId).map((o) => o.id));

  it("splits every pool over the offerings", () => {
    expect(lines.filter((l) => l.cost_center_type === "pool")).toEqual([]);
  });

  it("keeps every line's total through the pools", () => {
    expect(sum(lines, (l) => l.line_key.endsWith("budget:insurance"))).toBe(2_400_000);
    expect(sum(lines, (l) => l.line_key.endsWith("budget:clubhouse"))).toBe(1_800_000);
    expect(sum(lines, (l) => l.account_id === A.salaries)).toBe(7_000_000 + 5_200_000);
    expect(sum(lines, (l) => l.line_key.endsWith("labor:fleet-maintenance"))).toBe(120 * 2000);
  });

  it("counts the RIB purchase as a cost in the year it's bought", () => {
    expect(sum(lines, (l) => l.account_id === A.equipment)).toBe(2_500_000);
  });

  it("prices revenue as price × enrollment", () => {
    const revenueOf = (key: string) => sum(lines, (l) => l.line_key === `revenue:${key}`);
    expect(revenueOf("racing-fall")).toBe(18 * 85_000);
    expect(revenueOf("racing-spring")).toBe(16 * 85_000);
    expect(revenueOf("charters-year")).toBe(40 * 15_000);
    expect(revenueOf("storage-year")).toBe(50 * 48_000);
    expect(revenueOf("merch-year")).toBe(200 * 2500);
    expect(sum(lines, (l) => l.line_key === "cogs:merch-year")).toBe(250_000);
  });

  it("charges card fees on revenue, and payroll taxes on wages and paid hours", () => {
    const revenue = sum(lines, (l) => l.line_key.startsWith("revenue:"));
    expect(Math.abs(sum(lines, (l) => l.line_key.startsWith("charge:")) - 0.03 * revenue)).toBeLessThanOrEqual(10);
    expect(sum(lines, (l) => l.account_id === A.payrollTax)).toBeGreaterThan(0.0765 * 12_200_000);
  });

  it("costs the trip from its travel days' coaches", () => {
    // 3 coaches × 2 nights × 15000¢, and 300 miles × 67¢.
    expect(sum(lines, (l) => l.line_key === "trip:fall-trip")).toBe(3 * 2 * 15_000 + 300 * 67);
  });

  it("pays the director's coaching in the shared block", () => {
    expect(sum(lines, (l) => l.line_key === "salary:director:coaching")).toBeGreaterThan(0);
    expect(out.activities.every((a) => a.block_id !== null)).toBe(true);
  });

  it("earns the bonus on the owned product's net after every pool", () => {
    const owned = offeringsOf("youth-racing");
    const net = lines
      .filter((l) => l.cost_center_id !== null && owned.has(l.cost_center_id) && !l.line_key.startsWith("bonus:"))
      .reduce((t, l) => {
        const type = data.accounts.find((a) => a.id === l.account_id)?.type;
        return type === "revenue" ? t + l.amount_cents : type === "expense" ? t - l.amount_cents : t;
      }, 0);
    expect(Math.abs(sum(lines, (l) => l.line_key.startsWith("bonus:")) - 0.05 * Math.max(0, net))).toBeLessThanOrEqual(
      2,
    );
  });

  it("writes whole cents, the same every run", () => {
    expect(lines.every((l) => Number.isInteger(l.amount_cents))).toBe(true);
    expect(computePlan(data)).toEqual(out);
  });

  it("gives an offering's P&L for one day it runs and for one sailor on one day", () => {
    const camp = pnlOf(out, "camp-week-1");
    expect(camp.enrollment).toBe(27);
    expect(camp.days).toBe(5);
    expect(camp.sailor_days).toBe(135);
    expect(perDay(camp)?.revenue_cents).toBe((27 * 42_000) / 5);
    expect(perSailorDay(camp)?.revenue_cents).toBe(42_000 / 5);
    expect(perDay(camp)?.net_cents).toBe(Math.round(camp.net_cents / 5));
    expect(camp.revenue_cents - camp.expense_cents).toBe(camp.net_cents);
    expect(camp.by_account.reduce((t, a) => t + a.amount_cents, 0)).toBe(camp.revenue_cents + camp.expense_cents);
    expect(perDay(pnlOf(out, "merch-year"))).toBeNull();
  });

  it("gives the most sailors each offering's blocks take, and whether it pays for itself", () => {
    expect(pnlOf(out, "racing-fall")).toMatchObject({ max_enrollment: 24, allocation_holds: 24 });
    expect(pnlOf(out, "camp-week-1")).toMatchObject({ max_enrollment: 30, allocation_holds: 30 });
    // Every program loses money before fundraising, even when full.
    expect(pnlOf(out, "racing-fall").breakeven_enrollment).toBeNull();
    expect(pnlOf(out, "summer-camp", "product")).toMatchObject({ allocation_holds: null, breakeven_enrollment: null });
  });

  it("adds a product's offerings up into its P&L", () => {
    const camp = pnlOf(out, "summer-camp", "product");
    const weeks = ["camp-week-1", "camp-week-2"].map((k) => pnlOf(out, k));
    expect(camp.net_cents).toBe(weeks[0]!.net_cents + weeks[1]!.net_cents);
    expect(camp.days).toBe(10);
  });

  it("warns only about the programs that don't pay for themselves at their targets", () => {
    expect(out.warnings.map((w) => [w.code, w.subject_id, w.message])).toEqual([
      ["breakeven_above_target", "camp-week-1", "Summer Camp week 1 breaks even at 29. Target is 27."],
      ["never_breaks_even", "racing-fall", "Youth Racing Fall loses money even when full."],
    ]);
  });

  it("gives each product's P&L", () => {
    const pnl: Record<string, { revenue: number; expenses: number; net: number }> = {};
    for (const p of data.products) {
      const s = pnlOf(out, p.id, "product");
      pnl[p.name] = { revenue: s.revenue_cents, expenses: s.expense_cents, net: s.net_cents };
    }
    pnl["Organization"] = {
      revenue: 0,
      expenses: sum(
        lines,
        (l) => l.cost_center_type === "org" && data.accounts.find((a) => a.id === l.account_id)?.type === "expense",
      ),
      net: 0,
    };
    expect(pnl).toMatchInlineSnapshot(`
      {
        "Adult Learn to Sail": {
          "expenses": 281621,
          "net": 78379,
          "revenue": 360000,
        },
        "Charters": {
          "expenses": 18000,
          "net": 582000,
          "revenue": 600000,
        },
        "Merchandise": {
          "expenses": 265000,
          "net": 235000,
          "revenue": 500000,
        },
        "Organization": {
          "expenses": 18879941,
          "net": 0,
          "revenue": 0,
        },
        "Storage": {
          "expenses": 72000,
          "net": 2328000,
          "revenue": 2400000,
        },
        "Summer Camp": {
          "expenses": 1952624,
          "net": 315376,
          "revenue": 2268000,
        },
        "Youth Racing": {
          "expenses": 3905041,
          "net": -715041,
          "revenue": 3190000,
        },
      }
    `);
  });
});
