// Small invented fixtures. Every figure here is made up.
import type {
  Account,
  EngineOutput,
  PlanActivity,
  PlanActivityBlockRule,
  PlanBudgetLine,
  PlanData,
  PlanFormula,
  PlanLaborLine,
  PlanOffering,
  PlanPool,
  PlanPoolShare,
  PlanResult,
  PlanSalariedPosition,
  PlanScheduleRule,
  PlanStaffLevel,
  PlanTrip,
  Product,
} from "../src/index.ts";

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
} as const;

export function emptyPlan(overrides: Partial<PlanData> = {}): PlanData {
  return {
    version_set_key: "vs-test",
    fiscal_year: 2027,
    fiscal_year_start_month: 1,
    posting_accounts: {
      coach_wages: A.coachWages,
      salaries: A.salaries,
      ribs: A.ribs,
      boat_maintenance: A.boats,
      resources: A.resources,
      travel: A.travel,
      cogs: A.cogs,
    },
    rib_resource_kind_id: "kind-rib",
    products: [],
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
      account(A.depreciation, "6200", "expense"),
      account(A.equipment, "1500", "asset"),
    ],
    qualifications: [],
    qualification_covers: [],
    boat_classes: [],
    resource_kinds: [{ id: "kind-rib", name: "RIB" }],
    plan_offerings: [],
    plan_offering_boat_classes: [],
    plan_offering_prices: [],
    plan_schedule_rules: [],
    plan_trips: [],
    plan_activities: [],
    plan_activity_resources: [],
    plan_labor_lines: [],
    plan_budget_lines: [],
    plan_assumptions: [],
    plan_staff_levels: [],
    plan_salaried_positions: [],
    plan_salaried_bookings: [],
    plan_resources: [],
    plan_boat_rates: [],
    plan_activity_block_rules: [],
    plan_pools: [],
    plan_pool_shares: [],
    plan_formulas: [],
    plan_formula_deps: [],
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
    price_basis: null,
    units: null,
    registration_curve: null,
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

export function rule(offeringId: string, overrides: Partial<PlanScheduleRule> = {}): PlanScheduleRule {
  return {
    ...versioned("rule"),
    offering_id: offeringId,
    weekdays: [2],
    start_time: "16:00",
    end_time: "18:00",
    on_water_fraction: null,
    setup_minutes: null,
    putaway_minutes: null,
    starts_on: null,
    ends_on: null,
    skip_dates: null,
    kind: "practice",
    uses_boats: true,
    fixed_coaches: null,
    fixed_ribs: null,
    ...overrides,
  };
}

export function trip(offeringId: string, overrides: Partial<PlanTrip> = {}): PlanTrip {
  return {
    ...versioned("trip"),
    offering_id: offeringId,
    name: "A regatta",
    starts_on: "2027-06-12",
    ends_on: "2027-06-13",
    pre_travel_days: null,
    post_travel_days: null,
    travel_hours_per_day: null,
    load_minutes: null,
    unload_minutes: null,
    nights: null,
    airfare_cents: null,
    miles: null,
    external_event_ref: null,
    ...overrides,
  };
}

export function activity(offeringId: string, overrides: Partial<PlanActivity> = {}): PlanActivity {
  return {
    ...versioned("activity"),
    offering_id: offeringId,
    schedule_rule_id: null,
    trip_id: null,
    date: "2027-06-05",
    start_time: "09:00",
    end_time: "12:00",
    on_water_minutes: null,
    setup_minutes: null,
    putaway_minutes: null,
    kind: "clinic",
    fixed_coaches: null,
    fixed_ribs: null,
    fixed_boats: null,
    overridden: false,
    ...overrides,
  };
}

export function staffLevel(overrides: Partial<PlanStaffLevel> = {}): PlanStaffLevel {
  return {
    ...versioned("level"),
    name: "Coach",
    pay_type: "hourly",
    hourly_rate_cents: 2000,
    qualifications: null,
    effective_from: null,
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
    spread: null,
    amount_cents: 0,
    formula: null,
    fiscal_year: 2027,
    phasing_mode: null,
    phasing: null,
    is_participant_support: false,
    is_capital: false,
    is_non_cash: false,
    excluded_from_base: false,
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
    hours_formula: null,
    phasing: null,
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
    effective_from: null,
    effective_to: null,
    ...overrides,
  };
}

export function pool(overrides: Partial<PlanPool> = {}): PlanPool {
  return {
    ...versioned("pool"),
    name: "G&A",
    step_order: 1,
    method: "base_share",
    base: "mtdc",
    base_categories: null,
    targets_filter: null,
    denominator_quantity: null,
    unit: null,
    remainder_pool_id: null,
    phasing: null,
    ...overrides,
  };
}

export function poolShare(poolId: string, targetKey: string, overrides: Partial<PlanPoolShare> = {}): PlanPoolShare {
  return {
    ...versioned("share"),
    pool_id: poolId,
    target_type: "offering",
    target_key: targetKey,
    share: null,
    quantity: null,
    amount_cents: null,
    starts_on: null,
    ends_on: null,
    ...overrides,
  };
}

export function formula(overrides: Partial<PlanFormula> = {}): PlanFormula {
  return {
    ...versioned("formula"),
    name: "f",
    dimension: "none",
    expression: "0",
    account_id: null,
    function: null,
    cost_center_type: null,
    applies_to_filter: null,
    excluded_from_base: false,
    note: null,
    ...overrides,
  };
}

/** Sums result rows matching every given field. Accrual unless `basis` says otherwise. */
export function total(out: EngineOutput, match: Partial<PlanResult> & { line?: string } = {}): number {
  const { line, ...fields } = match;
  const want = { basis: "accrual", ...fields } as Partial<PlanResult>;
  return out.plan_results
    .filter((r) => Object.entries(want).every(([k, v]) => r[k as keyof PlanResult] === v))
    .filter((r) => line === undefined || r.line_key.startsWith(line))
    .reduce((t, r) => t + r.amount_cents, 0);
}

export function metricTotal(out: EngineOutput, key: string, metric: string, month?: string): number {
  return out.plan_metrics
    .filter((m) => m.cost_center_key === key && m.metric === metric && (month === undefined || m.month === month))
    .reduce((t, m) => t + m.value, 0);
}
