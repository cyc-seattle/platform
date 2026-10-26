import { randomBytes, randomUUID } from "node:crypto";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { devDirectusAdmin, DirectusSession } from "./directus.ts";
import { feature } from "./support.ts";

// Runs against the roles and policies isthmia's `crm` deployed to dev, so it checks what ships. Every
// row and user is this run's own, and is deleted afterwards.

type Row = Record<string, unknown>;
/** A row Directus returned, which always has its key. */
type Item = Row & { id: string };

const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
let serial = 0;
const key = (prefix: string) => `${prefix}-${runId}-${++serial}`;
// Directus checks a user's email against the real TLDs, so not `.test`.
const email = (name: string) => `${name}.${runId}-${++serial}@example.com`;
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const list = (names: string) => names.split(",").map((name) => name.trim());

/** Each feature login's Directus role, by the name `crm` gives it. */
const roleNames: Record<string, string> = {
  Staff: "Staff",
  Coach: "Coach",
  Guardian: "Guardian",
  "clubspot-sync": "Clubspot Sync",
  "gsuite-sync": "Gsuite Sync",
};

let admin: DirectusSession | undefined;
const sessions: Record<string, DirectusSession> = {};
const userIds: Record<string, string> = {};
/** Every row this run created, in order, so cleanup can delete them in reverse. */
const created: { collection: string; id: unknown }[] = [];
/** The run's row in each collection: the child's, where the row belongs to a person. */
const row: Record<string, string> = {};
/** Each of those rows as the admin created it, with every field. */
const fixture: Record<string, Row> = {};
let guardianPersonId: string;

async function adminCreate(collection: string, data: Row): Promise<Item> {
  if (admin === undefined) {
    throw new Error("The admin hasn't signed in.");
  }
  const item = await admin.ok("POST", `/items/${collection}`, data);
  created.push({ collection, id: item.id });
  return item;
}

/** Creates a fresh row as the admin, for a collection whose foreign key must be unique. */
async function fresh(collection: string): Promise<string> {
  return (await adminCreate(collection, await newRow(collection))).id;
}

/**
 * A valid new row for each collection, pointing at the run's rows. Every row gets a client-made id,
 * whatever its key type, so a create that ought to fail and didn't is still cleaned up.
 */
