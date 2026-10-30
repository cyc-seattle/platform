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

export interface Organization {
  id: Id;
  name: string;
  /** The fiscal year's first month, 1–12. */
  fiscal_year_start_month: number;
}

/** A cost the engine calculates. The organization sets which account each is recorded in. */
export type CostType =
  | "coach_wages"
  | "salaries"
  | "payroll_tax"
  | "ribs"
  | "boat_maintenance"
  | "resources"
  | "travel"
  | "cogs"
  | "card_fees";

export interface OrganizationCostAccount {
  id: Id;
  organization_id: Id;
  cost_type: CostType;
  account_id: Id;
}

// Program plan

export type ActivityKind = "practice" | "regatta" | "clinic" | "travel";

export interface PlanOffering extends Versioned {
  product_id: Id;
  name: string;
  season_term: string | null;
  starts_on: DateString;
  ends_on: DateString;
  capacity: number | null;
  target_enrollment: number | null;
  fill_rate: number | null;
  /** Per kid. */
  price_cents: number | null;
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

export interface PlanOfferingBoatClass extends Versioned {
  offering_id: Id;
  boat_class_id: Id;
  share: number;
}

export interface PlanTrip extends Versioned {
  offering_id: Id;
  name: string;
  nights: number | null;
  /** Per coach. */
  airfare_cents: number | null;
  miles: number | null;
}

/** One dated activity, or a travel day, as the planner or a scheduling tool entered it. */
export interface PlanActivity extends Versioned {
  offering_id: Id;
  /** The trip a travel day belongs to. */
  trip_id: Id | null;
  date: DateString;
  start_time: TimeString | null;
  end_time: TimeString | null;
  on_water_minutes: number | null;
  setup_minutes: number | null;
  putaway_minutes: number | null;
  kind: ActivityKind;
  uses_boats: boolean;
  fixed_coaches: number | null;
  fixed_ribs: number | null;
  fixed_boats: number | null;
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
  hours: number;
  account_id: Id;
  function: AccountFunction | null;
  note: string | null;
}

export interface PlanBudgetLine extends Versioned {
  name: string;
  account_id: Id;
  function: AccountFunction | null;
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  amount_cents: number;
  fiscal_year: number;
  /** Set for a cost 2 CFR 200.1 leaves out of MTDC, such as equipment or participant support. */
  excluded_from_mtdc: boolean;
  note: string | null;
}

// Operations plan

/** The year's rates. An Operations plan version has at most one row. */
export interface PlanRates extends Versioned {
  /** Employer payroll costs, as a share of wages. */
  payroll_tax_rate: number | null;
  /** Card processing fees, as a share of revenue. */
  card_fee_rate: number | null;
  lodging_per_night_cents: number | null;
  mileage_rate_cents: number | null;
}

export interface PlanStaffLevel extends Versioned {
  name: string;
  pay_type: "hourly" | "volunteer";
  hourly_rate_cents: number | null;
  /** `qualifications` ids. */
  qualifications: Id[] | null;
}

export interface PlanSalariedPosition extends Versioned {
  name: string;
  annual_salary_cents: number;
  paid_hours_per_year: number | null;
  qualifications: Id[] | null;
  ga_share: number | null;
  /** The pool that takes the salary its hours don't charge to programs. */
  remainder_pool_id: Id | null;
  form_990_line: string | null;
}

export interface PlanSalariedBooking extends Versioned {
  position_id: Id;
  product_id: Id;
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
  /** Set for a rental, whose cost leaves MTDC. */
  excluded_from_mtdc: boolean;
}

export interface PlanBoatRate extends Versioned {
  boat_class_id: Id;
  maintenance_per_boat_hour_cents: number;
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

/** A group of shared costs, such as G&A, divided among all of the plan year's offerings by MTDC. */
export interface PlanPool extends Versioned {
  name: string;
}

export interface PlanBonusOwner extends Versioned {
  role_name: string;
  bonus_rate: number;
  account_id: Id;
}

export interface PlanBonusOwnerProduct extends Versioned {
  bonus_owner_id: Id;
  product_id: Id;
}

/** The catalog plus every row of the plan versions being calculated. */
export interface PlanData {
  /** The plan year. Fiscal year N ends in calendar year N. */
  fiscal_year: number;
  organization: Organization;
  organization_cost_accounts: OrganizationCostAccount[];
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
  plan_trips: PlanTrip[];
  plan_activities: PlanActivity[];
  plan_activity_resources: PlanActivityResource[];
  plan_labor_lines: PlanLaborLine[];
  plan_budget_lines: PlanBudgetLine[];

  plan_rates: PlanRates[];
  plan_staff_levels: PlanStaffLevel[];
  plan_salaried_positions: PlanSalariedPosition[];
  plan_salaried_bookings: PlanSalariedBooking[];
  plan_resources: PlanResource[];
  plan_boat_rates: PlanBoatRate[];
  plan_activity_block_rules: PlanActivityBlockRule[];
  plan_pools: PlanPool[];
  plan_bonus_owners: PlanBonusOwner[];
  plan_bonus_owner_products: PlanBonusOwnerProduct[];
}

// Output

/** One line of cost or revenue for the plan year, on one offering, product, pool or the organization. */
export interface CostLine {
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  account_id: Id;
  function: AccountFunction | null;
  /** Always positive: the account's type says whether it's revenue or expense. */
  amount_cents: number;
  line_key: string;
  explanation: string;
}

/** Revenue, expenses and net, in cents. */
export interface Totals {
  revenue_cents: number;
  expense_cents: number;
  net_cents: number;
}

/** One offering's P&L for the plan year, or a product's, which adds up its offerings. */
export interface Pnl extends Totals {
  level: "offering" | "product";
  /** An offering key, or a product id. */
  key: Id;
  /** Each account's total, revenue and expense alike. */
  by_account: { account_id: Id; amount_cents: number }[];
  mtdc_cents: number;
  enrollment: number;
  /** The dates it has an activity other than travel. */
  days: number;
  /** Enrollment × days. */
  sailor_days: number;
}

/** An activity with the staffing the engine gave it. */
export interface ComputedActivity {
  offering_id: Id;
  offering_key: Id;
  trip_id: Id | null;
  activity_id: Id;
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
  lines: CostLine[];
  /** Each offering's P&L, then each product's. */
  pnl: Pnl[];
  activities: ComputedActivity[];
  warnings: EngineWarning[];
}
