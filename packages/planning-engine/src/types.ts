// Row types named as docs/planning-schema.md names its collections and fields, so a caller maps
// Directus rows onto them as they are. Optional fields are `null` when empty, as Directus returns them.

/** A `uuid`. */
export type Id = string;
/** A `date`, as `YYYY-MM-DD`. */
export type DateString = string;
/** A `time`, as `HH:MM` or `HH:MM:SS`. */
export type TimeString = string;

/** The columns every version-scoped row carries. */
export interface Versioned {
  id: Id;
  version_id: Id;
  /** Stable across versions; references from other plans use it. */
  key: Id;
}

export type CostCenterType = "offering" | "product" | "pool" | "org";
export type AccountFunction = "program" | "management" | "fundraising";

// `core` catalog

export interface Product {
  id: Id;
  name: string;
  kind: "program" | "charter" | "storage_lease" | "merchandise" | "event_hosting" | "other";
  revenue_account_id: Id | null;
}

export interface Account {
  id: Id;
  number: string;
  name: string;
  type: "revenue" | "expense" | "asset" | "liability" | "net_assets";
  form_990_part: string | null;
  form_990_line: string | null;
  default_function: AccountFunction | null;
  parent_id: Id | null;
  contra_account_id: Id | null;
  retired: boolean;
}

export interface Qualification {
  id: Id;
  name: string;
}

export interface QualificationCover {
  qualification_id: Id;
  covers_id: Id;
}

export interface BoatClass {
  id: Id;
  name: string;
  sailors_per_boat: number | null;
  footprint_sq_ft: number | null;
}

export interface ResourceKind {
  id: Id;
  name: string;
}

// Product plan

export type ActivityKind = "practice" | "regatta" | "clinic" | "camp_week" | "travel";

export interface PlanOffering extends Versioned {
  product_id: Id;
  name: string;
  season_term: string | null;
  starts_on: DateString;
  ends_on: DateString;
  capacity: number | null;
  target_enrollment: number | null;
  fill_rate: number | null;
  price_cents: number | null;
  price_basis: PriceBasis | null;
  units: number | null;
  /** `{"YYYY-MM": share}`, shares summing to 1. */
  registration_curve: Record<string, number> | null;
  sailors_per_coach: number | null;
  min_coaches: number | null;
  /** A `plan_staff_levels` key. */
  coach_level_key: Id | null;
  required_qualification: Id | null;
  ribs_per_coach: number | null;
  byob_share: number | null;
  fixed_coaches: number | null;
  fixed_ribs: number | null;
  fixed_boats: number | null;
  cogs_rate: number | null;
  note: string | null;
}

/** How an offering's price multiplies out; see the README. */
export type PriceBasis = "per_enrollment" | "per_session" | "per_month" | "per_unit";

export interface PlanOfferingBoatClass extends Versioned {
  offering_id: Id;
  boat_class_id: Id;
  share: number;
}

export interface PlanOfferingPrice extends Versioned {
  offering_id: Id;
  tier: string;
  price_cents: number;
  share: number;
}

export interface PlanScheduleRule extends Versioned {
  offering_id: Id;
  /** ISO weekday numbers, 1 = Monday. */
  weekdays: number[];
  start_time: TimeString;
  end_time: TimeString;
  on_water_fraction: number | null;
  setup_minutes: number | null;
  putaway_minutes: number | null;
  starts_on: DateString | null;
  ends_on: DateString | null;
  skip_dates: DateString[] | null;
  kind: Exclude<ActivityKind, "travel">;
  uses_boats: boolean;
  fixed_coaches: number | null;
  fixed_ribs: number | null;
}

export interface PlanTrip extends Versioned {
  offering_id: Id;
  name: string;
  starts_on: DateString;
  ends_on: DateString;
  pre_travel_days: number | null;
  post_travel_days: number | null;
  travel_hours_per_day: number | null;
  load_minutes: number | null;
  unload_minutes: number | null;
  nights: number | null;
  airfare_cents: number | null;
  miles: number | null;
  external_event_ref: string | null;
}

export interface PlanActivity extends Versioned {
  offering_id: Id;
  schedule_rule_id: Id | null;
  trip_id: Id | null;
  date: DateString;
  start_time: TimeString | null;
  end_time: TimeString | null;
  on_water_minutes: number | null;
  setup_minutes: number | null;
  putaway_minutes: number | null;
  kind: ActivityKind;
  fixed_coaches: number | null;
  fixed_ribs: number | null;
  fixed_boats: number | null;
  overridden: boolean;
}

