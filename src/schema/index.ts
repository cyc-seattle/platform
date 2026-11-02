// Generated from schemas/*.yaml by `mise run schema-types`. Don't edit it by hand.

/** Every collection, for `createDirectus<Schema>()`. */
export interface Schema {
  accounts: Accounts[];
  audit_findings: AuditFindings[];
  boat_classes: BoatClasses[];
  clubspot_camps: ClubspotCamps[];
  clubspot_classes: ClubspotClasses[];
  clubspot_custom_field_definitions: ClubspotCustomFieldDefinitions[];
  clubspot_custom_field_responses: ClubspotCustomFieldResponses[];
  clubspot_entry_caps: ClubspotEntryCaps[];
  clubspot_participants: ClubspotParticipants[];
  clubspot_promoted_fields: ClubspotPromotedFields[];
  clubspot_registration_billing: ClubspotRegistrationBilling[];
  clubspot_registration_entries: ClubspotRegistrationEntries[];
  clubspot_registrations: ClubspotRegistrations[];
  clubspot_session_classes: ClubspotSessionClasses[];
  clubspot_sessions: ClubspotSessions[];
  contact_points: ContactPoints[];
  contacts: Contacts[];
  google_group_memberships: GoogleGroupMemberships[];
  google_groups: GoogleGroups[];
  group_members: GroupMembers[];
  group_policies: GroupPolicies[];
  groups: Groups[];
  medical_profiles: MedicalProfiles[];
  offerings: Offerings[];
  organization_cost_accounts: OrganizationCostAccounts[];
  organizations: Organizations[];
  people: People[];
  plan_activations: PlanActivations[];
  plan_activities: PlanActivities[];
  plan_activity_block_rules: PlanActivityBlockRules[];
  plan_activity_resources: PlanActivityResources[];
  plan_boat_rates: PlanBoatRates[];
  plan_bonus_owner_products: PlanBonusOwnerProducts[];
  plan_bonus_owners: PlanBonusOwners[];
  plan_budget_lines: PlanBudgetLines[];
  plan_closed_dates: PlanClosedDates[];
  plan_labor_lines: PlanLaborLines[];
  plan_offering_boat_classes: PlanOfferingBoatClasses[];
  plan_offerings: PlanOfferings[];
  plan_pools: PlanPools[];
  plan_rates: PlanRates[];
  plan_resources: PlanResources[];
  plan_result_lines: PlanResultLines[];
  plan_result_pnl: PlanResultPnl[];
  plan_result_positions: PlanResultPositions[];
  plan_result_versions: PlanResultVersions[];
  plan_result_warnings: PlanResultWarnings[];
  plan_results: PlanResults[];
  plan_revenue_charges: PlanRevenueCharges[];
  plan_salaried_bookings: PlanSalariedBookings[];
  plan_salaried_positions: PlanSalariedPositions[];
  plan_staff_levels: PlanStaffLevels[];
  plan_trips: PlanTrips[];
  plan_versions: PlanVersions[];
  plans: Plans[];
  products: Products[];
  program_area_role_assignments: ProgramAreaRoleAssignments[];
  program_areas: ProgramAreas[];
  program_role_assignments: ProgramRoleAssignments[];
  program_roles: ProgramRoles[];
  programs: Programs[];
  qualification_covers: QualificationCovers[];
  qualifications: Qualifications[];
  registrations: Registrations[];
  resource_kinds: ResourceKinds[];
  sync_runs: SyncRuns[];
  sync_tasks: SyncTasks[];
}

/** The chart of accounts that plans, results, and actuals book to. */
export interface Accounts {
  id: string;
  /** The chart-of-accounts code. */
  number: string;
  name: string;
  type: "revenue" | "expense" | "asset" | "liability" | "net_assets";
  form_990_part: string | null;
  form_990_line: string | null;
  /** The functional-expense column a line booked here takes unless it sets its own. */
  default_function: "program" | "management" | "fundraising" | null;
  parent_id: string | Accounts | null;
  /** The account this one offsets. */
  contra_account_id: string | Accounts | null;
  /** Kept for history, and closed to new lines. */
  retired: boolean;
}

/** Something a sync noticed but didn't fix. A dismissed finding stays dismissed on later runs. */
export interface AuditFindings {
  id: string;
  /** Which sync found it. */
  source: string;
  /** What kind of problem, such as an unexpected group member. Each sync names its own. */
  kind: string;
  /** What the finding is about, such as a group's address or a person. */
  subject: string;
  detail: string;
  status: "open" | "approved" | "resolved" | "dismissed";
  /** Identifies the finding, so a dismissal survives the next run. */
  fingerprint: string;
}

