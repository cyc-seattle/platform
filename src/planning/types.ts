// Row types named as docs/planning-schema.md names its collections and fields, so a caller maps
// Directus rows onto them as they are. Optional fields are `null` when empty, as Directus returns them.

/** A `uuid`. */
export type Id = string;
/** A `date`, as `YYYY-MM-DD`. */
export type DateString = string;
/** A `time`, as `HH:MM` or `HH:MM:SS`. */
export type TimeString = string;

/** The columns every row of a plan carries. */
export interface PlanRow {
  id: Id;
  plan_id: Id;
  /** Stays the same when a Financial Plan is copied; references from other plans use it. */
  key: Id;
}

export type CostCenterType = "offering" | "product" | "program_area" | "pool" | "org";
export type AccountFunction = "program" | "management" | "fundraising";

// `core` catalog

export type ProductKind = "program" | "charter" | "storage_lease" | "merchandise" | "event_hosting" | "other";

export interface Product {
  id: Id;
  name: string;
  kind: ProductKind;
  /** For a product in no program area. A product in one uses the area's. */
  revenue_account_id: Id | null;
  /** Every program has one; merchandise, storage and charters have none. */
  program_area_id: Id | null;
}

/** A part of the organization's programs, such as Summer, with its revenue account. */
export interface ProgramArea {
  id: Id;
  name: string;
  revenue_account_id: Id;
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
  /** The most sailors one boat can safely take. */
  max_capacity: number | null;
  footprint_sq_ft: number | null;
  /** Where its own boats' fuel and upkeep are booked; empty for the boat maintenance cost type's. */
  account_id?: Id | null;
}

/** Something the organization owns: a sailboat, a powerboat, a motor, or other equipment. */
export interface Asset {
  id: Id;
  kind: "sailboat" | "powerboat" | "motor" | "other";
  name: string | null;
  /** The day the organization got it, or expects to; empty counts it from the start. */
  acquired_on: DateString | null;
  /** The day it stopped being the organization's; empty while it still is. */
  disposed_on: DateString | null;
}

/** A sailboat or powerboat asset's class. */
export interface Boat {
  id: Id;
  asset_id: Id;
  boat_class_id: Id;
}

export interface Organization {
  id: Id;
  name: string;
  /** The fiscal year's first month, 1–12. */
  fiscal_year_start_month: number;
}

/** A cost the engine calculates. The organization sets which account each is recorded in. */
export type CostType =
  "coach_wages" | "salaries" | "payroll_tax" | "ribs" | "boat_maintenance" | "resources" | "travel" | "cogs";

export interface OrganizationCostAccount {
  id: Id;
  organization_id: Id;
  cost_type: CostType;
  account_id: Id;
}

// Plans

/** A plan: a program area's for one year, or the organization's Operations Plan. */
export interface Plan {
  id: Id;
  kind: "program_area" | "operations";
  program_area_id: Id | null;
}

// Program area plan

export type ActivityKind = "practice" | "regatta" | "clinic" | "travel";

export interface PlanOffering extends PlanRow {
  product_id: Id;
  name: string;
  /** A `plan_terms` key in the Operations Plan, or none. */
  term_key: Id | null;
  starts_on: DateString;
  ends_on: DateString;
  capacity: number | null;
  target_enrollment: number | null;
  /** Per kid. */
  price_cents: number | null;
  cogs_rate: number | null;
  note: string | null;
}

/** A program's settings in a Program Plan: who coaches it, and how many sailors each coach takes. */
export interface PlanProgram extends PlanRow {
  /** The program's product. */
  product_id: Id;
  /** A `plan_staff_levels` key. */
  staff_level_key: Id | null;
  sailors_per_coach: number | null;
  /** The share of its offerings' MTDC they pay toward the shared costs, fixed for the year. */
  indirect_cost_rate?: number | null;
  /** The planner's short notes, which only their AI reads. */
  notes: string[] | null;
}

export interface PlanTrip extends PlanRow {
  offering_id: Id;
  name: string;
  nights: number | null;
  /** Per coach. */
  airfare_cents: number | null;
  miles: number | null;
}

