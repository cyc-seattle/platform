import { randomUUID } from "node:crypto";
import { newRunId } from "../cluster.ts";
import { devDirectusAdmin, type DirectusSession } from "../directus.ts";

// The rows every access feature works on: a row in each of the catalog's collections, a camp with one session and class, and a child
// registered in it, with one guardian and a medical profile. A second child, in another family, is
// registered in the same class. Every row is this run's own, and is deleted afterwards.

export type Row = Record<string, unknown>;
/** A row Directus returned, which always has its key. */
export type Item = Row & { id: string };

export const runId = newRunId();
let serial = 0;
export const key = (prefix: string) => `${prefix}-${runId}-${++serial}`;
// Directus checks a user's email against the real TLDs, so not `.test`.
export const email = (name: string) => `${name}.${runId}-${++serial}@example.com`;
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let adminSession: Promise<DirectusSession> | undefined;
export const admin = () => (adminSession ??= devDirectusAdmin());

/** Every row this run created, in order, so cleanup can delete them in reverse. */
export const created: { collection: string; id: unknown }[] = [];
/**
 * The run's row in each collection, keyed by its collection, or `<collection>@<version>` where a
 * collection has a row in each plan version. The child's, where the row belongs to a person.
 */
export const row: Record<string, string> = {};
/** Each of those rows as the admin created it, with every field. */
export const fixture: Record<string, Row> = {};
/** The run's child's guardian, whom the Community login signs in as. */
export let guardianPersonId: string;

export async function adminCreate(collection: string, data: Row): Promise<Item> {
  const item = await (await admin()).ok("POST", `/items/${collection}`, data);
  created.push({ collection, id: item.id });
  return item;
}

/** Creates a fresh row as the admin, for a collection whose foreign key must be unique. */
export async function fresh(collection: string): Promise<string> {
  return (await adminCreate(collection, await newRow(collection))).id;
}

/**
 * A valid new row for each collection, pointing at the run's rows. Every row gets a client-made id,
 * whatever its key type, so a create that ought to fail and didn't is still cleaned up. A step that
 * builds a collection adds its builder here.
 */
