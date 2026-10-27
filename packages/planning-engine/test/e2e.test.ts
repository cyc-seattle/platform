// One plan shaped like a club's year: invented programs, rates and costs, every figure made up.
import { describe, expect, it } from "vitest";
import { computePlan, type EngineOutput, type PlanData, type PlanResult } from "../src/index.ts";
import {
  A,
  blockRule,
  budgetLine,
  emptyPlan,
  formula,
  laborLine,
  offering,
  pool,
  poolShare,
  position,
  product,
  rule,
  staffLevel,
  trip,
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
  const instructor1Raise = staffLevel({
    ...v("level-i-2027"),
    name: "Instructor I",
    hourly_rate_cents: 2200,
    effective_from: "2027-04-01",
  });
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
    registration_curve: { "2027-01": 0.5, "2027-02": 0.4, "2027-03": 0.1 },
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
      registration_curve: { "2027-02": 0.3, "2027-03": 0.3, "2027-04": 0.2, "2027-05": 0.2 },
    }),
  );
  const charterYear = offering(charters.id, {
    ...v("charters-year"),
    starts_on: "2026-07-01",
    ends_on: "2027-06-30",
    price_cents: 15_000,
    price_basis: "per_unit",
    units: 40,
  });
  const storageYear = offering(storage.id, {
    ...v("storage-year"),
    starts_on: "2026-07-01",
    ends_on: "2027-06-30",
    target_enrollment: 50,
    price_cents: 4000,
    price_basis: "per_month",
  });
  const merchYear = offering(merch.id, {
    ...v("merch-year"),
    starts_on: "2026-07-01",
    ends_on: "2027-06-30",
    price_cents: 2500,
    price_basis: "per_unit",
    units: 200,
    cogs_rate: 0.5,
  });

  const boatClasses = (offeringId: string, shares: [string, number][]) =>
    shares.map(([boat_class_id, share]) => ({
      ...v(`${offeringId}-${boat_class_id}`),
      offering_id: offeringId,
      boat_class_id,
      share,
    }));

  const practice = (o: { id: string }, weekdays: number[], start: string, end: string, extra = {}) =>
    rule(o.id, {
      weekdays,
      start_time: start,
      end_time: end,
      setup_minutes: 30,
      putaway_minutes: 30,
      on_water_fraction: 0.8,
      ...extra,
    });

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

  const ga = pool({
    ...v("pool-ga"),
    name: "G&A",
    step_order: 3,
    method: "base_share",
    base: "mtdc",
    targets_filter: { exclude_product_ids: [merch.id] },
    phasing: "by_base",
  });
  const admin = pool({
    ...v("pool-admin"),
    name: "Program admin",
    step_order: 2,
    method: "fixed_shares",
    remainder_pool_id: ga.id,
  });
  const area = pool({
    ...v("pool-area"),
    name: "Storage area",
    step_order: 1,
    method: "area",
    denominator_quantity: 5000,
    unit: "sq_ft",
    remainder_pool_id: ga.id,
  });
  director.remainder_pool_id = admin.id;
  facilities.remainder_pool_id = ga.id;

  return emptyPlan({
    fiscal_year: 2027,
    fiscal_year_start_month: 7,
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
    plan_offering_prices: [
      { ...v("spring-member"), offering_id: spring.id, tier: "member", price_cents: 80_000, share: 0.6 },
    ],
    plan_schedule_rules: [
      practice(fall, [2, 4], "16:00", "18:30"),
      rule(fall.id, {
        ...v("fall-regatta"),
        weekdays: [6, 7],
        start_time: "09:00",
        end_time: "16:00",
        starts_on: "2026-10-17",
        ends_on: "2026-10-18",
        kind: "regatta",
        on_water_fraction: 0.7,
      }),
      practice(spring, [2, 4], "16:00", "18:30", { skip_dates: ["2027-04-13", "2027-04-15"] }),
      practice(development, [2, 4], "16:00", "18:30", { skip_dates: ["2027-04-13", "2027-04-15"] }),
      practice(lts, [6], "09:00", "13:00", { setup_minutes: 15, putaway_minutes: 15 }),
      ...campWeeks.map((w) =>
        practice(w, [1, 2, 3, 4, 5], "09:00", "15:00", { on_water_fraction: 0.6, kind: "camp_week" }),
      ),
    ],
    plan_trips: [
      trip(fall.id, {
        ...v("fall-trip"),
        name: "Fall championship",
        starts_on: "2026-10-17",
        ends_on: "2026-10-18",
        pre_travel_days: 1,
        post_travel_days: 1,
        travel_hours_per_day: 4,
        load_minutes: 90,
        unload_minutes: 60,
        nights: 2,
        miles: 300,
      }),
    ],
    plan_assumptions: [
      { ...v("payroll-tax"), name: "payroll_tax_rate", value: 0.0765, unit: "ratio", effective_from: null, note: null },
      { ...v("workers-comp"), name: "workers_comp_rate", value: 0.02, unit: "ratio", effective_from: null, note: null },
      {
        ...v("lodging"),
        name: "lodging_per_night_cents",
        value: 15_000,
        unit: "cents",
        effective_from: null,
        note: null,
      },
      { ...v("mileage"), name: "mileage_rate_cents", value: 67, unit: "cents", effective_from: null, note: null },
      {
        ...v("maintenance-hours"),
        name: "maintenance_hours",
        value: 120,
        unit: "hours",
        effective_from: null,
        note: null,
      },
    ],
    plan_staff_levels: [instructor1, instructor1Raise, instructor2],
    plan_salaried_positions: [director, facilities],
    plan_salaried_bookings: [
      {
        ...v("director-camp"),
        position_id: director.id,
        product_id: camp.id,
        starts_on: "2027-05-01",
        ends_on: "2027-06-30",
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
        effective_from: null,
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
        effective_from: null,
      },
    ],
    plan_boat_rates: [
      { ...v("rate-opti"), boat_class_id: "opti", maintenance_per_boat_hour_cents: 35, effective_from: null },
      { ...v("rate-420"), boat_class_id: "420", maintenance_per_boat_hour_cents: 60, effective_from: null },
      { ...v("rate-keelboat"), boat_class_id: "keelboat", maintenance_per_boat_hour_cents: 250, effective_from: null },
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
        phasing: { "2027-05": 0.5, "2027-06": 0.5 },
      }),
      laborLine(instructor1.key, {
        ...v("fleet-maintenance"),
        name: "Fleet maintenance labor",
        hours: null,
        hours_formula: "maintenance_hours",
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
        amount_cents: 150_000,
        phasing_mode: "monthly_rate",
        cost_center_type: "pool",
        cost_center_key: area.key,
      }),
      budgetLine({
        ...v("gala"),
        name: "Fundraising gala",
        account_id: A.rent,
        function: "fundraising",
        amount_cents: 300_000,
        phasing: { "2027-02": 1 },
      }),
      budgetLine({
        ...v("rib-purchase"),
        name: "New RIB",
        account_id: A.equipment,
        amount_cents: 2_500_000,
        is_capital: true,
        phasing: { "2027-03": 1 },
      }),
      budgetLine({
        ...v("depreciation"),
        name: "Fleet depreciation",
        account_id: A.depreciation,
        amount_cents: 600_000,
        is_non_cash: true,
        cost_center_type: "product",
        cost_center_key: racing.id,
        spread: "by_months",
      }),
      budgetLine({
        ...v("scholarships"),
        name: "Camp scholarships",
        account_id: A.scholarships,
        amount_cents: 400_000,
        is_participant_support: true,
        cost_center_type: "offering",
        cost_center_key: campWeeks[0]!.key,
        phasing: { "2027-06": 1 },
      }),
    ],
    plan_pools: [area, admin, ga],
    plan_pool_shares: [
      poolShare(area.id, racing.id, { ...v("area-racing"), target_type: "product", quantity: 1500 }),
      poolShare(area.id, camp.id, {
        ...v("area-camp"),
        target_type: "product",
        quantity: 1000,
        starts_on: "2027-06-01",
        ends_on: "2027-08-31",
      }),
      poolShare(area.id, storageYear.key, { ...v("area-storage"), quantity: 2000 }),
      poolShare(admin.id, racing.id, { ...v("admin-racing"), target_type: "product", share: 0.5 }),
      poolShare(admin.id, adult.id, { ...v("admin-adult"), target_type: "product", share: 0.2 }),
      poolShare(admin.id, camp.id, {
        ...v("admin-camp"),
        target_type: "product",
        share: 0.3,
        starts_on: "2027-06-01",
        ends_on: "2027-08-31",
      }),
    ],
    plan_formulas: [
      formula({
        ...v("f-payroll"),
        name: "payroll_tax",
        dimension: "offering",
        expression: "wages * payroll_tax_rate",
        account_id: A.payrollTax,
      }),
      formula({
        ...v("f-comp"),
        name: "workers_comp",
        dimension: "month",
        expression: "wages * workers_comp_rate",
        account_id: A.payrollTax,
        excluded_from_base: true,
      }),
    ],
    plan_formula_deps: [
      { ...v("d1"), formula_id: "f-payroll", depends_on: "wages" },
      { ...v("d2"), formula_id: "f-payroll", depends_on: "payroll_tax_rate" },
      { ...v("d3"), formula_id: "f-comp", depends_on: "wages" },
      { ...v("d4"), formula_id: "f-comp", depends_on: "workers_comp_rate" },
    ],
    plan_bonus_owners: [
      {
        ...v("owner-racing"),
        role_name: "Youth racing head coach",
        bonus_rate: 0.05,
        account_id: A.bonus,
        starts_on: null,
        ends_on: null,
      },
    ],
    plan_bonus_owner_products: [
      { ...v("owner-racing-product"), bonus_owner_id: "owner-racing", product_id: racing.id },
    ],
  });
}

