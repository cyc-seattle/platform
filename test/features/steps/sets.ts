// The records a step names, in the features' own words, and the collections each covers. They're
// the tests' own lists, not the stack's, so a mistake in a policy isn't copied into the test that
// should catch it.

/** One collection a step works on, and the keys in `row` of the run's rows it checks there. */
export interface Target {
  collection: string;
  rows: string[];
}

const plain = (...collections: string[]): Target[] =>
  collections.map((collection) => ({ collection, rows: [collection] }));

// docs/planning-schema.md's version-scoped collections, which hold a row in each version.
const VERSIONED = [
  "plan_versions",
  "plan_offerings",
  "plan_offering_prices",
  "plan_offering_boat_classes",
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
];

const versions = (...names: string[]): Target[] =>
  VERSIONED.map((collection) => ({ collection, rows: names.map((name) => `${collection}@${name}`) }));

const CAMPS_AND_REGISTRATIONS = plain(
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
);

const sets: Record<string, Target[]> = {
  // The CRM's own records. Programs are the catalog's, and medical profiles are granted apart.
  "the CRM": plain(
    "people",
    "contacts",
    "contact_points",
    "program_roles",
    "program_role_assignments",
    "promoted_fields",
    "sync_tasks",
    "sync_runs",
    "audit_findings",
    "google_groups",
    "google_group_memberships",
  ),
  "medical profiles": plain("medical_profiles"),
  "Clubspot's records": [...CAMPS_AND_REGISTRATIONS, ...plain("event_staff")],
  "Clubspot's camps and registrations": CAMPS_AND_REGISTRATIONS,
  "camps, sessions, classes, and registrations": plain(
    "camps",
    "sessions",
    "classes",
    "participants",
    "registrations",
    "registration_entries",
  ),
  "the rosters": plain("programs", "camps", "sessions", "classes", "registration_entries", "people"),
  "family links and address books": plain("contacts", "contact_points"),
  "registrations and their billing": plain("participants", "registrations", "registration_billing"),
  billing: plain("registration_billing"),
  "people, their family links, address books, and medical profiles": plain(
    "people",
    "contacts",
    "contact_points",
    "medical_profiles",
  ),
  people: plain("people"),
  "a session's classes": plain("session_classes"),
  "the syncs' runs and findings": plain("sync_runs", "audit_findings"),
  "the syncs' queue, runs, and findings": plain("sync_tasks", "sync_runs", "audit_findings"),
  "role assignments, event staffing, and group memberships": plain(
    "program_role_assignments",
    "event_staff",
    "google_group_memberships",
  ),
  "the promoted fields": plain("promoted_fields"),
  "the programs, rosters, and roles it maps into groups": plain(
    "programs",
    "camps",
    "classes",
    "people",
    "contacts",
    "registrations",
    "registration_entries",
    "program_role_assignments",
  ),
  "its queue, findings, and Google groups": plain(
    "sync_tasks",
    "audit_findings",
    "google_groups",
    "google_group_memberships",
  ),
  programs: plain("programs"),
  "the catalog": plain(
    "products",
    "accounts",
    "qualifications",
    "qualification_covers",
    "boat_classes",
    "resource_kinds",
    "programs",
  ),
  "products and accounts": plain("products", "accounts"),
  plans: [...plain("plans", "version_sets", "version_set_members", "plan_activations"), ...versions("draft", "saved")],
  "a draft": versions("draft"),
  "a saved version": versions("saved"),
  groups: plain("groups", "group_members", "group_policies"),
};

/** The names a step's `{records}` may take. */
export const recordNames = Object.keys(sets);

export function targets(records: string): Target[] {
  const found = sets[records];
  if (!found) {
    throw new Error(`No records named "${records}".`);
  }
  return found;
}