export const builders: Record<string, (fixed: Row) => Promise<Row>> = {
  accounts: async () => ({
    id: randomUUID(),
    number: key("account"),
    name: `Account ${runId}`,
    type: "revenue",
    retired: false,
  }),
  products: async () => ({
    id: randomUUID(),
    name: `Product ${runId}`,
    kind: "other",
    revenue_account_id: row["accounts"],
  }),
  qualifications: async () => ({ id: randomUUID(), name: `Qualification ${key("qualification")}` }),
  qualification_covers: async () => ({
    id: randomUUID(),
    qualification_id: row["qualifications"],
    covers_id: await fresh("qualifications"),
  }),
  boat_classes: async () => ({ id: randomUUID(), name: `Boat ${key("boat")}`, sailors_per_boat: 1 }),
  resource_kinds: async () => ({ id: randomUUID(), name: `Resource ${key("resource")}` }),
  // A program is the subtype of a product of kind `program`, and each has its own.
  programs: async () => ({
    id: randomUUID(),
    name: `Program ${runId}`,
    product_id: (await adminCreate("products", await newRow("products", { kind: "program" }))).id,
  }),
  organizations: async () => ({
    id: randomUUID(),
    name: `Organization ${key("organization")}`,
    fiscal_year_start_month: 10,
  }),
  program_roles: async () => ({ id: randomUUID(), name: `Role ${key("role")}` }),
  camps: async () => ({
    id: key("camp"),
    name: `Camp ${runId}`,
    start_date: daysFromNow(-7),
    end_date: daysFromNow(7),
    archived: false,
    quiet_runs: 0,
  }),
  sessions: async () => ({ id: key("session"), camp_id: row["camps"], archived: false }),
  classes: async () => ({
    id: key("class"),
    camp_id: row["camps"],
    name: `Class ${runId}`,
    program_id: row["programs"],
  }),
  session_classes: async () => ({ id: key("session-class"), session_id: row["sessions"], class_id: row["classes"] }),
  entry_caps: async () => ({ id: key("entry-cap"), class_id: row["classes"], session_id: row["sessions"], cap: 10 }),
  custom_field_definitions: async () => ({
    id: key("field"),
    camp_id: row["camps"],
    label: "Shirt size",
    field_type: "text",
    required: false,
  }),
  custom_field_responses: async () => ({
    id: key("response"),
    registration_id: row["registrations"],
    definition_id: row["custom_field_definitions"],
    value: "M",
  }),
  people: async () => ({ id: randomUUID(), first_name: "Pat", last_name: `Test ${runId}`, email: email("pat") }),
  contacts: async () => ({
    id: randomUUID(),
    subject_id: row["people"],
    contact_id: guardianPersonId,
    relationship_type: "emergency",
  }),
  contact_points: async () => {
    const value = email("point");
    return { id: randomUUID(), person_id: row["people"], kind: "email", value, normalized: value, source: "test" };
  },
  // person_id, participant_id, and registration_id are unique, so each new row needs its own. A new
  // participant, registration, or entry hangs off a fresh one, too, so the guardian sees only the
  // run's own.
  medical_profiles: async (fixed) => ({
    id: randomUUID(),
    person_id: fixed["person_id"] ?? (await fresh("people")),
    allergies: "none",
  }),
  participants: async (fixed) => ({
    id: key("participant"),
    person_id: fixed["person_id"] ?? (await fresh("people")),
    first_name: "Pat",
  }),
  registrations: async (fixed) => ({
    id: key("registration"),
    camp_id: row["camps"],
    registered_at: new Date().toISOString(),
    status: "confirmed",
    archived: false,
    participant_id: fixed["participant_id"] ?? (await fresh("participants")),
  }),
  registration_entries: async (fixed) => ({
    id: key("entry"),
    registration_id: fixed["registration_id"] ?? (await fresh("registrations")),
    session_id: row["sessions"],
    class_id: row["classes"],
    status: "confirmed",
  }),
  registration_billing: async (fixed) => ({
    id: key("billing"),
    registration_id: fixed["registration_id"] ?? (await fresh("registrations")),
    ...Object.fromEntries(
      [
        "amount",
        "amount_pending",
        "amount_received",
        "amount_refunded",
        "amount_capturable",
        "amount_deferred",
        "deferred_amount_billed",
        "discount",
        "processing_fee",
        "processing_passed_on",
        "application_fee_amount",
        "tax",
      ].map((field) => [field, 0]),
    ),
    currency: "usd",
  }),
  event_staff: async () => ({ id: randomUUID(), person_id: guardianPersonId, session_id: row["sessions"] }),
  program_role_assignments: async () => ({
    id: randomUUID(),
    person_id: guardianPersonId,
    program_id: row["programs"],
    program_role_id: row["program_roles"],
  }),
  // A queue no worker reads, so no sync picks the task up.
  sync_tasks: async () => {
    const queue = `test-${runId}`;
    return {
      id: randomUUID(),
      queue,
      kind: "test",
      key: key(`${queue}:test`),
      status: "done",
      attempts: 0,
      max_attempts: 1,
      needs_attention: false,
    };
  },
  sync_runs: async () => ({
    id: randomUUID(),
    source: `test-${runId}`,
    started_at: new Date().toISOString(),
    status: "succeeded",
  }),
  audit_findings: async () => ({
    id: randomUUID(),
    source: `test-${runId}`,
    kind: "test",
    subject: key("subject"),
    detail: "A test finding.",
    status: "resolved",
    fingerprint: key("fingerprint"),
  }),
  // Archived, so gsuite-sync's discovery leaves it alone.
  google_groups: async () => ({ id: randomUUID(), email: email("group"), archived: true }),
  google_group_memberships: async () => ({
    id: randomUUID(),
    group_id: row["google_groups"],
    person_id: guardianPersonId,
    email: email("member"),
    added_at: new Date().toISOString(),
  }),
  promoted_fields: async () => ({ id: randomUUID(), target_field: `test_${runId}`, labels: [] }),
  groups: async () => ({ id: randomUUID(), name: `Group ${key("group")}` }),
  // The child, who has no login, so the group gives no one in the run anything.
  group_members: async () => ({ id: randomUUID(), group_id: row["groups"], person_id: row["people"] }),
  group_policies: async () => ({ id: randomUUID(), group_id: row["groups"], policy_id: await crmReaderId() }),
  // A product has one plan for each organization and year, so each plan gets a product of its own.
  plans: async (fixed) => {
    // Made first, so cleanup deletes it after the product plans saved with it.
    if (fixed["kind"] !== "operations") {
      await operationsVersionId();
    }
    return {
      id: randomUUID(),
      kind: "product",
      product_id: fixed["kind"] === "operations" ? null : await fresh("products"),
      organization_id: row["organizations"],
      fiscal_year: PLAN_YEAR,
      name: `Plan ${key("plan")}`,
    };
  },
  plan_versions: async () => ({ id: randomUUID(), plan_id: row["plans"], status: "draft", message: "A test version." }),
  plan_activations: async () => ({ id: randomUUID(), version_id: row["plan_versions@saved"] }),
  plan_pools: async (fixed) => versioned(fixed, { name: `Pool ${key("pool")}` }),
  plan_staff_levels: async (fixed) =>
    versioned(fixed, { name: `Level ${key("level")}`, pay_type: "hourly", hourly_rate_cents: 2_500 }),
  plan_offerings: async (fixed) =>
    versioned(fixed, {
      product_id: row["products"],
      name: `Offering ${key("offering")}`,
      starts_on: "2027-06-01",
      ends_on: "2027-08-31",
      capacity: 12,
      price_cents: 50_000,
      sailors_per_coach: 6,
      coach_level_key: sameVersion("plan_staff_levels", fixed)?.["key"] ?? null,
    }),
  plan_offering_boat_classes: async (fixed) =>
    versioned(fixed, {
      offering_id: sameVersionId("plan_offerings", fixed),
      boat_class_id: row["boat_classes"],
      share: 1,
    }),
  plan_trips: async (fixed) =>
    versioned(fixed, { offering_id: sameVersionId("plan_offerings", fixed), name: `Trip ${key("trip")}`, nights: 2 }),
  plan_activities: async (fixed) =>
    versioned(fixed, {
      offering_id: sameVersionId("plan_offerings", fixed),
      date: "2027-06-02",
      start_time: "09:00:00",
      end_time: "12:00:00",
      kind: "practice",
      uses_boats: true,
    }),
  plan_resources: async (fixed) =>
    versioned(fixed, {
      resource_kind_id: row["resource_kinds"],
      name: `Resource ${key("resource")}`,
      cost_per_hour_cents: 1_000,
    }),
  plan_activity_resources: async (fixed) =>
    versioned(fixed, {
      activity_id: sameVersionId("plan_activities", fixed),
      resource_key: sameVersion("plan_resources", fixed)?.["key"] ?? randomUUID(),
      quantity: 1,
    }),
  plan_labor_lines: async (fixed) =>
    versioned(fixed, {
      name: `Training ${key("labor")}`,
      cost_center_type: "org",
      staff_level_key: sameVersion("plan_staff_levels", fixed)?.["key"] ?? randomUUID(),
      hours: 10,
      account_id: row["accounts"],
    }),
  plan_budget_lines: async (fixed) =>
    versioned(fixed, {
      name: `Insurance ${key("budget")}`,
      account_id: row["accounts"],
      cost_center_type: "org",
      amount_cents: 10_000,
      fiscal_year: 2027,
      excluded_from_mtdc: false,
    }),
  // One row at most in each version, so a new one goes in a draft of its own.
  plan_rates: async (fixed) => ({
    id: randomUUID(),
    version_id: fixed["version_id"] ?? (await fresh("plan_versions")),
    payroll_tax_rate: 0.1,
    card_fee_rate: 0.03,
  }),
  plan_salaried_positions: async (fixed) =>
    versioned(fixed, {
      name: `Position ${key("position")}`,
      annual_salary_cents: 5_000_000,
      remainder_pool_id: sameVersionId("plan_pools", fixed),
    }),
  plan_salaried_bookings: async (fixed) =>
    versioned(fixed, {
      position_id: sameVersionId("plan_salaried_positions", fixed),
      product_id: row["products"],
      kind: "management",
      hours: 40,
    }),
  plan_boat_rates: async (fixed) =>
    versioned(fixed, { boat_class_id: row["boat_classes"], maintenance_per_boat_hour_cents: 100 }),
  plan_activity_block_rules: async (fixed) =>
    versioned(fixed, {
      name: `Block ${key("block")}`,
      offering_keys: [sameVersion("plan_offerings", fixed)?.["key"] ?? randomUUID()],
      weekdays: [3],
    }),
  plan_bonus_owners: async (fixed) =>
    versioned(fixed, { role_name: `Head coach ${key("bonus")}`, bonus_rate: 0.1, account_id: row["accounts"] }),
  plan_bonus_owner_products: async (fixed) =>
    versioned(fixed, { bonus_owner_id: sameVersionId("plan_bonus_owners", fixed), product_id: row["products"] }),
};