export interface PlanActivityResource extends Versioned {
  activity_id: Id;
  /** A `plan_resources` key. */
  resource_key: Id;
  quantity: number;
  hours: number | null;
}

export interface PlanLaborLine extends Versioned {
  name: string;
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  /** A `plan_staff_levels` key. */
  staff_level_key: Id;
  hours: number | null;
  hours_formula: string | null;
  /** `{"YYYY-MM": share}`. */
  phasing: Record<string, number> | null;
  account_id: Id;
  function: AccountFunction | null;
  note: string | null;
}

export type Spread = "by_mtdc" | "by_revenue" | "even" | "by_months";

export interface PlanBudgetLine extends Versioned {
  name: string;
  account_id: Id;
  function: AccountFunction | null;
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  spread: Spread | null;
  amount_cents: number | null;
  formula: string | null;
  fiscal_year: number;
  phasing_mode: "annual_split" | "monthly_rate" | null;
  /** `{"YYYY-MM": share}` for `annual_split`; `{"YYYY-MM": cents}` for `monthly_rate`. */
  phasing: Record<string, number> | null;
  is_participant_support: boolean;
  is_capital: boolean;
  is_non_cash: boolean;
  excluded_from_base: boolean;
  note: string | null;
}

// Operations plan

export interface PlanAssumption extends Versioned {
  name: string;
  value: number;
  unit: string | null;
  effective_from: DateString | null;
  note: string | null;
}

export interface PlanStaffLevel extends Versioned {
  name: string;
  pay_type: "hourly" | "volunteer";
  hourly_rate_cents: number | null;
  /** `qualifications` ids. */
  qualifications: Id[] | null;
  effective_from: DateString | null;
}

export interface PlanSalariedPosition extends Versioned {
  name: string;
  annual_salary_cents: number;
  paid_hours_per_year: number | null;
  qualifications: Id[] | null;
  ga_share: number | null;
  remainder_pool_id: Id | null;
  form_990_line: string | null;
  effective_from: DateString | null;
  effective_to: DateString | null;
}

export interface PlanSalariedBooking extends Versioned {
  position_id: Id;
  product_id: Id;
  starts_on: DateString | null;
  ends_on: DateString | null;
  kind: "management";
  hours: number;
}

export interface PlanResource extends Versioned {
  resource_kind_id: Id;
  name: string;
  quantity: number | null;
  cost_per_hour_cents: number | null;
  cost_per_day_cents: number | null;
  fuel_per_hour_cents: number | null;
  maintenance_per_hour_cents: number | null;
  effective_from: DateString | null;
}

export interface PlanBoatRate extends Versioned {
  boat_class_id: Id;
  maintenance_per_boat_hour_cents: number;
  effective_from: DateString | null;
}

export interface PlanActivityBlockRule extends Versioned {
  name: string;
  /** `plan_offerings` keys. */
  offering_keys: Id[];
  weekdays: number[] | null;
  starts_on: DateString | null;
  ends_on: DateString | null;
  /** A `plan_staff_levels` id. */
  coach_level_id: Id | null;
  /** `plan_salaried_positions` keys. */
  salaried_positions: Id[] | null;
}

export type PoolMethod = "base_share" | "fixed_shares" | "area" | "formula";

export interface PlanPool extends Versioned {
  name: string;
  step_order: number;
  method: PoolMethod;
  /** A metric name, or `accounts` to sum the accounts in `base_categories`. */
  base: string | null;
  /** Account ids, for `base: "accounts"`. */
  base_categories: Id[] | null;
  targets_filter: TargetsFilter | null;
  denominator_quantity: number | null;
  unit: string | null;
  remainder_pool_id: Id | null;
  phasing: "by_base" | "even" | "target_months" | null;
}

/** Which offerings a pool or formula reaches. Every field given must match; none given matches all. */
export interface TargetsFilter {
  offering_keys?: Id[];
  product_ids?: Id[];
  product_kinds?: Product["kind"][];
  exclude_offering_keys?: Id[];
  exclude_product_ids?: Id[];
}

export interface PlanPoolShare extends Versioned {
  pool_id: Id;
  target_type: "offering" | "product";
  target_key: Id;
  share: number | null;
  quantity: number | null;
  amount_cents: number | null;
  starts_on: DateString | null;
  ends_on: DateString | null;
}

