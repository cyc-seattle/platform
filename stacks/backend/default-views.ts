import type { DefaultView } from "../../src/directus/resources.ts";

/**
 * How each collection's table opens for anyone who hasn't saved their own view: its sort and its
 * columns. Every collection the sidebar shows has one. A dotted path sorts by a linked row's field.
 */
export const defaultViews: DefaultView[] = [
  // Access
  { collection: "groups", sort: ["name"], fields: ["name", "description", "members", "policies"] },

  // Clubspot: Schedule
  { collection: "clubspot_camps", sort: ["-start_date"], fields: ["name", "start_date", "end_date", "archived"] },
  {
    collection: "clubspot_sessions",
    sort: ["-start_date", "name"],
    fields: ["camp_id", "name", "start_date", "end_date"],
  },
  { collection: "clubspot_classes", sort: ["-camp_id.start_date", "name"], fields: ["name", "camp_id", "program_id"] },
  {
    collection: "clubspot_entry_caps",
    sort: ["-session_id.start_date", "class_id.name"],
    fields: ["session_id", "class_id", "cap"],
  },
  {
    collection: "clubspot_session_classes",
    sort: ["-session_id.start_date", "class_id.name"],
    fields: ["session_id", "class_id"],
  },

  // Clubspot: Registrations
  {
    collection: "clubspot_registrations",
    sort: ["-registered_at"],
    fields: ["participant_id", "camp_id", "registered_at", "status", "waiver_status"],
  },
  {
    collection: "clubspot_registration_entries",
    sort: ["-confirmed_at"],
    fields: ["registration_id", "session_id", "class_id", "status", "waitlist_number"],
  },
  {
    collection: "clubspot_registration_billing",
    sort: ["-registration_id.registered_at"],
    fields: ["registration_id", "amount", "amount_received", "amount_pending", "amount_refunded"],
  },
  {
    collection: "clubspot_participants",
    sort: ["last_name", "first_name"],
    fields: ["last_name", "first_name", "date_of_birth", "person_id"],
  },
  {
    collection: "clubspot_custom_field_definitions",
    sort: ["-camp_id.start_date", "label"],
    fields: ["camp_id", "label", "field_type", "required"],
  },
  {
    collection: "clubspot_custom_field_responses",
    sort: ["-registration_id.registered_at", "definition_id.label"],
    fields: ["registration_id", "definition_id", "value"],
  },
  { collection: "clubspot_promoted_fields", sort: ["target_field"], fields: ["target_field", "labels"] },

  // Catalog
  { collection: "accounts", sort: ["number"], fields: ["number", "name", "type", "parent_id"] },
  { collection: "boat_classes", sort: ["name"], fields: ["name", "sailors_per_boat", "footprint_sq_ft"] },
  { collection: "products", sort: ["name"], fields: ["name", "kind", "program_area_id", "revenue_account_id"] },
  { collection: "program_areas", sort: ["name"], fields: ["name", "revenue_account_id"] },
  { collection: "programs", sort: ["name"], fields: ["name", "product_id"] },
  { collection: "qualifications", sort: ["name"], fields: ["name", "covers"] },
  { collection: "resource_kinds", sort: ["name"], fields: ["name"] },
  { collection: "organizations", sort: ["name"], fields: ["name", "fiscal_year_start_month"] },
  {
    collection: "organization_cost_accounts",
    sort: ["organization_id.name", "cost_type"],
    fields: ["organization_id", "cost_type", "account_id"],
  },

  // CRM
  { collection: "people", sort: ["last_name", "first_name"], fields: ["last_name", "first_name", "email", "phone"] },
  {
    collection: "contacts",
    sort: ["contact_order"],
    fields: ["subject_id", "contact_id", "relationship_type", "contact_order"],
  },
  {
    collection: "contact_points",
    sort: ["person_id.last_name", "kind"],
    fields: ["person_id", "kind", "value", "source"],
  },
  // Medical details stay on the profile's own page.
  { collection: "medical_profiles", sort: ["-date_updated"], fields: ["person_id", "date_updated"] },
  { collection: "program_roles", sort: ["name"], fields: ["name", "description"] },
  {
    collection: "program_role_assignments",
    sort: ["-starts_on", "person_id.last_name"],
    fields: ["person_id", "program_id", "program_role_id", "starts_on", "ends_on"],
  },
  {
    collection: "program_area_role_assignments",
    sort: ["program_area_id.name", "person_id.last_name"],
    fields: ["person_id", "program_area_id", "program_role_id", "starts_on", "ends_on"],
  },
  {
    collection: "offerings",
    sort: ["-starts_on", "program_id.name"],
    fields: ["program_id", "starts_on", "ends_on", "capacity"],
  },
  {
    collection: "registrations",
    sort: ["-offering_id.starts_on", "person_id.last_name"],
    fields: ["person_id", "offering_id", "status"],
  },

  // Google Workspace
  { collection: "google_groups", sort: ["name"], fields: ["name", "email", "parent_id", "settings_template"] },
  {
    collection: "google_group_memberships",
    sort: ["group_id.email", "person_id.last_name"],
    fields: ["group_id", "person_id", "email", "added_at"],
    filter: { removed_at: { _null: true } },
  },

  // Planning
  { collection: "plans", sort: ["-fiscal_year", "name"], fields: ["name", "fiscal_year", "kind", "program_area_id"] },
  {
    collection: "plan_versions",
    sort: ["plan_id.name", "-saved_at"],
    fields: ["plan_id", "status", "saved_at", "message"],
  },
  { collection: "plan_activations", sort: ["-activated_at"], fields: ["plan_id", "version_id", "activated_at"] },
  {
    collection: "plan_offerings",
    sort: ["version_id.plan_id.name", "starts_on", "name"],
    fields: ["name", "version_id", "product_id", "starts_on", "ends_on", "capacity", "price_cents"],
  },
  {
    collection: "plan_offering_boat_classes",
    sort: ["offering_id.name", "boat_class_id.name"],
    fields: ["offering_id", "boat_class_id", "share", "version_id"],
  },
  {
    collection: "plan_trips",
    sort: ["offering_id.name", "name"],
    fields: ["name", "offering_id", "nights", "miles", "airfare_cents"],
  },
  {
    collection: "plan_activities",
    sort: ["date", "start_time"],
    fields: ["date", "start_time", "end_time", "offering_id", "kind"],
  },
  {
    collection: "plan_activity_resources",
    sort: ["activity_id.date"],
    fields: ["activity_id", "quantity", "hours", "version_id"],
  },
  {
    collection: "plan_labor_lines",
    sort: ["version_id.plan_id.name", "name"],
    fields: ["name", "version_id", "cost_center_type", "hours", "account_id"],
  },
  {
    collection: "plan_budget_lines",
    sort: ["version_id.plan_id.name", "account_id.number", "name"],
    fields: ["name", "version_id", "account_id", "amount_cents", "fiscal_year"],
  },
  {
    collection: "plan_rates",
    sort: ["version_id.plan_id.name"],
    fields: ["version_id", "payroll_tax_rate", "lodging_per_night_cents", "mileage_rate_cents"],
  },
  {
    collection: "plan_revenue_charges",
    sort: ["version_id.plan_id.name", "name"],
    fields: ["name", "rate", "product_kinds", "account_id", "excluded_from_mtdc", "version_id"],
  },
  {
    collection: "plan_staff_levels",
    sort: ["version_id.plan_id.name", "name"],
    fields: ["name", "version_id", "pay_type", "hourly_rate_cents"],
  },
  {
    collection: "plan_salaried_positions",
    sort: ["version_id.plan_id.name", "name"],
    fields: ["name", "version_id", "annual_salary_cents", "paid_hours_per_year"],
  },
  {
    collection: "plan_salaried_bookings",
    sort: ["position_id.name", "program_area_id.name", "product_id.name"],
    fields: ["position_id", "program_area_id", "product_id", "kind", "hours", "version_id"],
  },
  {
    collection: "plan_resources",
    sort: ["version_id.plan_id.name", "name"],
    fields: ["name", "version_id", "resource_kind_id", "quantity"],
  },
  {
    collection: "plan_boat_rates",
    sort: ["version_id.plan_id.name", "boat_class_id.name"],
    fields: ["boat_class_id", "version_id", "maintenance_per_boat_hour_cents"],
  },
  {
    collection: "plan_activity_block_rules",
    sort: ["version_id.plan_id.name", "name"],
    fields: ["name", "version_id", "starts_on", "ends_on", "coach_level_id"],
  },
  { collection: "plan_pools", sort: ["version_id.plan_id.name", "name"], fields: ["name", "version_id"] },
  {
    collection: "plan_bonus_owners",
    sort: ["version_id.plan_id.name", "role_name"],
    fields: ["role_name", "version_id", "bonus_rate", "account_id"],
  },
  {
    collection: "plan_bonus_owner_products",
    sort: ["bonus_owner_id.role_name", "product_id.name"],
    fields: ["bonus_owner_id", "product_id", "version_id"],
  },

  // Sync
  { collection: "sync_runs", sort: ["-started_at"], fields: ["started_at", "source", "status", "finished_at"] },
  {
    collection: "sync_tasks",
    sort: ["-needs_attention", "-run_after"],
    fields: ["queue", "kind", "key", "status", "needs_attention", "attempts"],
  },
  // Open findings only, until someone clears the filter.
  {
    collection: "audit_findings",
    sort: ["source", "kind"],
    fields: ["source", "kind", "subject", "status"],
    filter: { status: { _eq: "open" } },
  },
];