/** The version a new plan row goes in: the one `fixed` names, or the run's draft. */
function versionOf(fixed: Row): string {
  return (fixed["version_id"] as string | undefined) ?? row["plan_versions@draft"]!;
}

function versioned(fixed: Row, data: Row): Row {
  return { id: randomUUID(), version_id: versionOf(fixed), ...data };
}

/** The run's row in `collection` in the same version as a new row, which it may point at. */
function sameVersion(collection: string, fixed: Row): Row | undefined {
  const name = versionOf(fixed) === row["plan_versions@saved"] ? "saved" : "draft";
  return fixture[`${collection}@${name}`];
}

function sameVersionId(collection: string, fixed: Row): unknown {
  return sameVersion(collection, fixed)?.["id"];
}

/** A policy a group may give, for the run's group. */
async function crmReaderId(): Promise<string> {
  const filter = encodeURIComponent(JSON.stringify({ name: { _eq: "CRM Reader" } }));
  const [policy] = await (await admin()).ok("GET", `/policies?filter=${filter}&fields=id`);
  return policy.id;
}

/** A harmless change to an existing row of each collection. */
export const changes: Record<string, () => Row> = {
  accounts: () => ({ name: `Account ${runId} (renamed)` }),
  products: () => ({ name: `Product ${runId} (renamed)` }),
  qualifications: () => ({ name: `Qualification ${key("qualification")}` }),
  qualification_covers: () => ({ covers_id: row["qualifications"] }),
  boat_classes: () => ({ sailors_per_boat: 2 }),
  resource_kinds: () => ({ name: `Resource ${key("resource")}` }),
  programs: () => ({ name: `Program ${runId} (renamed)` }),
  program_roles: () => ({ description: "Changed." }),
  camps: () => ({ name: `Camp ${runId} (renamed)` }),
  sessions: () => ({ name: `Session ${runId}` }),
  classes: () => ({ name: `Class ${runId} (renamed)` }),
  session_classes: () => ({ class_id: row["classes"] }),
  entry_caps: () => ({ cap: 11 }),
  custom_field_definitions: () => ({ label: "T-shirt size" }),
  custom_field_responses: () => ({ value: "L" }),
  people: () => ({ last_name: `Test ${runId} (renamed)` }),
  contacts: () => ({ relationship_detail: "Changed" }),
  contact_points: () => ({ last_seen_at: new Date().toISOString() }),
  medical_profiles: () => ({ medications: "none" }),
  participants: () => ({ last_name: `Test ${runId}` }),
  registrations: () => ({ waiver_status: "signed" }),
  registration_entries: () => ({ priority: 1 }),
  registration_billing: () => ({ tax: 1 }),
  event_staff: () => ({ session_id: row["sessions"] }),
  program_role_assignments: () => ({ ends_on: daysFromNow(30) }),
  sync_tasks: () => ({ last_error: "Changed." }),
  sync_runs: () => ({ error: "Changed." }),
  audit_findings: () => ({ detail: "A changed test finding." }),
  google_groups: () => ({ description: "Changed." }),
  google_group_memberships: () => ({ added_at: new Date().toISOString() }),
  promoted_fields: () => ({ labels: ["Changed"] }),
  groups: () => ({ description: "Changed." }),
  group_members: () => ({ person_id: row["people"] }),
  group_policies: () => ({ group_id: row["groups"] }),
  plans: () => ({ name: `Plan ${key("plan")}` }),
  plan_versions: () => ({ message: "A changed test version." }),
  plan_activations: () => ({ version_id: row["plan_versions@saved"] }),
  plan_pools: () => ({ name: `Pool ${key("pool")}` }),
  plan_staff_levels: () => ({ hourly_rate_cents: 2_600 }),
  plan_offerings: () => ({ price_cents: 52_000 }),
  plan_offering_boat_classes: () => ({ share: 0.5 }),
  plan_trips: () => ({ nights: 3 }),
  plan_activities: () => ({ end_time: "13:00:00" }),
  plan_resources: () => ({ cost_per_hour_cents: 1_100 }),
  plan_activity_resources: () => ({ quantity: 2 }),
  plan_labor_lines: () => ({ hours: 12 }),
  plan_budget_lines: () => ({ amount_cents: 11_000 }),
  plan_rates: () => ({ card_fee_rate: 0.035 }),
  plan_salaried_positions: () => ({ annual_salary_cents: 5_100_000 }),
  plan_salaried_bookings: () => ({ hours: 45 }),
  plan_boat_rates: () => ({ maintenance_per_boat_hour_cents: 110 }),
  plan_activity_block_rules: () => ({ weekdays: [3, 5] }),
  plan_bonus_owners: () => ({ bonus_rate: 0.12 }),
  plan_bonus_owner_products: () => ({ product_id: row["products"] }),
};