/** One dated activity, or a travel day, as the planner or a scheduling tool entered it. */
export interface PlanActivity extends PlanRow {
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
  /** The block it's staffed in, if any. */
  block_id: Id | null;
}

/** Activities on one date that share their staff and boats. */
export interface PlanActivityBlock extends PlanRow {
  date: DateString;
  name: string;
}

/** Staff on a block: a number at one staff level, or a salaried position. */
export interface PlanBlockStaff extends PlanRow {
  block_id: Id;
  /** A `plan_staff_levels` key, for hourly or volunteer staff. */
  staff_level_key: Id | null;
  /** A `plan_salaried_positions` key. */
  position_key: Id | null;
  count: number;
  /** How a salaried position is paid for the block: out of its salary (the default), or by the hour at its own rate. */
  pay: "salary" | "hourly" | null;
}

/** Boats of one class on a block: the organization's, the ones it charters, and the ones sailors bring. */
export interface PlanBlockBoats extends PlanRow {
  block_id: Id;
  boat_class_id: Id;
  count: number;
  sailor_owned: number | null;
  chartered?: number | null;
}

export interface PlanLaborLine extends PlanRow {
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

export interface PlanBudgetLine extends PlanRow {
  name: string;
  account_id: Id;
  function: AccountFunction | null;
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  amount_cents: number;
  fiscal_year: number;
  /** Whether it counts toward MTDC; cleared for a cost 2 CFR 200.1 leaves out, such as equipment or participant support. */
  in_mtdc: boolean;
  note: string | null;
}

/**
 * Something lasting the Operations Plan means to buy, ranked by `sort` with the most needed first.
 * Its account is an asset account.
 */
export interface PlanCapitalItem extends PlanRow {
  name: string;
  amount_cents: number;
  account_id: Id;
  sort: number | null;
  note?: string | null;
  link?: string | null;
}

// Operations plan

/** The year's rates. An Operations Plan has at most one row. */
export interface PlanRates extends PlanRow {
  /** Employer payroll costs, as a share of wages. */
  payroll_tax_rate: number | null;
  lodging_per_night_cents: number | null;
  mileage_rate_cents: number | null;
}

export interface PlanStaffLevel extends PlanRow {
  name: string;
  pay_type: "hourly" | "volunteer";
  hourly_rate_cents: number | null;
}

export interface PlanSalariedPosition extends PlanRow {
  name: string;
  annual_salary_cents: number;
  paid_hours_per_year: number | null;
  ga_share: number | null;
  /** The pool that takes the salary its hours don't charge to programs. */
  remainder_pool_id: Id | null;
  /** What it's paid an hour to coach an offering that pays it by the hour, instead of the offering's level. */
  hourly_coaching_rate_cents?: number | null;
}

/** Hours charged to a product, or to a program area and shared among its offerings: one of the two. */
export interface PlanSalariedBooking extends PlanRow {
  position_id: Id;
  product_id: Id | null;
  program_area_id: Id | null;
  hours: number;
}

/** A boat class's rates for the year. */
export interface PlanBoatRate extends PlanRow {
  boat_class_id: Id;
  /** Upkeep for each hour one of the organization's boats of the class is on the water. */
  maintenance_per_boat_hour_cents: number;
  /** Fuel for each hour one is on the water. */
  fuel_per_hour_cents?: number | null;
  /** What one costs to charter for a day. */
  charter_per_day_cents?: number | null;
}

/** A group of shared costs, such as G&A, divided among all of the plan's offerings by MTDC. */
export interface PlanPool extends PlanRow {
  name: string;
}

export interface PlanBonusOwner extends PlanRow {
  role_name: string;
  bonus_rate: number;
  account_id: Id;
  /** Whether the net is counted after the pools are shared out (the default), or before. */
  basis?: "after_shared_costs" | "before_shared_costs" | null;
  /** A `plan_salaried_positions` key: the position the bonus pays. */
  position_key?: Id | null;
}

export interface PlanBonusOwnerProduct extends PlanRow {
  bonus_owner_id: Id;
  product_id: Id;
}

/** A charge set as a share of each offering's revenue, such as scholarships or card fees. */
export interface PlanRevenueCharge extends PlanRow {
  name: string;
  /** A share, such as 0.02 for 2%. */
  rate: number;
  /** The kinds of product it applies to. */
  product_kinds: ProductKind[] | null;
  /** A revenue account adds revenue; an expense account adds a cost. */
  account_id: Id;
  /** Whether it counts toward MTDC; cleared for one 2 CFR 200.1 leaves out, such as scholarships. */
  in_mtdc: boolean;
  note: string | null;
}

/** A day the organization is closed, such as Labor Day. */
export interface PlanClosedDate extends PlanRow {
  date: DateString;
  name: string;
}

/** A planning period in the Operations Plan, such as Summer 2027, which an offering can be in. */
export interface PlanTerm extends PlanRow {
  name: string;
  starts_on: DateString;
  ends_on: DateString;
}

/** The catalog plus every row of the plans being calculated. */
export interface PlanData {
  /** The plan year. Fiscal year N ends in calendar year N. */
  fiscal_year: number;
  organization: Organization;
  organization_cost_accounts: OrganizationCostAccount[];