const builders: Record<string, (fixed: Row) => Promise<Row>> = {
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
  // participant, registration, or entry hangs off a fresh one, too, so the Guardian sees only the
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
const changes: Record<string, () => Row> = {
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
};

/** A new row for `collection`, with `fixed`'s fields in place of the builder's. */
async function newRow(collection: string, fixed: Row = {}): Promise<Row> {
  const build = builders[collection];
  if (!build) {
    throw new Error(`No builder for ${collection}.`);
  }
  return { ...(await build(fixed)), ...fixed };
}

function change(collection: string): Row {
  const make = changes[collection];
  if (!make) {
    throw new Error(`No change for ${collection}.`);
  }
  return make();
}

/** The value each field-scoped update sets: the one the run's row already has. */
const settable = (collection: string, field: string) => fixture[collection]?.[field];

async function createFixtures(): Promise<void> {
  admin = await devDirectusAdmin();

  for (const [login, roleName] of Object.entries(roleNames)) {
    const filter = encodeURIComponent(JSON.stringify({ name: { _eq: roleName } }));
    const [role] = await admin.ok("GET", `/roles?filter=${filter}&fields=id`);
    if (!role) {
      throw new Error(`Dev's Directus has no role named ${roleName}.`);
    }
    const signIn = email(login.toLowerCase());
    const password = `password-${randomBytes(12).toString("hex")}`;
    const user = await admin.ok("POST", "/users", {
      email: signIn,
      password,
      role: role.id,
      provider: "default",
      status: "active",
    });
    userIds[login] = user.id;
    sessions[login] = new DirectusSession(admin.baseUrl, signIn, password);
  }

  const guardian = await adminCreate(
    "people",
    await newRow("people", { first_name: "Gale", directus_user_id: userIds["Guardian"] }),
  );
  guardianPersonId = guardian.id;

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

  // Another family's child, in the same class, whom the Guardian must not see.
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

let fixtures: Promise<void> | undefined;

function as(login: string): DirectusSession {
  const session = sessions[login];
  if (!session) {
    throw new Error(`No feature login "${login}".`);
  }
  return session;
}

const itemPath = (collection: string, id: unknown) => `/items/${collection}/${encodeURIComponent(String(id))}`;

/** Reads the run's row, or any row where the run has none. */
function readQuery(collection: string, fields = "id"): string {
  const id = row[collection];
  const filter = id === undefined ? "" : `&filter=${encodeURIComponent(JSON.stringify({ id: { _eq: id } }))}`;
  return `/items/${collection}?fields=${encodeURIComponent(fields)}&limit=1${filter}`;
}

describeFeature(
  feature("directus-roles.feature"),
  ({ Background, AfterAllScenarios, defineSteps, Scenario, ScenarioOutline }) => {
    // What "lists" read, for "they see only their child's row".
    let listed: { collection: string; ids: unknown[] } | undefined;

    AfterAllScenarios(async () => {
      if (admin === undefined) {
        return;
      }
      const failures: string[] = [];
      for (const { collection, id } of created.reverse()) {
        const { status, body } = await admin.request("DELETE", itemPath(collection, id));
        // Directus answers 403 for a row that's gone, as when a scenario deleted it, or a cascade did.
        if (status !== 204 && status !== 403) {
          failures.push(`${collection} ${id}: ${status} ${JSON.stringify(body)}`);
        }
      }
      for (const id of Object.values(userIds)) {
        const { status, body } = await admin.request("DELETE", `/users/${id}`);
        if (status !== 204) {
          failures.push(`user ${id}: ${status} ${JSON.stringify(body)}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(`Couldn't clean up:\n${failures.join("\n")}`);
      }
    });

    defineSteps(({ Given, When, Then, And }) => {
      // Registered per keyword: vitest-cucumber 7.0.0 matches a keyword-free Step in a Scenario but
      // not in a Scenario Outline.
      const Step = (text: string, fn: Parameters<typeof Then>[1]) => {
        for (const define of [Given, When, Then, And]) {
          define(text, fn);
        }
      };

      Step("this run's users and rows on dev's Directus", async () => {
        fixtures ??= createFixtures();
        await fixtures;
      });

      Step("{string} reads {string}", async (_, login: string, collection: string) => {
        const { status, body } = await as(login).request("GET", readQuery(collection));
        expect(status, JSON.stringify(body)).toBe(200);
        if (row[collection] !== undefined) {
          expect(body.data.map((item: Row) => item["id"])).toEqual([row[collection]]);
        }
      });

      Step("{string} can't read {string}", async (_, login: string, collection: string) => {
        const { status, body } = await as(login).request("GET", readQuery(collection));
        expect(status, JSON.stringify(body)).toBe(403);
      });

      Step("{string} reads only {string} of {string}", async (_, login: string, fields: string, collection: string) => {
        const allowed = list(fields);
        const all = await as(login).request("GET", readQuery(collection, "*"));
        expect(all.status, JSON.stringify(all.body)).toBe(200);
        expect(Object.keys(all.body.data[0] ?? {}).sort()).toEqual([...allowed].sort());
        const others = Object.keys(fixture[collection] ?? {}).filter((field) => !allowed.includes(field));
        const denied = await as(login).request("GET", readQuery(collection, others.join(",")));
        expect(denied.status, JSON.stringify(denied.body)).toBe(403);
      });

      Step("{string} can't create {string}", async (_, login: string, collection: string) => {
        const data = await newRow(collection);
        const { status, body } = await as(login).request("POST", `/items/${collection}`, data);
        if (status < 300) {
          created.push({ collection, id: data["id"] });
        }
        expect(status, JSON.stringify(body)).toBe(403);
      });

      Step("{string} can't update {string}", async (_, login: string, collection: string) => {
        const { status, body } = await as(login).request(
          "PATCH",
          itemPath(collection, row[collection]),
          change(collection),
        );
        expect(status, JSON.stringify(body)).toBe(403);
      });

      Step("{string} can't delete {string}", async (_, login: string, collection: string) => {
        const { status, body } = await as(login).request("DELETE", itemPath(collection, row[collection]));
        expect(status, JSON.stringify(body)).toBe(403);
      });

      Step("{string} can delete {string}", async (_, login: string, collection: string) => {
        const item = await adminCreate(collection, await newRow(collection));
        const { status, body } = await as(login).request("DELETE", itemPath(collection, item.id));
        expect(status, JSON.stringify(body)).toBe(204);
      });

      Step("{string} can set {string} on {string}", async (_, login: string, field: string, collection: string) => {
        const { status, body } = await as(login).request("PATCH", itemPath(collection, row[collection]), {
          [field]: settable(collection, field),
        });
        expect(status, JSON.stringify(body)).toBe(200);
      });

      const createReadUpdate = async (login: string, collection: string): Promise<unknown> => {
        const session = as(login);
        const data = await newRow(collection);
        const id = data["id"];
        const create = await session.request("POST", `/items/${collection}`, data);
        if (create.status < 300) {
          created.push({ collection, id });
        }
        expect(create.status, `create: ${JSON.stringify(create.body)}`).toBe(200);
        const read = await session.request("GET", itemPath(collection, id));
        expect(read.status, `read: ${JSON.stringify(read.body)}`).toBe(200);
        const update = await session.request("PATCH", itemPath(collection, id), change(collection));
        expect(update.status, `update: ${JSON.stringify(update.body)}`).toBe(200);
        return id;
      };

      Step("{string} can create, read, and update {string}", async (_, login: string, collection: string) => {
        await createReadUpdate(login, collection);
      });

      Step("{string} can create, read, update, and delete {string}", async (_, login: string, collection: string) => {
        const id = await createReadUpdate(login, collection);
        const { status, body } = await as(login).request("DELETE", itemPath(collection, id));
        expect(status, `delete: ${JSON.stringify(body)}`).toBe(204);
      });

      Step("{string} lists {string}", async (_, login: string, collection: string) => {
        // Steps still run after a failed one, so don't leave the last scenario's list behind.
        listed = undefined;
        const { status, body } = await as(login).request("GET", `/items/${collection}?fields=id&limit=-1`);
        expect(status, JSON.stringify(body)).toBe(200);
        listed = { collection, ids: body.data.map((item: Row) => item["id"]) };
      });

      Step("they see only their child's row", () => {
        expect(listed, "nothing was listed").toBeDefined();
        expect(listed?.ids).toEqual([row[listed?.collection ?? ""]]);
      });
    });

    Background(() => {});

    for (const outline of [
      "Staff has full access to the CRM's own collections",
      "Staff reads Clubspot's collections, but Clubspot edits them",
      "A Coach reads rosters, and changes nothing",
      "A Coach reads nothing else",
      "A guardian reads their own child's records, and no one else's",
      "A guardian can't change their child's records",
      "A guardian reads nothing else",
      "clubspot-sync writes the collections it syncs",
      "clubspot-sync deletes only what a merge or a resync replaces",
      "clubspot-sync deletes nothing else it syncs",
      "clubspot-sync repoints a merged person on rows owned elsewhere",
      "gsuite-sync reads what it maps into Google Groups",
      "gsuite-sync reads only the fields it needs from participants and contact points",
      "gsuite-sync reads nothing else",
      "gsuite-sync writes its own queue, findings, groups, and memberships, but deletes none",
    ]) {
      ScenarioOutline(outline, () => {});
    }
    for (const scenario of [
      "Staff sets a class's program and matches a participant to a person",
      "Staff reads the promoted fields",
      "clubspot-sync can't read or create programs, which staff create",
      "clubspot-sync reads the promoted fields, which staff maintain",
      "gsuite-sync can't change people",
    ]) {
      Scenario(scenario, () => {});
    }
  },
);