/** A new row for `collection`, with `fixed`'s fields in place of the builder's. */
export async function newRow(collection: string, fixed: Row = {}): Promise<Row> {
  const build = builders[collection];
  if (!build) {
    throw new Error(`No builder for ${collection}.`);
  }
  return { ...(await build(fixed)), ...fixed };
}

export function change(collection: string): Row {
  const make = changes[collection];
  if (!make) {
    throw new Error(`No change for ${collection}.`);
  }
  return make();
}

async function createRows(): Promise<void> {
  guardianPersonId = (await adminCreate("people", await newRow("people", { first_name: "Gale" }))).id;

  // In dependency order. people is the child, and each later row hangs off it where it can. Each
  // entry's fields are read at its turn, once the rows before it exist.
  const order: [string, () => Row][] = [
    ["accounts", () => ({})],
    ["products", () => ({})],
    ["qualifications", () => ({})],
    ["qualification_covers", () => ({})],
    ["boat_classes", () => ({})],
    ["resource_kinds", () => ({})],
    ["organizations", () => ({})],
    ["programs", () => ({})],
    ["program_roles", () => ({})],
    ["camps", () => ({})],
    ["sessions", () => ({})],
    ["classes", () => ({})],
    ["session_classes", () => ({})],
    ["entry_caps", () => ({})],
    ["custom_field_definitions", () => ({})],
    ["promoted_fields", () => ({})],
    ["people", () => ({})],
    ["contacts", () => ({ relationship_type: "guardian" })],
    ["contact_points", () => ({})],
    ["medical_profiles", () => ({ person_id: row["people"] })],
    ["participants", () => ({ person_id: row["people"] })],
    ["registrations", () => ({ participant_id: row["participants"] })],
    ["custom_field_responses", () => ({})],
    ["registration_entries", () => ({ registration_id: row["registrations"] })],
    ["registration_billing", () => ({ registration_id: row["registrations"] })],
    ["event_staff", () => ({})],
    ["program_role_assignments", () => ({})],
    ["sync_tasks", () => ({})],
    ["sync_runs", () => ({})],
    ["audit_findings", () => ({})],
    ["google_groups", () => ({})],
    ["google_group_memberships", () => ({})],
    ["groups", () => ({})],
    ["group_members", () => ({})],
    ["group_policies", () => ({})],
  ];
  for (const [collection, fixed] of order) {
    const item = await adminCreate(collection, await newRow(collection, fixed()));
    row[collection] = item.id;
    fixture[collection] = item;
  }

  // Another family's child, in the same class, whose rows no one but staff may read.
  const other = await adminCreate("people", await newRow("people", { first_name: "Robin" }));
  const otherGuardian = await adminCreate("people", await newRow("people", { first_name: "Sam" }));
  await adminCreate(
    "contacts",
    await newRow("contacts", { subject_id: other.id, contact_id: otherGuardian.id, relationship_type: "guardian" }),
  );
  await adminCreate("medical_profiles", await newRow("medical_profiles", { person_id: other.id }));
  const participant = await adminCreate("participants", await newRow("participants", { person_id: other.id }));
  const registration = await adminCreate(
    "registrations",
    await newRow("registrations", { participant_id: participant.id }),
  );
  await adminCreate("registration_entries", await newRow("registration_entries", { registration_id: registration.id }));
}