/** A kind of boat offerings sail, such as Opti or 420. */
export interface BoatClasses {
  id: string;
  name: string;
  sailors_per_boat: number;
  /** Dry-storage area one boat takes. */
  footprint_sq_ft: string | null;
}

/** A dated event, such as a season's race team. Copied from Clubspot, so edit it there. */
export interface ClubspotCamps {
  /** Clubspot's own ID for this row. */
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  archived: boolean;
  /** When this camp last synced from Clubspot. Empty means never. */
  synced_through: string | null;
  /** How many syncs in a row found nothing new. The more there are, the less often the sync checks this camp, down to once a week. */
  quiet_runs: number;
  /** The account code this camp sells against in Clubspot. Empty means the camp has no accounting set up. */
  clubspot_sales_account: string | null;
}

/** An age or skill group within a camp. Copied from Clubspot, so edit it there. Only its program is set here. */
export interface ClubspotClasses {
  /** Clubspot's own ID for this row. */
  id: string;
  camp_id: string | ClubspotCamps;
  name: string;
  /** Set by hand, once for each class. The sync never changes it. */
  program_id: string | Programs | null;
  /** The registrations signed up for this class. */
  registration_entries: (string | ClubspotRegistrationEntries)[];
}

/** A question a camp's registration form asks, such as School. Each camp has its own copy, so the same question can be worded differently from camp to camp. Copied from Clubspot. */
export interface ClubspotCustomFieldDefinitions {
  /** Clubspot's own ID for this row. */
  id: string;
  camp_id: string | ClubspotCamps;
  /** The question as Clubspot words it. It can be long. */
  label: string;
  /** Clubspot's kind of question: text, select, radio, or file upload. */
  field_type: string;
  required: boolean;
}

/** One registration's answer to a camp's question. Copied from Clubspot. */
export interface ClubspotCustomFieldResponses {
  /** Made from the registration's and the question's Clubspot IDs. */
  id: string;
  registration_id: string | ClubspotRegistrations;
  definition_id: string | ClubspotCustomFieldDefinitions;
  value: string | null;
}

/** How many sailors a class can take in a session. Copied from Clubspot, so edit it there. */
export interface ClubspotEntryCaps {
  /** Clubspot's own ID for this row. */
  id: string;
  class_id: string | ClubspotClasses;
  session_id: string | ClubspotSessions | null;
  cap: number;
}

/** A sailor as their Clubspot registration form gives them: guardians, emergency contacts, and medical answers. Copied from Clubspot. Edit the person in People instead. */
export interface ClubspotParticipants {
  /** Clubspot's own ID for this row. */
  id: string;
  person_id: string | People | null;
  last_sync_run_id: string | SyncRuns | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  guardian_1_name: string | null;
  guardian_1_email: string | null;
  guardian_1_mobile: string | null;
  guardian_2_name: string | null;
  guardian_2_email: string | null;
  guardian_2_mobile: string | null;
  emergency_1_name: string | null;
  emergency_1_phone: string | null;
  emergency_1_email: string | null;
  emergency_1_relationship: string | null;
  emergency_2_name: string | null;
  emergency_2_phone: string | null;
  emergency_2_email: string | null;
  emergency_2_relationship: string | null;
  medical_conditions: string | null;
  medical_allergies: string | null;
  medical_medications: string | null;
  medical_last_tetanus: string | null;
  medical_physician_name: string | null;
  medical_physician_phone: string | null;
  /** As typed on the Clubspot form, so it may not be a number. */
  medical_weight: string | null;
  /** This participant's registrations. */
  registrations: (string | ClubspotRegistrations)[];
}

/** Which Clubspot registration questions fill in a field on a person's CRM record, such as School. Staff keep this list. */
export interface ClubspotPromotedFields {
  id: string;
  /** The field on a person's CRM record that the answers fill in. */
  target_field: "school" | "share_contact";
  /** The Clubspot questions, worded exactly as on the form, whose answers fill in this field. */
  labels: string[];
}

