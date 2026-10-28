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

// Clubspot's events and registrations, as clubspot.feature defines them, but for who staffs each
// session. Camps are Clubspot's container for a program's sessions.
const SESSIONS_CLASSES_AND_REGISTRATIONS = plain(
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

const PROGRAM_ROLES_STAFFING_AND_GROUPS = plain("program_role_assignments", "event_staff", "google_group_memberships");

const sets: Record<string, Target[]> = {
  // A person's details, as crm.feature defines them. Medical information is granted apart.
  "people and their details": plain("people", "contacts", "contact_points"),
  "medical information": plain("medical_profiles"),
  "the rosters": plain("programs", "camps", "sessions", "classes", "registration_entries", "people"),
  "sailors' parents and emergency contacts": plain("contacts"),
  "extra emails or phone numbers": plain("contact_points"),
  registrations: plain("participants", "registrations", "registration_billing"),
  payments: plain("registration_billing"),
  "Clubspot's events and registrations": [...SESSIONS_CLASSES_AND_REGISTRATIONS, ...plain("event_staff")],
  "sessions, classes, and registrations": SESSIONS_CLASSES_AND_REGISTRATIONS,
  "sessions, classes, or registrations": plain(
    "camps",
    "sessions",
    "classes",
    "participants",
    "registrations",
    "registration_entries",
  ),
  "which classes a session offers": plain("session_classes"),
  "a registration's payments": plain("registration_billing"),
  "people, their details, and their medical information": plain(
    "people",
    "contacts",
    "contact_points",
    "medical_profiles",
  ),
  "people's program roles, the sessions they staff, and which Google groups they're in":
    PROGRAM_ROLES_STAFFING_AND_GROUPS,
  "people's program roles, the sessions they staff, or which Google groups they're in":
    PROGRAM_ROLES_STAFFING_AND_GROUPS,
  "its notes": plain("sync_tasks", "audit_findings"),
  "its run logs": plain("sync_runs"),
  "which sign-up answers get copied": plain("promoted_fields"),
  "what it uses to fill groups": plain(
    "programs",
    "camps",
    "classes",
    "people",
    "contacts",
    "registrations",
    "registration_entries",
    "program_role_assignments",
  ),
  "the Google groups": plain("google_groups", "google_group_memberships"),
  programs: plain("programs"),
  "programs' details": plain("programs"),
  "the catalog": plain(
    "products",
    "accounts",
    "qualifications",
    "qualification_covers",
    "boat_classes",
    "resource_kinds",
    "programs",
  ),
  products: plain("products"),
  "revenue accounts": plain("accounts"),
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