let rows: Promise<void> | undefined;
export const runRows = () => (rows ??= createRows());

/** The rows in each plan version, in the order they can be made. */
export const PLAN_ROWS = [
  "plan_pools",
  "plan_staff_levels",
  "plan_offerings",
  "plan_offering_boat_classes",
  "plan_trips",
  "plan_activities",
  "plan_resources",
  "plan_activity_resources",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_rates",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_boat_rates",
  "plan_activity_block_rules",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
];

/** The platform version a test saves a version with. */
export const PLATFORM_VERSION = "0.0.0-test";
/** The year of every plan a test makes, for the run's own organization. */
export const PLAN_YEAR = 2027;

/** The run's Operations Plan's saved version, which a product's plan is saved with. */
async function createOperationsVersion(): Promise<string> {
  await runRows();
  const plan = await adminCreate("plans", await newRow("plans", { kind: "operations", product_id: null }));
  const version = await adminCreate("plan_versions", await newRow("plan_versions", { plan_id: plan.id }));
  await (
    await admin()
  ).ok("PATCH", itemPath("plan_versions", version.id), {
    status: "saved",
    platform_version: PLATFORM_VERSION,
    message: "Saved by a test.",
  });
  return version.id;
}

let operationsVersion: Promise<string> | undefined;
export const operationsVersionId = () => (operationsVersion ??= createOperationsVersion());

