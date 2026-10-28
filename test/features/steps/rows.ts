import { randomUUID } from "node:crypto";
import { newRunId } from "../cluster.ts";
import { devDirectusAdmin, type DirectusSession } from "../directus.ts";

// The rows every access feature works on: a program, a camp with one session and class, and a child
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
  programs: async () => ({ id: randomUUID(), name: `Program ${runId}` }),
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
};

/** A harmless change to an existing row of each collection. */
export const changes: Record<string, () => Row> = {
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
