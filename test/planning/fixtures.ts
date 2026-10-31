// Small invented fixtures. Every figure here is made up.
import type {
  Account,
  CostLine,
  EngineOutput,
  PlanActivity,
  PlanActivityBlockRule,
  PlanBudgetLine,
  PlanData,
  PlanLaborLine,
  PlanOffering,
  PlanPool,
  PlanRates,
  PlanRevenueCharge,
  PlanSalariedPosition,
  PlanStaffLevel,
  PlanTrip,
  Pnl,
  Product,
  ProgramArea,
} from "../../src/planning/index.ts";

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function versioned(prefix: string): { id: string; version_id: string; key: string } {
  const id = nextId(prefix);
  return { id, version_id: "v1", key: `${id}-key` };
}

function account(
  id: string,
  number: string,
  type: Account["type"],
  default_function: Account["default_function"] = null,
): Account {
  return {
    id,
    number,
    name: id,
    type,
    form_990_part: null,
    form_990_line: null,
    default_function,
    parent_id: null,
    contra_account_id: null,
    retired: false,
  };
}

export const A = {
  programRevenue: "acct-program-revenue",
  charterRevenue: "acct-charter-revenue",
  coachWages: "acct-coach-wages",
  salaries: "acct-salaries",
  ribs: "acct-ribs",
  boats: "acct-boats",
  resources: "acct-resources",
  travel: "acct-travel",
  cogs: "acct-cogs",
  insurance: "acct-insurance",
  payrollTax: "acct-payroll-tax",
  bonus: "acct-bonus",
  depreciation: "acct-depreciation",
  equipment: "acct-equipment",
  scholarships: "acct-scholarships",
  rent: "acct-rent",
  cardFees: "acct-card-fees",
} as const;

export function emptyPlan(overrides: Partial<PlanData> = {}): PlanData {
  return {
    fiscal_year: 2027,
    organization: { id: "org", name: "A club", fiscal_year_start_month: 1 },
    organization_cost_accounts: (
      [
        ["coach_wages", A.coachWages],
        ["salaries", A.salaries],
        ["payroll_tax", A.payrollTax],
        ["ribs", A.ribs],
        ["boat_maintenance", A.boats],
        ["resources", A.resources],
        ["travel", A.travel],
        ["cogs", A.cogs],
      ] as const
    ).map(([cost_type, account_id]) => ({ id: `cost-${cost_type}`, organization_id: "org", cost_type, account_id })),
    rib_resource_kind_id: "kind-rib",
    products: [],
    program_areas: [],
    accounts: [
      account(A.programRevenue, "4100", "revenue"),
      account(A.charterRevenue, "4200", "revenue"),
      account(A.coachWages, "5100", "expense", "program"),
      account(A.salaries, "5110", "expense"),
      account(A.payrollTax, "5120", "expense"),
      account(A.bonus, "5130", "expense", "program"),
      account(A.ribs, "5200", "expense", "program"),
      account(A.boats, "5210", "expense", "program"),
      account(A.resources, "5220", "expense", "program"),
      account(A.travel, "5300", "expense", "program"),
      account(A.cogs, "5400", "expense", "program"),
      account(A.scholarships, "5500", "expense", "program"),
      account(A.insurance, "6100", "expense", "management"),
      account(A.rent, "6150", "expense"),
      account(A.cardFees, "6160", "expense"),
      account(A.depreciation, "6200", "expense"),
      account(A.equipment, "6300", "expense"),
    ],
    qualifications: [],
    qualification_covers: [],
    boat_classes: [],
    resource_kinds: [{ id: "kind-rib", name: "RIB" }],
    plans: [],
    plan_versions: [],
    plan_offerings: [],
    plan_offering_boat_classes: [],
    plan_trips: [],
    plan_activities: [],
    plan_activity_resources: [],
    plan_labor_lines: [],
    plan_budget_lines: [],
    plan_rates: [],
    plan_revenue_charges: [],
    plan_staff_levels: [],
    plan_salaried_positions: [],
    plan_salaried_bookings: [],
    plan_resources: [],
    plan_boat_rates: [],
    plan_activity_block_rules: [],
    plan_pools: [],
    plan_bonus_owners: [],
    plan_bonus_owner_products: [],
    ...overrides,
  };
}

export function product(overrides: Partial<Product> = {}): Product {
  return {
    id: nextId("product"),
    name: "A program",
    kind: "program",
    revenue_account_id: A.programRevenue,
    program_area_id: null,
    ...overrides,
  };
}

export function area(overrides: Partial<ProgramArea> = {}): ProgramArea {
  return { id: nextId("area"), name: "An area", revenue_account_id: A.programRevenue, ...overrides };
}

export function charge(overrides: Partial<PlanRevenueCharge> = {}): PlanRevenueCharge {
  return {
    ...versioned("charge"),
    name: "A charge",
    rate: 0,
    product_kinds: ["program"],
    account_id: A.cardFees,
    excluded_from_mtdc: false,
    note: null,
    ...overrides,
  };
}