function sum(rows: PlanResult[], test: (r: PlanResult) => boolean): number {
  return rows.filter(test).reduce((t, r) => t + r.amount_cents, 0);
}

const accrual = (out: EngineOutput) => out.plan_results.filter((r) => r.basis === "accrual");

describe("a realistic plan, end to end", () => {
  const data = realisticPlan();
  const out = computePlan(data);
  const rows = accrual(out);
  const offeringsOf = (productId: string) =>
    new Set(data.plan_offerings.filter((o) => o.product_id === productId).map((o) => o.key));

  it("allocates every pool away", () => {
    expect(out.plan_results.filter((r) => r.cost_center_type === "pool")).toEqual([]);
  });

  it("keeps every line's total through the pools", () => {
    expect(sum(rows, (r) => r.line_key.endsWith("budget:insurance-key"))).toBe(2_400_000);
    expect(sum(rows, (r) => r.line_key.endsWith("budget:clubhouse-key"))).toBe(1_800_000);
    expect(sum(rows, (r) => r.account_id === A.salaries)).toBe(7_000_000 + 5_200_000);
    // 120 h at Instructor I: 2000¢ until April, 2200¢ after.
    expect(sum(rows, (r) => r.line_key.endsWith("labor:fleet-maintenance-key"))).toBe(9 * 10 * 2000 + 3 * 10 * 2200);
  });

  it("books capital to cash and depreciation to accrual", () => {
    expect(sum(rows, (r) => r.account_id === A.equipment)).toBe(0);
    expect(sum(out.plan_results, (r) => r.basis === "cash" && r.account_id === A.equipment)).toBe(2_500_000);
    expect(sum(rows, (r) => r.account_id === A.depreciation)).toBe(600_000);
    expect(sum(out.plan_results, (r) => r.basis === "cash" && r.account_id === A.depreciation)).toBe(0);
  });

  it("prices revenue by each offering's basis", () => {
    const revenueOf = (key: string) => sum(rows, (r) => r.line_key === `revenue:${key}`);
    expect(revenueOf("racing-fall-key")).toBe(18 * 85_000);
    expect(revenueOf("racing-spring-key")).toBe(16 * (0.6 * 80_000 + 0.4 * 85_000));
    expect(revenueOf("charters-year-key")).toBe(40 * 15_000);
    expect(revenueOf("storage-year-key")).toBe(50 * 4000 * 12);
    expect(revenueOf("merch-year-key")).toBe(200 * 2500);
    expect(sum(rows, (r) => r.line_key === "cogs:merch-year-key")).toBe(250_000);
  });

  it("collects camp cash on its registration curve, before the camp runs", () => {
    const cash = out.plan_results.filter((r) => r.basis === "cash" && r.line_key === "revenue:camp-week-1-key");
    expect(cash.map((r) => r.month)).toEqual(["2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01"]);
    expect(cash.reduce((t, r) => t + r.amount_cents, 0)).toBe(27 * 42_000);
  });

  it("keeps merchandise out of G&A", () => {
    expect(sum(rows, (r) => r.cost_center_key === "merch-year-key" && r.line_key.startsWith("pool:pool-ga-key"))).toBe(
      0,
    );
  });

  it("pays the director's block coaching and passes the rest down to G&A", () => {
    const coaching = sum(rows, (r) => r.line_key === "salary:director-key:coaching");
    expect(coaching).toBeGreaterThan(0);
    expect(out.activities.filter((a) => a.block_rule_id !== null).length).toBeGreaterThan(0);
  });

  it("earns the bonus on the owned product's net after every pool", () => {
    const owned = offeringsOf("youth-racing");
    const net = rows
      .filter((r) => r.cost_center_key !== null && owned.has(r.cost_center_key) && !r.line_key.startsWith("bonus:"))
      .reduce((t, r) => {
        const type = data.accounts.find((a) => a.id === r.account_id)?.type;
        return type === "revenue" ? t + r.amount_cents : type === "expense" ? t - r.amount_cents : t;
      }, 0);
    expect(Math.abs(sum(rows, (r) => r.line_key.startsWith("bonus:")) - 0.05 * Math.max(0, net))).toBeLessThanOrEqual(
      2,
    );
  });

  it("writes whole cents, inside the fiscal year, and the same every run", () => {
    expect(out.plan_results.every((r) => Number.isInteger(r.amount_cents))).toBe(true);
    expect(out.plan_results.every((r) => r.month >= "2026-07-01" && r.month <= "2027-06-01")).toBe(true);
    expect(computePlan(data)).toEqual(out);
  });

  it("records metrics for every program offering", () => {
    for (const key of [
      "racing-fall-key",
      "racing-spring-key",
      "racing-dev-key",
      "adult-lts-spring-key",
      "camp-week-1-key",
    ]) {
      const metrics = new Set(out.plan_metrics.filter((m) => m.cost_center_key === key).map((m) => m.metric));
      expect([...metrics].sort()).toEqual([
        "boat_hours",
        "coach_hours",
        "enrollment",
        "mtdc",
        "paid_hours",
        "rib_hours",
        "wages",
      ]);
    }
  });

  it("raises no warnings", () => {
    expect(out.warnings).toEqual([]);
  });

  it("gives each product's P&L", () => {
    const pnl: Record<string, { revenue: number; expenses: number; net: number }> = {};
    for (const p of data.products) {
      const keys = offeringsOf(p.id);
      const of = (type: string) =>
        sum(
          rows,
          (r) =>
            r.cost_center_key !== null &&
            keys.has(r.cost_center_key) &&
            data.accounts.find((a) => a.id === r.account_id)?.type === type,
        );
      pnl[p.name] = { revenue: of("revenue"), expenses: of("expense"), net: of("revenue") - of("expense") };
    }
    pnl["Org"] = {
      revenue: 0,
      expenses: sum(
        rows,
        (r) => r.cost_center_type === "org" && data.accounts.find((a) => a.id === r.account_id)?.type === "expense",
      ),
      net: 0,
    };
    expect(pnl).toMatchInlineSnapshot(`
      {
        "Adult Learn to Sail": {
          "expenses": 966239,
          "net": -606239,
          "revenue": 360000,
        },
        "Charters": {
          "expenses": 0,
          "net": 600000,
          "revenue": 600000,
        },
        "Merchandise": {
          "expenses": 250000,
          "net": 250000,
          "revenue": 500000,
        },
        "Org": {
          "expenses": 357318,
          "net": 0,
          "revenue": 0,
        },
        "Storage": {
          "expenses": 720000,
          "net": 1680000,
          "revenue": 2400000,
        },
        "Summer Camp": {
          "expenses": 4713499,
          "net": -2445499,
          "revenue": 2268000,
        },
        "Youth Racing": {
          "expenses": 11192761,
          "net": -8050761,
          "revenue": 3142000,
        },
      }
    `);
  });
});
