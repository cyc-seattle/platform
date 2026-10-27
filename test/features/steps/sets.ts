// The named sets a step's target may be, in place of one collection. They're the tests' own lists,
// not the stack's, so a mistake in a policy isn't copied into the test that should catch it.

/** One collection a step works on, and the keys in `row` of the run's rows it checks there. */
export interface Target {
  collection: string;
  rows: string[];
}

const plain = (collections: string[]): Target[] =>
  collections.map((collection) => ({ collection, rows: [collection] }));

const CRM = [
  "programs",
  "program_roles",
  "people",
  "contacts",
  "contact_points",
  "medical_profiles",
  "program_role_assignments",
  "sync_tasks",
  "sync_runs",
  "audit_findings",
  "google_groups",
  "google_group_memberships",
  "promoted_fields",
];

const CLUBSPOT = [
  "camps",
  "sessions",
  "classes",
  "session_classes",
  "entry_caps",
  "custom_field_definitions",
  "custom_field_responses",
  "participants",
  "registrations",
  "registration_entries",
  "registration_billing",
  "event_staff",
];

const CATALOG = ["products", "accounts", "qualifications", "qualification_covers", "boat_classes", "resource_kinds"];

// docs/planning-schema.md's version-scoped collections, which hold a row in each version.
const VERSIONED = [
  "plan_versions",
  "plan_offerings",
  "plan_offering_prices",
  "plan_offering_boat_classes",
  "plan_schedule_rules",
  "plan_trips",
  "plan_activities",
  "plan_activity_resources",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_assumptions",
  "plan_staff_levels",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
  "plan_pools",
  "plan_pool_shares",
  "plan_resources",
  "plan_boat_rates",
  "plan_activity_block_rules",
  "plan_formulas",
  "plan_formula_deps",
];

const versions = (...names: string[]): Target[] =>
  VERSIONED.map((collection) => ({ collection, rows: names.map((name) => `${collection}@${name}`) }));

const sets: Record<string, Target[]> = {
  "the CRM": plain(CRM),
  "Clubspot's records": plain(CLUBSPOT),
  "the catalog": plain(CATALOG),
  plans: [
    ...plain(["plans", "version_sets", "version_set_members", "plan_activations"]),
    ...versions("draft", "saved"),
  ],
  "the draft": versions("draft"),
  "the saved version": versions("saved"),
  results: plain(["plan_results", "plan_metrics"]),
  groups: plain(["groups", "group_members", "group_policies"]),
};

/** A named set's collections, or the one collection a target names. */
export function targets(target: string): Target[] {
  return sets[target] ?? plain([target]);
}