  products: Product[];
  program_areas: ProgramArea[];
  accounts: Account[];
  qualifications: Qualification[];
  qualification_covers: QualificationCover[];
  boat_classes: BoatClass[];
  /** The asset list, with its boats, which the engine counts by class on each day. */
  assets: Asset[];
  boats: Boat[];

  /** The plans being calculated, so the engine can tell which plan each row is in. */
  plans: Plan[];

  plan_programs: PlanProgram[];
  plan_offerings: PlanOffering[];
  plan_trips: PlanTrip[];
  plan_activities: PlanActivity[];
  plan_activity_blocks: PlanActivityBlock[];
  plan_block_staff: PlanBlockStaff[];
  plan_block_boats: PlanBlockBoats[];
  plan_labor_lines: PlanLaborLine[];
  plan_budget_lines: PlanBudgetLine[];

  plan_rates: PlanRates[];
  plan_revenue_charges: PlanRevenueCharge[];
  plan_staff_levels: PlanStaffLevel[];
  plan_salaried_positions: PlanSalariedPosition[];
  plan_salaried_bookings: PlanSalariedBooking[];
  plan_boat_rates: PlanBoatRate[];
  plan_pools: PlanPool[];
  plan_bonus_owners: PlanBonusOwner[];
  plan_bonus_owner_products: PlanBonusOwnerProduct[];
  plan_closed_dates?: PlanClosedDate[];
  plan_capital_items?: PlanCapitalItem[];
  plan_terms?: PlanTerm[];
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
  /** What the line is, in plain words, such as "G&A share: Payroll tax". */
  line_name: string;
  explanation: string;
}

/** Revenue, expenses and net, in cents. */
export interface Totals {
  revenue_cents: number;
  expense_cents: number;
  net_cents: number;
}

/** One offering's P&L for the plan year, or a product's or program area's, which adds up its offerings. */
export interface Pnl extends Totals {
  /** `program_area_term` is a program area's offerings in one term, or in none. */
  level: "offering" | "product" | "program_area" | "program_area_term";
  /** An offering key, a product id, or a program area id. */
  key: Id;
  /** A `program_area_term`'s `plan_terms` key, null for its offerings in no term. Only that level has one. */
  term_key?: Id | null;
  /** Each account's total, revenue and expense alike. */
  by_account: { account_id: Id; amount_cents: number }[];
  mtdc_cents: number;
  enrollment: number;
  /** The dates it has an activity other than travel. */
  days: number;
  /** Enrollment × days. */
  sailor_days: number;
  /** The most sailors an offering takes: its `capacity`, or else its enrollment. Null for a product or area. */
  max_enrollment: number | null;
  /**
   * The most sailors an offering's blocks can take, with every other offering in them full. Null when
   * it's in no block that limits it, and for a product or area.
   */
  allocation_holds: number | null;
  /**
   * The fewest sailors, from 1 up to its capacity, at which an offering's net after shared costs is
   * zero or more, with its share of shared costs as planned. Null when it isn't, even when full, when
   * it has no capacity, and for a product or area.
   */
  breakeven_enrollment: number | null;
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
  /** Its share of its block's staff and boats, the organization's and chartered, by its sailors. */
  coaches: number;
  boats: number;
  block_id: Id | null;
}

/** `allocation` when the blocks break a limit or a closed day; `data` when a row is missing or wrong. */
export type WarningCategory = "allocation" | "data";

export interface EngineWarning {
  code: string;
  message: string;
  category: WarningCategory;
  /** The key of the row it's about, when there is one. */
  key?: string;
  /** The plan it's about, when there is one. */
  plan_id?: Id;
  /** The date it's about, when there is one. */
  date?: DateString;
}

/**
 * The organization's year: operating revenue pays for operating costs, and fundraising for capital.
 * Capital is buying something lasting, on an asset account, and never reaches a program area.
 */
export interface OrganizationTotals {
  operating: Totals;
  fundraising: Totals;
  /** Spent on capital, positive. */
  capital_cents: number;
  /** Operating net, plus fundraising net, less capital. */
  total_cents: number;
  indirect: IndirectTotals;
}

/** The year's shared costs, and what the programs' indirect cost rates allocate of them. */
export interface IndirectTotals {
  /** Everything in every pool. */
  shared_cents: number;
  /** Allocated: what the rates charge the programs' offerings. */
  recovered_cents: number;
  /** Unallocated: what's left on the organization, shared less allocated. Below zero when over-allocated. */
  unrecovered_cents: number;
  /** The one rate that would allocate every shared cost: shared ÷ the programs' MTDC. Null with no MTDC. */
  full_recovery_rate: number | null;
}

/**
 * One planned purchase in the ranked capital list: what's left of the year's money after operations
 * and fundraising pays for each in rank order, as far as it goes.
 */
export interface CapitalRank {
  rank: number;
  /** The `plan_capital_items` key, or for capital entered as a budget line, that line's key. */
  key: Id;
  name: string;
  account_id: Id;
  amount_cents: number;
  /** This item's amount plus every item ranked above it. */
  running_cents: number;
  /** Whether the operating net plus the fundraising net covers `running_cents`. */
  funded: boolean;
}

/** One salaried position's year: what it's paid, and where its hours went. */
export interface PositionSummary {
  position_key: Id;
  name: string;
  salary_cents: number;
  /** Hours it coached out of its salary, and what they charged to the offerings. */
  salaried_coaching_hours: number;
  salaried_coaching_cents: number;
  /** Hours it coached for an hourly wage, on top of its salary, and the wages. */
  hourly_coaching_hours: number;
  hourly_coaching_cents: number;
  /** Its `plan_salaried_bookings` hours, and what they charged. */
  booking_hours: number;
  booking_cents: number;
  /** Every bonus that names it. */
  bonus_cents: number;
  /** Salary, hourly wages and bonus. */
  total_pay_cents: number;
  /** The year's payroll tax on its total pay. */
  payroll_tax_cents: number;
  /** Hours another coach would need while it's on two or more groups at once: n − 1 for n groups. */
  double_booked_hours: number;
  /** Dates it's on two or more groups at once. */
  double_booked_dates: number;
}

/** A bonus owner's bonus for one term, or on its offerings in no term for the year. */
export interface BonusSummary {
  bonus_owner_key: Id;
  role_name: string;
  position_key: Id | null;
  /** The program area of all the owner's products, or null when they're in more than one. */
  program_area_id: Id | null;
  /** A `plan_terms` key, or null for its offerings in no term. */
  term_key: Id | null;
  bonus_rate: number;
  /** The net the bonus is figured on, which can be below zero. */
  net_cents: number;
  bonus_cents: number;
}

export interface EngineOutput {
  lines: CostLine[];
  /** Each offering's P&L, then each product's, then each program area's, then each area's terms. */
  pnl: Pnl[];
  /** Each bonus owner's bonus in each term it has offerings in, then in no term. */
  bonuses: BonusSummary[];
  organization: OrganizationTotals;
  activities: ComputedActivity[];
  /** Each salaried position's pay for the year. */
  positions: PositionSummary[];
  /** The planned capital purchases, most needed first. */
  capital: CapitalRank[];
  warnings: EngineWarning[];
}