export function offering(productId: string, overrides: Partial<PlanOffering> = {}): PlanOffering {
  return {
    ...versioned("offering"),
    product_id: productId,
    name: "An offering",
    season_term: null,
    starts_on: "2027-06-01",
    ends_on: "2027-06-30",
    capacity: null,
    target_enrollment: null,
    fill_rate: null,
    price_cents: null,
    sailors_per_coach: null,
    min_coaches: null,
    coach_level_key: null,
    required_qualification: null,
    ribs_per_coach: null,
    byob_share: null,
    fixed_coaches: null,
    fixed_ribs: null,
    fixed_boats: null,
    cogs_rate: null,
    note: null,
    ...overrides,
  };
}

export function trip(offeringId: string, overrides: Partial<PlanTrip> = {}): PlanTrip {
  return {
    ...versioned("trip"),
    offering_id: offeringId,
    name: "A regatta",
    nights: null,
    airfare_cents: null,
    miles: null,
    ...overrides,
  };
}

export function activity(offeringId: string, overrides: Partial<PlanActivity> = {}): PlanActivity {
  return {
    ...versioned("activity"),
    offering_id: offeringId,
    trip_id: null,
    date: "2027-06-01",
    start_time: "16:00",
    end_time: "18:00",
    on_water_minutes: null,
    setup_minutes: null,
    putaway_minutes: null,
    kind: "practice",
    uses_boats: true,
    fixed_coaches: null,
    fixed_ribs: null,
    fixed_boats: null,
    ...overrides,
  };
}

/** One activity on each date from `from` to `to` that falls on one of `weekdays` (ISO, 1 = Monday). */
export function weekly(
  offeringId: string,
  weekdays: number[],
  from: string,
  to: string,
  overrides: Partial<PlanActivity> = {},
): PlanActivity[] {
  const out: PlanActivity[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (weekdays.includes(weekday))
      out.push(activity(offeringId, { date: d.toISOString().slice(0, 10), ...overrides }));
  }
  return out;
}

export function staffLevel(overrides: Partial<PlanStaffLevel> = {}): PlanStaffLevel {
  return {
    ...versioned("level"),
    name: "Coach",
    pay_type: "hourly",
    hourly_rate_cents: 2000,
    qualifications: null,
    ...overrides,
  };
}

export function blockRule(
  offeringKeys: string[],
  overrides: Partial<PlanActivityBlockRule> = {},
): PlanActivityBlockRule {
  return {
    ...versioned("block"),
    name: "A block",
    offering_keys: offeringKeys,
    weekdays: null,
    starts_on: null,
    ends_on: null,
    coach_level_id: null,
    salaried_positions: null,
    ...overrides,
  };
}

export function budgetLine(overrides: Partial<PlanBudgetLine> = {}): PlanBudgetLine {
  return {
    ...versioned("budget"),
    name: "A line",
    account_id: A.insurance,
    function: null,
    cost_center_type: "org",
    cost_center_key: null,
    amount_cents: 0,
    fiscal_year: 2027,
    excluded_from_mtdc: false,
    note: null,
    ...overrides,
  };
}

export function laborLine(levelKey: string, overrides: Partial<PlanLaborLine> = {}): PlanLaborLine {
  return {
    ...versioned("labor"),
    name: "Labor",
    cost_center_type: "org",
    cost_center_key: null,
    staff_level_key: levelKey,
    hours: 0,
    account_id: A.coachWages,
    function: null,
    note: null,
    ...overrides,
  };
}

export function position(overrides: Partial<PlanSalariedPosition> = {}): PlanSalariedPosition {
  return {
    ...versioned("position"),
    name: "Director",
    annual_salary_cents: 1_200_000,
    paid_hours_per_year: 2000,
    qualifications: null,
    ga_share: null,
    remainder_pool_id: null,
    form_990_line: null,
    ...overrides,
  };
}

export function pool(overrides: Partial<PlanPool> = {}): PlanPool {
  return { ...versioned("pool"), name: "G&A", ...overrides };
}

export function rates(overrides: Partial<PlanRates> = {}): PlanRates {
  return {
    ...versioned("rates"),
    payroll_tax_rate: null,
    lodging_per_night_cents: null,
    mileage_rate_cents: null,
    ...overrides,
  };
}

/** Sums lines matching every given field, and whose line key starts with `line`. */
export function total(out: EngineOutput, match: Partial<CostLine> & { line?: string } = {}): number {
  const { line, ...fields } = match;
  return out.lines
    .filter((l) => Object.entries(fields).every(([k, v]) => l[k as keyof CostLine] === v))
    .filter((l) => line === undefined || l.line_key.startsWith(line))
    .reduce((t, l) => t + l.amount_cents, 0);
}

/** An offering's P&L, or a product's or program area's. */
export function pnlOf(out: EngineOutput, key: string, level: Pnl["level"] = "offering"): Pnl {
  const found = out.pnl.find((p) => p.level === level && p.key === key);
  if (found === undefined) throw new Error(`No P&L for ${level} ${key}`);
  return found;
}
