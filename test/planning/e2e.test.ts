// One plan shaped like a club's year: invented programs, rates and costs, every figure made up.
import { describe, expect, it } from "vitest";
import { computePlan, perDay, perSailorDay, type CostLine, type PlanData } from "../../src/planning/index.ts";
import {
  A,
  activity,
  blockRule,
  budgetLine,
  emptyPlan,
  laborLine,
  offering,
  pnlOf,
  pool,
  position,
  product,
  rates,
  staffLevel,
  trip,
  weekly,
} from "./fixtures.ts";

const v = (id: string) => ({ id, version_id: "v1", key: `${id}-key` });

function realisticPlan(): PlanData {
  const racing = product({ id: "youth-racing", name: "Youth Racing" });
  const camp = product({ id: "summer-camp", name: "Summer Camp" });
  const adult = product({ id: "adult-lts", name: "Adult Learn to Sail" });
  const charters = product({ id: "charters", name: "Charters", kind: "charter", revenue_account_id: A.charterRevenue });
  const storage = product({
    id: "storage",
    name: "Storage",
    kind: "storage_lease",
    revenue_account_id: A.charterRevenue,
  });
  const merch = product({ id: "merch", name: "Merchandise", kind: "merchandise" });

  const instructor1 = staffLevel({ ...v("level-i"), name: "Instructor I", hourly_rate_cents: 2000 });
  const instructor2 = staffLevel({
    ...v("level-ii"),
    name: "Instructor II",
    hourly_rate_cents: 2600,
    qualifications: ["q-race"],
  });

  const fall = offering(racing.id, {
    ...v("racing-fall"),
    name: "Youth Racing Fall",
    starts_on: "2026-09-08",
    ends_on: "2026-11-15",
    capacity: 24,
    fill_rate: 0.75,
    price_cents: 85_000,
    sailors_per_coach: 6,
    min_coaches: 2,
    ribs_per_coach: 0.5,
    byob_share: 0.25,
    coach_level_key: instructor2.key,
    required_qualification: "q-race",
  });
  const spring = offering(racing.id, {
    ...v("racing-spring"),
    name: "Youth Racing Spring",
    starts_on: "2027-03-02",
    ends_on: "2027-05-30",
    target_enrollment: 16,
    price_cents: 85_000,
    sailors_per_coach: 6,
    min_coaches: 2,
    ribs_per_coach: 0.5,
    byob_share: 0.25,
    coach_level_key: instructor2.key,
  });
  const development = offering(racing.id, {
    ...v("racing-dev"),
    name: "Youth Development Spring",
    starts_on: "2027-03-02",
    ends_on: "2027-05-30",
    target_enrollment: 5,
    price_cents: 60_000,
    sailors_per_coach: 6,
    min_coaches: 1,
    ribs_per_coach: 0.5,
    coach_level_key: instructor1.key,
  });
  const lts = offering(adult.id, {
    ...v("adult-lts-spring"),
    name: "Adult Learn to Sail",
    starts_on: "2027-05-01",
    ends_on: "2027-06-30",
    target_enrollment: 8,
    price_cents: 45_000,
    sailors_per_coach: 4,
    ribs_per_coach: 0.5,
    coach_level_key: instructor1.key,
  });
  const campWeeks = ["2027-06-14", "2027-06-21"].map((monday, i) =>
    offering(camp.id, {
      ...v(`camp-week-${i + 1}`),
      name: `Summer Camp week ${i + 1}`,
      starts_on: monday,
      ends_on: `2027-06-${String(Number(monday.slice(8)) + 4).padStart(2, "0")}`,
      capacity: 30,
      fill_rate: 0.9,
      price_cents: 42_000,
      sailors_per_coach: 8,
      min_coaches: 2,
      ribs_per_coach: 0.34,
      coach_level_key: instructor1.key,
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

  const boatClasses = (offeringId: string, shares: [string, number][]) =>
    shares.map(([boat_class_id, share]) => ({
      ...v(`${offeringId}-${boat_class_id}`),
      offering_id: offeringId,
      boat_class_id,
      share,
    }));

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
    paid_hours_per_year: null,
  });

  const ga = pool({ ...v("pool-ga"), name: "G&A" });
  const admin = pool({ ...v("pool-admin"), name: "Program admin" });
  director.remainder_pool_id = admin.id;
  facilities.remainder_pool_id = ga.id;

  return emptyPlan({
    fiscal_year: 2027,
    organization: { id: "org", name: "A club", fiscal_year_start_month: 7 },
    products: [racing, camp, adult, charters, storage, merch],
    boat_classes: [
      { id: "opti", name: "Opti", sailors_per_boat: 1, footprint_sq_ft: 40 },
      { id: "420", name: "420", sailors_per_boat: 2, footprint_sq_ft: 90 },
      { id: "keelboat", name: "Keelboat", sailors_per_boat: 4, footprint_sq_ft: 300 },
    ],
    qualifications: [{ id: "q-race", name: "Race coach" }],
    plan_offerings: [fall, spring, development, lts, ...campWeeks, charterYear, storageYear, merchYear],
    plan_offering_boat_classes: [
      ...boatClasses(fall.id, [
        ["opti", 0.5],
        ["420", 0.5],
      ]),
      ...boatClasses(spring.id, [
        ["opti", 0.5],
        ["420", 0.5],
      ]),
      ...boatClasses(development.id, [["opti", 1]]),
      ...boatClasses(lts.id, [["keelboat", 1]]),
      ...campWeeks.flatMap((w) => boatClasses(w.id, [["opti", 1]])),
    ],
    plan_activities: [
      ...practice(fall, [2, 4], "16:00", "18:30", { on_water_minutes: 120 }),
      ...["2026-10-17", "2026-10-18"].map((date) =>
        activity(fall.id, { date, start_time: "09:00", end_time: "16:00", on_water_minutes: 294, kind: "regatta" }),
      ),
      ...["2026-10-16", "2026-10-19"].map((date) =>
        activity(fall.id, {
          date,
          start_time: "08:00",
          end_time: "12:00",
          setup_minutes: 60,
          kind: "travel",
          trip_id: "fall-trip",
        }),
      ),
      ...practice(spring, [2, 4], "16:00", "18:30", { on_water_minutes: 120, skip: ["2027-04-13", "2027-04-15"] }),
      ...practice(development, [2, 4], "16:00", "18:30", {
        on_water_minutes: 120,
        skip: ["2027-04-13", "2027-04-15"],
      }),
      ...practice(lts, [6], "09:00", "13:00", { on_water_minutes: 192, setup_minutes: 15, putaway_minutes: 15 }),
      ...campWeeks.flatMap((w) => practice(w, [1, 2, 3, 4, 5], "09:00", "15:00", { on_water_minutes: 216 })),
    ],
    plan_trips: [
      trip(fall.id, { ...v("fall-trip"), name: "Fall championship", nights: 2, miles: 300, airfare_cents: 0 }),
    ],
    plan_rates: [
      rates({
        ...v("rates"),
        payroll_tax_rate: 0.0765,
        card_fee_rate: 0.03,
        lodging_per_night_cents: 15_000,
        mileage_rate_cents: 67,
      }),
    ],
    plan_staff_levels: [instructor1, instructor2],
    plan_salaried_positions: [director, facilities],
    plan_salaried_bookings: [
      {
        ...v("director-camp"),
        position_id: director.id,
        product_id: camp.id,
        kind: "management",
        hours: 80,
      },
    ],
    plan_resources: [
      {
        ...v("rib-small"),
        resource_kind_id: "kind-rib",
        name: "Small RIB",
        quantity: 3,
        cost_per_hour_cents: 0,
        cost_per_day_cents: 200,
        fuel_per_hour_cents: 600,
        maintenance_per_hour_cents: 150,
        excluded_from_mtdc: false,
      },
      {
        ...v("rib-large"),
        resource_kind_id: "kind-rib",
        name: "Large RIB",
        quantity: 1,
        cost_per_hour_cents: 0,
        cost_per_day_cents: 300,
        fuel_per_hour_cents: 1200,
        maintenance_per_hour_cents: 250,
        excluded_from_mtdc: true,
      },
    ],
    plan_boat_rates: [
      { ...v("rate-opti"), boat_class_id: "opti", maintenance_per_boat_hour_cents: 35 },
      { ...v("rate-420"), boat_class_id: "420", maintenance_per_boat_hour_cents: 60 },
      { ...v("rate-keelboat"), boat_class_id: "keelboat", maintenance_per_boat_hour_cents: 250 },
    ],
    plan_activity_block_rules: [
      blockRule([spring.key, development.key], {
        ...v("spring-block"),
        name: "Spring youth",
        weekdays: [2, 4],
        salaried_positions: [director.key],
      }),
    ],
    plan_labor_lines: [
      laborLine(instructor2.key, {
        ...v("camp-prep"),
        name: "Camp head instructor prep",
        hours: 60,
        cost_center_type: "product",
        cost_center_key: camp.id,
      }),
      laborLine(instructor1.key, {
        ...v("fleet-maintenance"),
        name: "Fleet maintenance labor",
        hours: 120,
        cost_center_type: "pool",
        cost_center_key: ga.key,
        account_id: A.boats,
      }),
    ],
    plan_budget_lines: [
      budgetLine({
        ...v("insurance"),
        name: "Insurance",
        amount_cents: 2_400_000,
        cost_center_type: "pool",
        cost_center_key: ga.key,
      }),
      budgetLine({
        ...v("clubhouse"),
        name: "Clubhouse fee",
        account_id: A.rent,
        amount_cents: 1_800_000,
        cost_center_type: "pool",
        cost_center_key: ga.key,
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
        excluded_from_mtdc: true,
      }),
      budgetLine({
        ...v("depreciation"),
        name: "Fleet depreciation",
        account_id: A.depreciation,
        amount_cents: 600_000,
        cost_center_type: "product",
        cost_center_key: racing.id,
      }),
      budgetLine({
        ...v("scholarships"),
        name: "Camp scholarships",
        account_id: A.scholarships,
        amount_cents: 400_000,
        excluded_from_mtdc: true,
        cost_center_type: "offering",
        cost_center_key: campWeeks[0]!.key,
      }),
    ],
    plan_pools: [admin, ga],
    plan_bonus_owners: [
      {
        ...v("owner-racing"),
        role_name: "Youth racing head coach",
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
  const data = realisticPlan();
  const out = computePlan(data);
  const { lines } = out;
  const offeringsOf = (productId: string) =>
    new Set(data.plan_offerings.filter((o) => o.product_id === productId).map((o) => o.key));

  it("splits every pool over the offerings", () => {
    expect(lines.filter((l) => l.cost_center_type === "pool")).toEqual([]);
  });

  it("keeps every line's total through the pools", () => {
    expect(sum(lines, (l) => l.line_key.endsWith("budget:insurance-key"))).toBe(2_400_000);
    expect(sum(lines, (l) => l.line_key.endsWith("budget:clubhouse-key"))).toBe(1_800_000);
    expect(sum(lines, (l) => l.account_id === A.salaries)).toBe(7_000_000 + 5_200_000);
    expect(sum(lines, (l) => l.line_key.endsWith("labor:fleet-maintenance-key"))).toBe(120 * 2000);
  });

  it("counts the RIB purchase as a cost in the year it's bought", () => {
    expect(sum(lines, (l) => l.account_id === A.equipment)).toBe(2_500_000);
  });

  it("prices revenue as price × enrollment", () => {
    const revenueOf = (key: string) => sum(lines, (l) => l.line_key === `revenue:${key}`);
    expect(revenueOf("racing-fall-key")).toBe(18 * 85_000);
    expect(revenueOf("racing-spring-key")).toBe(16 * 85_000);
    expect(revenueOf("charters-year-key")).toBe(40 * 15_000);
    expect(revenueOf("storage-year-key")).toBe(50 * 48_000);
    expect(revenueOf("merch-year-key")).toBe(200 * 2500);
    expect(sum(lines, (l) => l.line_key === "cogs:merch-year-key")).toBe(250_000);
  });

  it("charges card fees on revenue and payroll tax on wages", () => {
    const revenue = sum(lines, (l) => l.line_key.startsWith("revenue:"));
    expect(Math.abs(sum(lines, (l) => l.line_key.startsWith("card_fees:")) - 0.03 * revenue)).toBeLessThanOrEqual(10);
    expect(sum(lines, (l) => l.account_id === A.payrollTax)).toBeGreaterThan(0.0765 * 12_200_000);
  });

  it("costs the trip from its travel days' coaches", () => {
    // 3 coaches × 2 nights × 15000¢, and 300 miles × 67¢.
    expect(sum(lines, (l) => l.line_key === "trip:fall-trip-key")).toBe(3 * 2 * 15_000 + 300 * 67);
  });

  it("pays the director's coaching in the shared block", () => {
    expect(sum(lines, (l) => l.line_key === "salary:director-key:coaching")).toBeGreaterThan(0);
    expect(out.activities.filter((a) => a.block_rule_id !== null).length).toBeGreaterThan(0);
  });

  it("earns the bonus on the owned product's net after every pool", () => {
    const owned = offeringsOf("youth-racing");
    const net = lines
      .filter((l) => l.cost_center_key !== null && owned.has(l.cost_center_key) && !l.line_key.startsWith("bonus:"))
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
    const camp = pnlOf(out, "camp-week-1-key");
    expect(camp.enrollment).toBe(27);
    expect(camp.days).toBe(5);
    expect(camp.sailor_days).toBe(135);
    expect(perDay(camp)?.revenue_cents).toBe((27 * 42_000) / 5);
    expect(perSailorDay(camp)?.revenue_cents).toBe(42_000 / 5);
    expect(perDay(camp)?.net_cents).toBe(Math.round(camp.net_cents / 5));
    expect(camp.revenue_cents - camp.expense_cents).toBe(camp.net_cents);
    expect(camp.by_account.reduce((t, a) => t + a.amount_cents, 0)).toBe(camp.revenue_cents + camp.expense_cents);
    expect(perDay(pnlOf(out, "merch-year-key"))).toBeNull();
  });

  it("adds a product's offerings up into its P&L", () => {
    const camp = pnlOf(out, "summer-camp", "product");
    const weeks = ["camp-week-1-key", "camp-week-2-key"].map((k) => pnlOf(out, k));
    expect(camp.net_cents).toBe(weeks[0]!.net_cents + weeks[1]!.net_cents);
    expect(camp.days).toBe(10);
  });

  it("raises no warnings", () => {
    expect(out.warnings).toEqual([]);
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
          "expenses": 1044939,
          "net": -684939,
          "revenue": 360000,
        },
        "Charters": {
          "expenses": 85697,
          "net": 514303,
          "revenue": 600000,
        },
        "Merchandise": {
          "expenses": 1261674,
          "net": -761674,
          "revenue": 500000,
        },
        "Organization": {
          "expenses": 2800000,
          "net": 0,
          "revenue": 0,
        },
        "Storage": {
          "expenses": 342796,
          "net": 2057204,
          "revenue": 2400000,
        },
        "Summer Camp": {
          "expenses": 6170167,
          "net": -3902167,
          "revenue": 2268000,
        },
        "Youth Racing": {
          "expenses": 13128141,
          "net": -9938141,
          "revenue": 3190000,
        },
      }
    `);
  });
});