/** What a registration was charged and paid. Copied from Clubspot, so edit it there. */
export interface ClubspotRegistrationBilling {
  /** Clubspot's own ID for this row. */
  id: string;
  registration_id: string | ClubspotRegistrations;
  /** The total charged. In cents: 12500 is $125.00. */
  amount: number;
  /** Charged but not paid yet. In cents: 12500 is $125.00. */
  amount_pending: number;
  /** In cents: 12500 is $125.00. */
  amount_received: number;
  /** In cents: 12500 is $125.00. */
  amount_refunded: number;
  /** Approved on a card but not collected yet, as Clubspot reports it. In cents: 12500 is $125.00. */
  amount_capturable: number;
  /** Left to bill later, such as on a payment plan, as Clubspot reports it. In cents: 12500 is $125.00. */
  amount_deferred: number;
  /** How much of the amount left to bill later has been billed so far. In cents: 12500 is $125.00. */
  deferred_amount_billed: number;
  /** In cents: 12500 is $125.00. */
  discount: number;
  /** In cents: 12500 is $125.00. */
  processing_fee: number;
  /** Card processing fees the family paid on top. In cents: 12500 is $125.00. */
  processing_passed_on: number;
  /** Clubspot's own fee on this charge. In cents: 12500 is $125.00. */
  application_fee_amount: number;
  /** In cents: 12500 is $125.00. */
  tax: number;
  currency: string | null;
}

/** One session and class a registration signed up for. Copied from Clubspot. */
export interface ClubspotRegistrationEntries {
  /** Clubspot's own ID for this row. */
  id: string;
  registration_id: string | ClubspotRegistrations;
  session_id: string | ClubspotSessions;
  class_id: string | ClubspotClasses;
  status: "confirmed" | "waitlist" | "cancelled";
  /** The status exactly as Clubspot gives it. Use Status instead. */
  clubspot_status: string | null;
  confirmed_at: string | null;
  waitlist_number: number | null;
  accepted_from_waitlist: boolean | null;
  /** Clubspot's priority for this entry. Often empty. */
  priority: number | null;
}

/** One sailor's registration for a camp. Copied from Clubspot. */
export interface ClubspotRegistrations {
  /** Clubspot's own ID for this row. */
  id: string;
  camp_id: string | ClubspotCamps;
  registered_at: string;
  status: string;
  waiver_status: string | null;
  archived: boolean;
  /** Null means never answered - treated as not shared. */
  share_contact: boolean | null;
  participant_id: string | ClubspotParticipants;
  last_sync_run_id: string | SyncRuns | null;
  /** The sessions and classes this registration signed up for. */
  registration_entries: (string | ClubspotRegistrationEntries)[];
}

/** Which classes a session offers. Copied from Clubspot. */
export interface ClubspotSessionClasses {
  /** Made from the session's and the class's Clubspot IDs. */
  id: string;
  session_id: string | ClubspotSessions;
  class_id: string | ClubspotClasses;
}

/** A dated part of a camp, such as one week. Copied from Clubspot, so edit it there. */
export interface ClubspotSessions {
  /** Clubspot's own ID for this row. */
  id: string;
  camp_id: string | ClubspotCamps;
  start_date: string | null;
  end_date: string | null;
  name: string | null;
  archived: boolean;
}

/** Every email and phone known for a person, from forms and from staff, not only their main ones. */
export interface ContactPoints {
  /** The last Clubspot form that gave this email or phone, if any. */
  participant_id: string | ClubspotParticipants | null;
  id: string;
  person_id: string | People;
  kind: "email" | "phone";
  value: string;
  /** The email or phone written the same way every time, so the sync can match it. */
  normalized: string;
  source: "form" | "staff";
  last_seen_at: string | null;
}

/** A person's guardians and emergency contacts, from their Clubspot forms. */
export interface Contacts {
  id: string;
  subject_id: string | People;
  contact_id: string | People;
  relationship_type: "guardian" | "emergency_contact";
  contact_order: number | null;
  relationship_detail: string | null;
}

/** One row for each person the sync has seen in a program's Google Group. Set Removed at to stop the sync adding them back. Delete the row to let the sync add them again. */
export interface GoogleGroupMemberships {
  id: string;
  group_id: string | GoogleGroups;
  person_id: string | People;
  /** The address the sync added, kept for reading. The sync matches on person, and updates this when the person's email changes. */
  email: string;
  /** When the sync first saw this person in the group, whether it added them or they were already there. */
  added_at: string;
  /** Set when the person left or was taken out of the group. While set, the sync never adds them back. Delete the row to let it add them again. */
  removed_at: string | null;
}

/** One row for each Google Group: class and program groups, and others such as the staff list. Copied from Google Workspace. */
export interface GoogleGroups {
  id: string;
  /** The group's email address. */
  email: string;
  name: string | null;
  /** Which standard settings the sync gives this group. Empty means the group is left as someone set it up by hand. */
  settings_template: "announcement" | "crew" | "inbox" | "participants" | null;
  /** The group this one sits under, such as a class group's program group. Not used yet. */
  parent_id: string | GoogleGroups | null;
  /** Copied from Google Workspace. A change here isn't sent back. */
  description: string | null;
  /** Set when the group no longer exists in Google Workspace, and cleared if it comes back. */
  archived: boolean;
}