/** What saving a draft of a product's plan sets. */
export async function saving(): Promise<Row> {
  return { status: "saved", platform_version: PLATFORM_VERSION, operations_version_id: await operationsVersionId() };
}

/** Saves a draft of a product's plan as a version, as the admin. Returns the saved version. */
export async function adminSave(versionId: string): Promise<Item> {
  return (await admin()).ok("PATCH", itemPath("plan_versions", versionId), {
    ...(await saving()),
    message: "Saved by a test.",
  });
}

/**
 * A plan for the run's product, with a saved version, the active one, and a draft made from it.
 * Each version holds a row in every collection a version has. Only the planning steps need them.
 */
async function createPlanRows(): Promise<void> {
  await runRows();
  const make = async (name: string, collection: string, fixed: Row = {}) => {
    const item = await adminCreate(collection, await newRow(collection, fixed));
    row[name] = item.id;
    fixture[name] = item;
  };
  await make("plans", "plans");
  await make("plan_versions@saved", "plan_versions");
  await make("plan_versions@draft", "plan_versions", { parent_version_id: row["plan_versions@saved"] });
  for (const version of ["saved", "draft"]) {
    for (const collection of PLAN_ROWS) {
      await make(`${collection}@${version}`, collection, { version_id: row[`plan_versions@${version}`] });
    }
  }
  fixture["plan_versions@saved"] = await adminSave(row["plan_versions@saved"]!);
  await make("plan_activations", "plan_activations");
  // Read again for its versions, which were made after it.
  fixture["plans"] = await (await admin()).ok("GET", itemPath("plans", row["plans"]));
}

let planRowsMade: Promise<void> | undefined;
export const planRows = () => (planRowsMade ??= createPlanRows());

export const itemPath = (collection: string, id: unknown) => `/items/${collection}/${encodeURIComponent(String(id))}`;

/** Deletes every row this run created, newest first. Returns what it couldn't delete. */
export async function deleteRows(): Promise<string[]> {
  if (adminSession === undefined) {
    return [];
  }
  const session = await adminSession;
  const failures: string[] = [];
  for (const { collection, id } of created.reverse()) {
    const { status, body } = await session.request("DELETE", itemPath(collection, id));
    // Directus answers 403 for a row that's gone, as when a scenario deleted it, or a cascade did.
    if (status !== 204 && status !== 403) {
      failures.push(`${collection} ${id}: ${status} ${JSON.stringify(body)}`);
    }
  }
  return failures;
}