export interface PlanFormula extends Versioned {
  name: string;
  dimension: "none" | "offering" | "product" | "month";
  expression: string;
  account_id: Id | null;
  function: AccountFunction | null;
  cost_center_type: CostCenterType | null;
  applies_to_filter: TargetsFilter | null;
  excluded_from_base: boolean;
  note: string | null;
}

export interface PlanFormulaDep extends Versioned {
  formula_id: Id;
  depends_on: string;
}

export interface PlanBonusOwner extends Versioned {
  role_name: string;
  bonus_rate: number;
  account_id: Id;
  starts_on: DateString | null;
  ends_on: DateString | null;
}

export interface PlanBonusOwnerProduct extends Versioned {
  bonus_owner_id: Id;
  product_id: Id;
}

/**
 * Accounts the schema has no field for. Activity labor, RIBs, boats, resources, salaries and COGS
 * have no account of their own, so the caller names one for each.
 */
export interface PostingAccounts {
  coach_wages: Id;
  salaries: Id;
  ribs: Id;
  boat_maintenance: Id;
  resources: Id;
  travel: Id;
  cogs: Id;
}

/** One version set's rows: the catalog plus every pinned version's plan rows. */
export interface PlanData {
  /** Stamped on every result and metric. */
  version_set_key: string;
  /** The fiscal year to compute. Fiscal year N ends in calendar year N. */
  fiscal_year: number;
  /** The fiscal year's first month, 1–12. */
  fiscal_year_start_month: number;
  posting_accounts: PostingAccounts;
  /** The resource kind whose `plan_resources` price RIB hours. */
  rib_resource_kind_id: Id | null;

  products: Product[];
  accounts: Account[];
  qualifications: Qualification[];
  qualification_covers: QualificationCover[];
  boat_classes: BoatClass[];
  resource_kinds: ResourceKind[];

  plan_offerings: PlanOffering[];
  plan_offering_boat_classes: PlanOfferingBoatClass[];
  plan_offering_prices: PlanOfferingPrice[];
  plan_schedule_rules: PlanScheduleRule[];
  plan_trips: PlanTrip[];
  plan_activities: PlanActivity[];
  plan_activity_resources: PlanActivityResource[];
  plan_labor_lines: PlanLaborLine[];
  plan_budget_lines: PlanBudgetLine[];

  plan_assumptions: PlanAssumption[];
  plan_staff_levels: PlanStaffLevel[];
  plan_salaried_positions: PlanSalariedPosition[];
  plan_salaried_bookings: PlanSalariedBooking[];
  plan_resources: PlanResource[];
  plan_boat_rates: PlanBoatRate[];
  plan_activity_block_rules: PlanActivityBlockRule[];
  plan_pools: PlanPool[];
  plan_pool_shares: PlanPoolShare[];
  plan_formulas: PlanFormula[];
  plan_formula_deps: PlanFormulaDep[];
  plan_bonus_owners: PlanBonusOwner[];
  plan_bonus_owner_products: PlanBonusOwnerProduct[];
}

// Results

export type Basis = "accrual" | "cash";

export interface PlanResult {
  version_set_key: string;
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  account_id: Id;
  function: AccountFunction | null;
  basis: Basis;
  /** The month's first day. */
  month: DateString;
  /** A magnitude: the account's type gives its sign. */
  amount_cents: number;
  line_key: string;
  explanation: string;
}

export type MetricName = "coach_hours" | "paid_hours" | "rib_hours" | "boat_hours" | "enrollment" | "wages" | "mtdc";

export interface PlanMetric {
  version_set_key: string;
  cost_center_key: Id;
  metric: MetricName;
  month: DateString;
  value: number;
}

/** A generated or stored activity, after overrides, with the staffing the engine gave it. */
export interface ComputedActivity {
  offering_id: Id;
  offering_key: Id;
  schedule_rule_id: Id | null;
  trip_id: Id | null;
  /** The stored row's id, when one exists. */
  activity_id: Id | null;
  date: DateString;
  kind: ActivityKind;
  /** Paid minutes: start to end plus setup and put-away. */
  paid_minutes: number;
  on_water_minutes: number;
  uses_boats: boolean;
  coaches: number;
  ribs: number;
  boats: number;
  block_rule_id: Id | null;
}

export interface EngineWarning {
  code: string;
  message: string;
  /** The key of the row it's about, when there is one. */
  key?: string;
}

export interface EngineOutput {
  plan_results: PlanResult[];
  plan_metrics: PlanMetric[];
  activities: ComputedActivity[];
  warnings: EngineWarning[];
}