export interface GroupMembers {
  id: string;
  group_id: string | Groups;
  /** Gets the group's policies through their login, once they have one. */
  person_id: string | People;
}

export interface GroupPolicies {
  id: string;
  group_id: string | Groups;
  /** Only a policy that groups may give. */
  policy_id: string;
}

/** A set of people, such as a committee, that gives its members one or more policies. It never sets a role. */
export interface Groups {
  id: string;
  name: string;
  description: string | null;
  /** The people in this group. Someone not yet in People is added there first. */
  members: (string | GroupMembers)[];
  /** The policies this group gives its members. */
  policies: (string | GroupPolicies)[];
}

/** A person's medical information, kept apart from People so only some staff see it. */
export interface MedicalProfiles {
  id: string;
  person_id: string | People;
  allergies: string | null;
  medications: string | null;
  conditions: string | null;
  physician_name: string | null;
  physician_phone: string | null;
  last_tetanus: string | null;
  /** A whole number, from the Clubspot form. */
  weight: number | null;
  /** When this profile last changed. */
  date_updated: string | null;
}

/** A program sold for one dated period, such as Guppies in one summer week. The Clubspot sync makes one for each Clubspot class and session whose class has a program, so edit it in Clubspot. */
export interface Offerings {
  id: string;
  program_id: string | Programs;
  starts_on: string | null;
  ends_on: string | null;
  /** How many sailors it takes. Empty means Clubspot sets no limit. */
  capacity: number | null;
  clubspot_class_id: string | ClubspotClasses;
  /** Empty when the class's limit covers every session. */
  clubspot_session_id: string | ClubspotSessions | null;
  registrations: (string | Registrations)[];
}

/** The account each cost the planning engine calculates is recorded in. One row per cost type. */
export interface OrganizationCostAccounts {
  id: string;
  organization_id: string | Organizations;
  cost_type:
    | "coach_wages"
    | "salaries"
    | "payroll_tax"
    | "ribs"
    | "boat_maintenance"
    | "resources"
    | "travel"
    | "cogs"
    | "card_fees";
  account_id: string | Accounts;
}

/** A legal entity that keeps its own books. The fiscal year is set here, per organization. */
export interface Organizations {
  id: string;
  name: string;
  /** The month the fiscal year starts in. */
  fiscal_year_start_month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

/** One row for each person the club knows. */
export interface People {
  /** The Clubspot participants linked to this person. */
  participant_links: (string | ClubspotParticipants)[];
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  /** This person's guardians and emergency contacts. */
  my_contacts: (string | Contacts)[];
  gender: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** The people this person is a guardian or emergency contact for. */
  contact_for: (string | Contacts)[];
  /** Every email and phone known for this person. */
  contact_point_links: (string | ContactPoints)[];
  school: string | null;
  /** Null means never answered - treated as not shared. */
  share_contact: boolean | null;
  /** The person's own Directus login, if they have one. Usually empty. */
  directus_user_id: string | null;
}

/** Each time a saved version was made active. A plan's newest activation is its active version. */
export interface PlanActivations {
  id: string;
  plan_id: string | Plans;
  /** A saved version of the plan. */
  version_id: string | PlanVersions;
  /** Set when the version is made active. */
  activated_at: string;
  activated_by: string | null;
  /** Set when the version is made active. The plan's active version is the one with the highest. */
  sequence: number;
}

/** One dated activity, such as a practice, a regatta day, or a travel day. */
export interface PlanActivities {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  offering_id: string | PlanOfferings;
  /** The trip a travel day belongs to. */
  trip_id: string | PlanTrips | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  on_water_minutes: number | null;
  setup_minutes: number | null;
  putaway_minutes: number | null;
  kind: "practice" | "regatta" | "clinic" | "travel";
  uses_boats: boolean;
  /** Overrides the coaches the engine works out. */
  fixed_coaches: number | null;
  /** Overrides the coach boats the engine works out. */
  fixed_ribs: number | null;
  /** Overrides the boats the engine works out. */
  fixed_boats: number | null;
}

/** Offerings whose activities share coaches and boats on certain days. */
export interface PlanActivityBlockRules {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
  /** The offerings this rule fills: add the Key of each one. */
  offering_keys: string[];
  /** ISO weekdays, 1 for Monday to 7 for Sunday. */
  weekdays: string[] | null;
  starts_on: string | null;
  ends_on: string | null;
  coach_level_id: string | PlanStaffLevels | null;
  /** The salaried positions it books: add the Key of each one. */
  salaried_positions: string[] | null;
}

/** Equipment an activity uses beyond its coach boats. */
export interface PlanActivityResources {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  activity_id: string | PlanActivities;
  /** The resource it uses: copy the Key from a resource in the Operations Plan. */
  resource_key: string;
  quantity: string;
  hours: string | null;
}

/** What an hour of sailing costs in maintenance, for each boat class. */
export interface PlanBoatRates {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  boat_class_id: string | BoatClasses;
  /** In cents: 12500 is $125.00. */
  maintenance_per_boat_hour_cents: number;
}

/** The products a bonus owner owns. */
export interface PlanBonusOwnerProducts {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  bonus_owner_id: string | PlanBonusOwners;
  product_id: string | Products;
}

/** A role, such as a program area's director, that earns a bonus on the products it owns. */
export interface PlanBonusOwners {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  role_name: string;
  /** A share of its products' net. 0.05 means 5%. */
  bonus_rate: string;
  account_id: string | Accounts;
  /** Whether the net is counted after each offering's share of the pools, such as G&A, or before it. */
  basis: "after_shared_costs" | "before_shared_costs" | null;
  /** The salaried position this bonus pays, if any: copy the Key from a salaried position in the Operations Plan. */
  position_key: string | null;
}

/** A cost or revenue entered as an amount. */
export interface PlanBudgetLines {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
  account_id: string | Accounts;
  function: "program" | "management" | "fundraising" | null;
  cost_center_type: "offering" | "product" | "program_area" | "pool" | "org";
  /** Who the cost is charged to: copy the Key from an offering or a pool, or a product's ID from the end of its page's web address. Leave empty for the whole club. */
  cost_center_key: string | null;
  /** In cents: 12500 is $125.00. */
  amount_cents: number;
  fiscal_year: number;
  /** Set for a cost left out of modified total direct costs (MTDC), such as equipment. */
  excluded_from_mtdc: boolean;
  note: string | null;
}

/** A day the club is closed, such as Labor Day. The P&L warns about an activity on one. */
export interface PlanClosedDates {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  date: string;
  /** Why it's closed, such as Labor Day. */
  name: string;
}

/** Labor not tied to an activity, such as training, priced at a staff level. */
export interface PlanLaborLines {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
  cost_center_type: "offering" | "product" | "program_area" | "pool" | "org";
  /** Who the cost is charged to: copy the Key from an offering or a pool, or a product's ID from the end of its page's web address. Leave empty for the whole club. */
  cost_center_key: string | null;
  /** Who does the work: copy the Key from a staff level in the Operations Plan. */
  staff_level_key: string;
  hours: string;
  account_id: string | Accounts;
  function: "program" | "management" | "fundraising" | null;
  note: string | null;
}

/** The boat classes an offering sails, and each one's share of its sailors. */
export interface PlanOfferingBoatClasses {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  offering_id: string | PlanOfferings;
  boat_class_id: string | BoatClasses;
  /** This boat class's share of the offering's sailors. 0.5 means 50%. */
  share: string;
}

/** A product sold for a period, such as a season or a week. */
export interface PlanOfferings {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  product_id: string | Products;
  name: string;
  season_term: string | null;
  starts_on: string;
  ends_on: string;
  capacity: number | null;
  /** Whole kids. Or set Fill rate instead. */
  target_enrollment: number | null;
  /** A share of capacity, used when Target enrollment is empty. 0.8 means 80%. */
  fill_rate: string | null;
  /** Per kid. In cents: 12500 is $125.00. */
  price_cents: number | null;
  sailors_per_coach: string | null;
  min_coaches: number | null;
  /** The coach level: copy the Key from a staff level in the Operations Plan. */
  coach_level_key: string | null;
  required_qualification: string | Qualifications | null;
  ribs_per_coach: string | null;
  /** The share of sailors who bring their own boat. 0.25 means 25%. */
  byob_share: string | null;
  /** Overrides the coaches the engine works out. */
  fixed_coaches: number | null;
  /** Overrides the coach boats the engine works out. */
  fixed_ribs: number | null;
  /** Overrides the boats the engine works out. */
  fixed_boats: number | null;
  /** Cost of goods sold, as a share of revenue. 0.1 means 10%. */
  cogs_rate: string | null;
  note: string | null;
  /** A salaried coach who coaches every practice: copy the Key from a salaried position in the Operations Plan. */
  coach_position_key: string | null;
  /** Out of their salary, or by the hour at the offering's coach level, on top of their salary. */
  coach_position_pay: "salary" | "hourly" | null;
}

/** Shared costs no single offering owns, such as G&A, divided among the year's offerings by MTDC. */
export interface PlanPools {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
}

/** The year's rates. One row at most in each version. */
export interface PlanRates {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  /** Employer payroll costs, as a share of wages. 0.1 means 10%. */
  payroll_tax_rate: string | null;
  /** In cents: 12500 is $125.00. */
  lodging_per_night_cents: number | null;
  /** In cents: 12500 is $125.00. */
  mileage_rate_cents: number | null;
  /** The kind of resource whose cost prices coach boat (RIB) hours. */
  rib_resource_kind_id: string | ResourceKinds | null;
}

/** Equipment programs share, such as coach boats, and what an hour or a day of it costs. */
export interface PlanResources {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  resource_kind_id: string | ResourceKinds;
  name: string;
  quantity: number | null;
  /** In cents: 12500 is $125.00. */
  cost_per_hour_cents: number | null;
  /** In cents: 12500 is $125.00. */
  cost_per_day_cents: number | null;
  /** In cents: 12500 is $125.00. */
  fuel_per_hour_cents: number | null;
  /** In cents: 12500 is $125.00. */
  maintenance_per_hour_cents: number | null;
  /** Set for a rental, whose cost is left out of modified total direct costs (MTDC). */
  excluded_from_mtdc: boolean;
}

/** Each cost and revenue line in a saved version's P&L. Worked out when the version was saved, and never changed. */
export interface PlanResultLines {
  id: string;
  /** The saved version these results are for. */
  version_id: string | PlanVersions;
  cost_center_type: "offering" | "product" | "program_area" | "pool" | "org";
  cost_center_key: string | null;
  cost_center_name: string;
  account_id: string | Accounts;
  function: "program" | "management" | "fundraising" | null;
  /** Always positive: the account says whether it's revenue or a cost. In cents: 12500 is $125.00. */
  amount_cents: number;
  /** What the line is, as the P&L names it. */
  line: string;
  explanation: string | null;
}

/** A saved version's P&L for each offering, product, and program area. Worked out when the version was saved, and never changed. */
export interface PlanResultPnl {
  id: string;
  /** The saved version these results are for. */
  version_id: string | PlanVersions;
  level: "offering" | "product" | "program_area";
  subject_key: string;
  name: string;
  /** In cents: 12500 is $125.00. */
  revenue_cents: number;
  /** In cents: 12500 is $125.00. */
  expense_cents: number;
  /** In cents: 12500 is $125.00. */
  net_cents: number;
  /** Modified total direct costs, which shared costs are divided by. In cents: 12500 is $125.00. */
  mtdc_cents: number;
  enrollment: number;
  days: number;
  sailor_days: number;
}

/** Each salaried position's pay for the year, in a saved version. Worked out when the version was saved, and never changed. */
export interface PlanResultPositions {
  id: string;
  /** The saved version these results are for. */
  version_id: string | PlanVersions;
  position_key: string;
  name: string;
  /** In cents: 12500 is $125.00. */
  salary_cents: number;
  salaried_coaching_hours: string;
  /** In cents: 12500 is $125.00. */
  salaried_coaching_cents: number;
  hourly_coaching_hours: string;
  /** In cents: 12500 is $125.00. */
  hourly_coaching_cents: number;
  booking_hours: string;
  /** In cents: 12500 is $125.00. */
  booking_cents: number;
  /** In cents: 12500 is $125.00. */
  bonus_cents: number;
  /** Salary, hourly coaching wages, and bonus. In cents: 12500 is $125.00. */
  total_pay_cents: number;
  /** The year's payroll tax on the total pay. In cents: 12500 is $125.00. */
  payroll_tax_cents: number;
}

/** The other saved versions a version's results were worked out with. Worked out when the version was saved, and never changed. */
export interface PlanResultVersions {
  id: string;
  /** The saved version these results are for. */
  version_id: string | PlanVersions;
  /** Another saved version in the club's plan when this one was saved. */
  calculated_with_id: string | PlanVersions;
}

/** What the P&L warned about when a version was saved. Worked out when the version was saved, and never changed. */
export interface PlanResultWarnings {
  id: string;
  /** The saved version these results are for. */
  version_id: string | PlanVersions;
  /** The kind of warning. */
  code: string;
  message: string;
  subject_key: string | null;
}

/** A saved version's club-wide totals. Worked out when the version was saved, and never changed. */
export interface PlanResults {
  id: string;
  /** The saved version these results are for. */
  version_id: string | PlanVersions;
  calculated_at: string;
  /** In cents: 12500 is $125.00. */
  operating_revenue_cents: number;
  /** In cents: 12500 is $125.00. */
  operating_expense_cents: number;
  /** In cents: 12500 is $125.00. */
  operating_net_cents: number;
  /** In cents: 12500 is $125.00. */
  fundraising_revenue_cents: number;
  /** In cents: 12500 is $125.00. */
  fundraising_expense_cents: number;
  /** In cents: 12500 is $125.00. */
  fundraising_net_cents: number;
  /** Spent on capital, such as a coach boat. In cents: 12500 is $125.00. */
  capital_cents: number;
  /** Operating net, plus fundraising net, less capital. In cents: 12500 is $125.00. */
  total_cents: number;
}

/** A charge set as a share of each offering's revenue, such as scholarships or card fees. Operations Plan only. */
export interface PlanRevenueCharges {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
  /** The share of each offering's revenue: 0.02 means 2%. */
  rate: string;
  /** The kinds of product it applies to. Empty applies it to none. */
  product_kinds: ("program" | "charter" | "storage_lease" | "merchandise" | "event_hosting" | "other")[] | null;
  /** A revenue account adds revenue, such as card fees families pay. An expense account adds a cost. */
  account_id: string | Accounts;
  /** Set for a charge 2 CFR 200.1 leaves out of MTDC, such as scholarships. */
  excluded_from_mtdc: boolean;
  note: string | null;
}

/** Hours of a salaried position booked to a product. */
export interface PlanSalariedBookings {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  position_id: string | PlanSalariedPositions;
  /** The product the hours are for. Set this or the program area, not both. */
  product_id: string | Products | null;
  /** The program area the hours are for, shared among its offerings. Set this or the product, not both. */
  program_area_id: string | ProgramAreas | null;
  kind: "management";
  hours: string;
}

/** A salaried position, and where the part of its salary not charged to programs goes. */
export interface PlanSalariedPositions {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
  /** In cents: 12500 is $125.00. */
  annual_salary_cents: number;
  paid_hours_per_year: number | null;
  /** The qualifications this position needs. Add each one's ID, from the end of its page's web address. */
  qualifications: string[] | null;
  /** The share of its salary that is general and administrative (G&A). 0.2 means 20%. */
  ga_share: string | null;
  /** The pool that takes the salary its hours don't charge to programs. */
  remainder_pool_id: string | PlanPools | null;
  form_990_line: string | null;
}

/** A level hourly staff are paid at, such as head coach. */
export interface PlanStaffLevels {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  name: string;
  pay_type: "hourly" | "volunteer";
  /** In cents: 12500 is $125.00. */
  hourly_rate_cents: number | null;
  /** The qualifications this level needs. Add each one's ID, from the end of its page's web address. */
  qualifications: string[] | null;
}

/** A trip an offering travels for, such as an away regatta. */
export interface PlanTrips {
  id: string;
  /** The version this row belongs to. */
  version_id: string | PlanVersions;
  /** Stays the same across versions. Copy it where another row asks for this one's Key. */
  key: string;
  offering_id: string | PlanOfferings;
  name: string;
  nights: number | null;
  /** Per coach. In cents: 12500 is $125.00. */
  airfare_cents: number | null;
  miles: number | null;
}

/** A plan's draft, or a version saved from it, which never changes. */
export interface PlanVersions {
  id: string;
  plan_id: string | Plans;
  /** The saved version this draft started from. */
  parent_version_id: string | PlanVersions | null;
  /** Saving a draft sets this to saved. A saved version never changes, even for an admin. */
  status: "draft" | "saved";
  /** What changed in this version. */
  message: string | null;
  /** Set when the version is saved. */
  saved_by: string | null;
  /** Set when the version is saved. */
  saved_at: string | null;
  /** The version of the planning engine that calculated its numbers. Required to save. */
  platform_version: string | null;
  /** For a program area's plan: the saved Operations Plan version its numbers were calculated with, for the same organization and year. Required to save. Empty for the Operations Plan. */
  operations_version_id: string | PlanVersions | null;
  /** What you want that the plan's numbers don't capture, for your AI to fill in. For example: every Monday, Wednesday and Friday, except on SPS school holidays, from 4pm until dusk. */
  rules: string | null;
  /** What the P&L showed when this version was saved, worked out a moment after it's saved. A saved version with none means working them out failed, and an admin can fill them in. */
  results: (string | PlanResults)[];
}

/** One part of the club's plan: a program area's plan, or the Operations Plan. */
export interface Plans {
  id: string;
  kind: "program_area" | "operations";
  /** The program area the plan is for. Empty for the Operations Plan. */
  program_area_id: string | ProgramAreas | null;
  /** The organization the plan is for. Can't change once the plan has a saved version. */
  organization_id: string | Organizations;
  /** The plan year. Fiscal year N ends in calendar year N. Can't change once the plan has a saved version. */
  fiscal_year: number;
  name: string;
  /** A plan with a saved version can't be deleted, so archive it instead. */
  archived: boolean;
  /** The plan's draft and saved versions. */
  versions: (string | PlanVersions)[];
}

/** A lasting thing the club sells. A program also has a row in Programs. */
export interface Products {
  id: string;
  name: string;
  /** A program also needs a row in Programs. Directus can't check that, so keep them matching. */
  kind: "program" | "charter" | "storage_lease" | "merchandise" | "event_hosting" | "other";
  /** Where the product's sales are booked, for a product in no program area. A product in a program area uses the area's revenue account. */
  revenue_account_id: string | Accounts | null;
  /** This product's program details, if it is a program. */
  programs: (string | Programs)[];
  /** The program area a program belongs to. Merchandise, storage, and charters belong to none. */
  program_area_id: string | ProgramAreas | null;
}

/** Who holds a role, such as Director, in a program area, and when. */
export interface ProgramAreaRoleAssignments {
  id: string;
  person_id: string | People;
  /** The program area the role is in. */
  program_area_id: string | ProgramAreas;
  program_role_id: string | ProgramRoles;
  starts_on: string | null;
  ends_on: string | null;
}

/** A part of the club's programs, such as Summer or Singlehanded, with its revenue account. People hold roles in it, such as Director. Each is one of the club's program services on Form 990 Part III. */
export interface ProgramAreas {
  id: string;
  name: string;
  /** Where the area's programs' fees are booked. */
  revenue_account_id: string | Accounts;
  /** The products in the area: its programs. */
  products: (string | Products)[];
  /** Who holds a role in the area, such as Director. */
  role_assignments: (string | ProgramAreaRoleAssignments)[];
}

/** The role someone has in a program, such as Parent Coordinator. Entered by staff, never by a sync. With no dates, it lasts until someone ends it. */
export interface ProgramRoleAssignments {
  id: string;
  person_id: string | People;
  program_id: string | Programs;
  program_role_id: string | ProgramRoles;
  starts_on: string | null;
  ends_on: string | null;
}

/** The roles staff can give someone in a program, such as Parent Coordinator. */
export interface ProgramRoles {
  id: string;
  name: string;
  description: string | null;
}

/** A lasting program, such as Youth Camp, that staff link each Clubspot class to. Not the same as a Clubspot camp. */
export interface Programs {
  /** The Clubspot classes linked to this program. */
  classes: (string | ClubspotClasses)[];
  id: string;
  name: string;
  /** The product this program belongs to. Its kind must be Program. */
  product_id: string | Products;
  /** Who has a role in this program. */
  role_assignments: (string | ProgramRoleAssignments)[];
  /** The program's Google Group, if it has one. Most programs don't. */
  google_group_id: string | GoogleGroups | null;
}

/** Holding one qualification also meets a requirement for another. */
export interface QualificationCovers {
  id: string;
  qualification_id: string | Qualifications;
  covers_id: string | Qualifications;
}

/** A certification a coach holds or an offering requires. */
export interface Qualifications {
  id: string;
  name: string;
  /** The qualifications this one satisfies a requirement for. */
  covers: (string | QualificationCovers)[];
}

/** One person registered in one offering. The Clubspot sync makes one for each sailor in a class and session, so edit it in Clubspot. */
export interface Registrations {
  id: string;
  person_id: string | People;
  offering_id: string | Offerings;
  status: "confirmed" | "waitlist" | "cancelled";
  clubspot_entry_id: string | ClubspotRegistrationEntries;
}

/** A kind of shared resource, such as RIB or trailer. */
export interface ResourceKinds {
  id: string;
  name: string;
}

/** One row each time a sync runs. */
export interface SyncRuns {
  id: string;
  /** Which sync ran. */
  source: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "succeeded" | "failed";
  counts: unknown;
  error: string | null;
}

/** The work each sync has queued, run, or given up on. Written by the syncs. */
export interface SyncTasks {
  id: string;
  /** Which sync owns this task. */
  queue: string;
  /** What the task does, such as syncing one camp. Each sync names its own. */
  kind: string;
  /** What the task is about, such as a camp. Queuing the same thing again updates this row. */
  key: string;
  /** The task that queued this one, if any. */
  parent_id: string | SyncTasks | null;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  /** The task waits until this time. Empty means it can run now. */
  run_after: string | null;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Set once the task has failed too many times. It keeps retrying; this flags it for staff. */
  needs_attention: boolean;
}
