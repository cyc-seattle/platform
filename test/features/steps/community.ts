import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { ACTIVE_CAMP, PARENT_COORDINATOR } from "../../../stacks/backend/community-rules.ts";
import type { DirectusSession } from "../directus.ts";
import { expectRefusal, onEachScenario, parameter, setThey, Step, theirSession } from "./index.ts";
import { createUser, type User } from "./logins.ts";
import { admin, adminCreate, email, key, newRow, runId } from "./rows.ts";

// The season a family's scenario stands in: camps, rosters, sailors, and the people who sign in. Each
// scenario builds its own, so a Given says everything its Then depends on. A `Team` is a program's
// class in a Clubspot camp, and the roster is the program's confirmed entries in camps running now.

type Row = Record<string, unknown>;

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
};
const ADULT = yearsAgo(40);
const CHILD = yearsAgo(12);

interface Camp {
  id: string;
  sessionId: string;
}

interface Team {
  camp: Camp;
  programId: string;
  classId: string;
}

interface Person {
  id: string;
  email: string;
  phone?: string;
  /** Their registration on the scenario's team, if they sail on it. */
  registrationId?: string;
  entryId?: string;
  participantId?: string;
  medicalProfileId?: string;
  guardian?: Person;
  user?: User;
}

interface Scene {
  camps: Partial<Record<"running" | "ended", Camp>>;
  team?: Team;
  /** People by the label the steps call them: "the child", "the teammate", and so on. */
  people: Record<string, Person[]>;
  /** What the last read returned. */
  rows: Row[];
  /** The rows each search in a probe returned: the real value's, then, for a search, no one's. */
  probes: Row[][];
  baseline: Set<unknown>;
  statuses: number[];
}

const newScene = (): Scene => ({
  camps: {},
  people: {},
  rows: [],
  probes: [],
  baseline: new Set(),
  statuses: [],
});
let scene = newScene();
onEachScenario(() => {
  scene = newScene();
});

function the(label: string): Person {
  const person = scene.people[label]?.at(-1);
  if (!person) {
    throw new Error(`This scenario has no ${label}.`);
  }
  return person;
}

function call(label: string, person: Person): Person {
  (scene.people[label] ??= []).push(person);
  return person;
}

async function camp(state: "running" | "ended"): Promise<Camp> {
  const existing = scene.camps[state];
  if (existing) {
    return existing;
  }
  const [start, end] = state === "running" ? [-7, 7] : [-60, -30];
  const { id } = await adminCreate("clubspot_camps", {
    id: key("camp"),
    name: `Camp ${runId}`,
    start_date: daysFromNow(start),
    end_date: daysFromNow(end),
  });
  const session = await adminCreate("clubspot_sessions", { id: key("session"), camp_id: id });
  return (scene.camps[state] = { id, sessionId: session.id });
}

async function team(state: "running" | "ended" = "running", programId?: string): Promise<Team> {
  const inCamp = await camp(state);
  const program =
    programId ?? (await adminCreate("programs", await newRow("programs", { name: `Program ${key("program")}` }))).id;
  const { id } = await adminCreate("clubspot_classes", {
    id: key("class"),
    name: `Class ${runId}`,
    camp_id: inCamp.id,
    program_id: program,
  });
  return { camp: inCamp, programId: program, classId: id };
}

/** The scenario's team, made on first use. */
async function theTeam(): Promise<Team> {
  return (scene.team ??= await team());
}

async function person(name: string, dateOfBirth: string | null, fields: Row = {}): Promise<Person> {
  const address = email(name);
  const { id } = await adminCreate("people", {
    first_name: name,
    last_name: `Test ${runId}`,
    email: address,
    date_of_birth: dateOfBirth,
    ...fields,
  });
  return { id, email: address, ...(typeof fields["phone"] === "string" && { phone: fields["phone"] }) };
}

/** Registers `sailor` for `on`, with their answer to the sharing question. */
async function register(sailor: Person, on: Team, share: boolean | null): Promise<Person> {
  const participant = await adminCreate("clubspot_participants", { id: key("participant"), person_id: sailor.id });
  const registration = await adminCreate("clubspot_registrations", {
    id: key("registration"),
    camp_id: on.camp.id,
    registered_at: new Date().toISOString(),
    status: "confirmed",
    participant_id: participant.id,
    share_contact: share,
  });
  const entry = await adminCreate("clubspot_registration_entries", {
    id: key("entry"),
    registration_id: registration.id,
    session_id: on.camp.sessionId,
    class_id: on.classId,
    status: "confirmed",
  });
  return { ...sailor, registrationId: registration.id, entryId: entry.id, participantId: participant.id };
}

async function sailor(
  name: string,
  on: Team,
  {
    share = null,
    dateOfBirth = CHILD,
    fields = {},
  }: { share?: boolean | null; dateOfBirth?: string | null; fields?: Row },
): Promise<Person> {
  const sailing = await register(await person(name, dateOfBirth, fields), on, share);
  const medical = await adminCreate("medical_profiles", { id: randomUUID(), person_id: sailing.id, allergies: "none" });
  return { ...sailing, medicalProfileId: medical.id };
}

async function guardianOf(child: Person, dateOfBirth: string | null = ADULT): Promise<Person> {
  const guardian = await person("guardian", dateOfBirth);
  await adminCreate("contacts", { subject_id: child.id, contact_id: guardian.id, relationship_type: "guardian" });
  child.guardian = guardian;
  return guardian;
}

/** Gives `who` a user on `role`, matched to their person by email, and makes them "they". */
async function signIn(who: Person, role = "Community", typed = who.email): Promise<Person> {
  who.user = await createUser(typed, role);
  actAs(who);
  return who;
}

function actAs(who: Person): void {
  setThey({
    session: async () => who.user!.session,
    userId: async () => who.user!.userId,
  });
}

async function asThe(label: string): Promise<DirectusSession> {
  const { user } = the(label);
  if (!user) {
    throw new Error(`The scenario's ${label} doesn't sign in.`);
  }
  return user.session;
}

async function aGuardian(
  role: string,
  { state = "running", share = null }: { state?: "running" | "ended"; share?: boolean | null } = {},
): Promise<Person> {
  const on = state === "running" ? await theTeam() : (scene.team = await team("ended"));
  const child = call("the child", await sailor("child", on, { share }));
  const guardian = call("the parent", await guardianOf(child));
  await signIn(guardian, role);
  return guardian;
}

async function aTeammate(
  options: { share?: boolean | null; dateOfBirth?: string | null; fields?: Row },
  label = "the teammate",
): Promise<Person> {
  return call(label, await sailor("teammate", await theTeam(), options));
}

// Givens: who signs in, and who sails with them.

Step("a parent whose child is signed up for a program", () => aGuardian("Community"));
Step("a parent whose child is signed up for a program and opted in to sharing", () =>
  aGuardian("Community", { share: true }),
);
Step("a parent whose child is signed up for a program and opted out of sharing", () =>
  aGuardian("Community", { share: false }),
);
Step("a parent in the CRM whose child is signed up for a program", async () => {
  const child = call("the child", await sailor("child", await theTeam(), {}));
  call("the parent", await guardianOf(child));
  await aTeammate({ share: true, dateOfBirth: ADULT });
});
Step("they sign in, typing their email in capitals", async () => {
  const guardian = the("the parent");
  await signIn(
    guardian,
    "Community",
    guardian.email.replace(/^[^@]+/, (local) => local.toUpperCase()),
  );
});
Step("a user with the Crew role whose child is signed up for a program", () => aGuardian("Crew"));
Step("a parent whose child's only program has ended", () => aGuardian("Community", { state: "ended" }));
Step("a parent whose child's only program has ended, with a teammate who opted in", async () => {
  await aGuardian("Community", { state: "ended" });
  await aTeammate({ share: true, dateOfBirth: ADULT });
});

// The teammate is an adult wherever their age doesn't matter, so their own email is shareable.
for (const text of ["an adult teammate who opted in to sharing", "a teammate who opted in to sharing"]) {
  Step(text, () => aTeammate({ share: true, dateOfBirth: ADULT }));
}
Step("a teammate who opted in to sharing but has no date of birth on file", () =>
  aTeammate({ share: true, dateOfBirth: null }),
);
Step("a teammate who hasn't answered the sharing question, and their parent", async () => {
  const teammate = await aTeammate({ share: null, fields: { phone: phone() } });
  call("the teammate's parent", await guardianOf(teammate));
});
Step("another parent in the program", async () => {
  const teammate = await aTeammate({ share: null });
  const guardian = call("the teammate's parent", await guardianOf(teammate));
  guardian.user = await createUser(guardian.email, "Community");
});
Step("a teammate who is a child and opted in to sharing, and their parent", async () => {
  const teammate = await aTeammate({ share: true, fields: { phone: phone() } });
  call("the teammate's parent", await guardianOf(teammate));
});
Step("a teammate who opted in for another program but not for this one, and their parent", async () => {
  const teammate = await aTeammate({ share: false });
  await register(teammate, await team(), true);
  call("the teammate's parent", await guardianOf(teammate));
});
Step("a sailor whose time in the program has ended", async () => {
  const { programId } = await theTeam();
  call("the sailor", await sailor("sailor", await team("ended", programId), { share: true, dateOfBirth: ADULT }));
});
let secondTeam: Team | undefined;
onEachScenario(() => {
  secondTeam = undefined;
});
Step("their child is also signed up for a second program", async () => {
  secondTeam = await team();
  await register(the("the child"), secondTeam, false);
});
Step("a sailor who is only in the second program", async () => {
  if (!secondTeam) {
    throw new Error("No Given has made the second team.");
  }
  call("the sailor", await sailor("sailor", secondTeam, { share: true }));
});

Step("an adult sailor signed up for a program", async () => {
  await signIn(call("the sailor", await sailor("adult", await theTeam(), { share: true, dateOfBirth: ADULT })));
});
Step("a sailor with no date of birth on file, signed up for a program", async () => {
  await signIn(call("the sailor", await sailor("adult", await theTeam(), { share: true, dateOfBirth: null })));
});
Step("a user with the Community role whose email isn't in the CRM", async () => {
  await signIn({ id: "", email: email("nobody") });
});

/** A phone number unique to the run, so a search on it can't match anyone else's. */
const phone = () => `+1206${String(randomInt(10_000_000)).padStart(7, "0")}`;

async function aVolunteer(role: string, endsOn: string | null): Promise<void> {
  const on = await theTeam();
  const volunteer = call("the volunteer", await person("volunteer", null));
  await adminCreate("program_role_assignments", {
    person_id: volunteer.id,
    program_id: on.programId,
    program_role_id: role,
    ends_on: endsOn,
  });
  await signIn(volunteer);
}

/** The Parent Coordinator role is matched by name, so every run shares one row of it. */
async function parentCoordinator(): Promise<string> {
  const filter = encodeURIComponent(JSON.stringify({ name: { _eq: PARENT_COORDINATOR } }));
  const [existing] = await (await admin()).ok("GET", `/items/program_roles?filter=${filter}&limit=1`);
  return existing?.id ?? (await (await admin()).ok("POST", "/items/program_roles", { name: PARENT_COORDINATOR })).id;
}

Step("a Parent Coordinator for a program", async () => aVolunteer(await parentCoordinator(), null));
Step("a Parent Coordinator for a program, whose program role ended three days ago", async () => {
  await aVolunteer(await parentCoordinator(), daysFromNow(-3));
  await aTeammate({ share: true, dateOfBirth: ADULT }, "the sailor");
});
Step("a family member who is on race committee for a program", async () => {
  const role = await adminCreate("program_roles", { name: `Race committee ${key("role")}` });
  await aVolunteer(role.id, null);
  await aTeammate({ share: true, dateOfBirth: ADULT }, "the sailor");
});
Step("a sailor in the program who hasn't answered the sharing question, and their parent", async () => {
  const sailing = await aTeammate({ share: null }, "the sailor");
  call("the sailor's parent", await guardianOf(sailing));
});
Step("a sailor in the program who is a child, with an email and phone of their own", () =>
  aTeammate({ share: null, fields: { phone: phone() } }, "the sailor"),
);
Step("a sailor in the program whose parent is under 18", async () => {
  const sailing = await aTeammate({ share: null }, "the sailor");
  call("the sailor's parent", await guardianOf(sailing, yearsAgo(16)));
});
Step("a sailor in another program running at the same time", async () => {
  await theTeam();
  call("the sailor", await sailor("sailor", await team(), { share: true, dateOfBirth: ADULT }));
});

// Whens: what they look at, or change.

async function read(session: DirectusSession, collection: string, query = ""): Promise<Row[]> {
  const { status, body } = await session.request("GET", `/items/${collection}${query}`);
  return status === 200 ? body.data : [];
}

const ids = (rows: Row[]) => new Set(rows.map((row) => row["id"]));

Step("they look at the roster", async () => {
  scene.rows = await read(await theirSession(), "people");
});
Step("they look up medical information", async () => {
  scene.rows = await read(await theirSession(), "medical_profiles");
});
Step("they look up who each sailor's parents are", async () => {
  scene.rows = await read(await theirSession(), "contacts");
});
Step("they look up who the teammate's parent is", async () => {
  scene.rows = await read(await theirSession(), "contacts", `?filter[subject_id][_eq]=${the("the teammate").id}`);
});
Step("they look up the teammate's registration", async () => {
  const session = await theirSession();
  const { participantId } = the("the teammate");
  scene.rows = [
    ...(await read(session, "clubspot_registrations", `?filter[participant_id][_eq]=${participantId}`)),
    ...(await read(session, "clubspot_participants", `?filter[id][_eq]=${participantId}`)),
  ];
});

const shareContact = async (session: DirectusSession, registrationId: string | undefined, value: boolean | null) =>
  (await session.request("PATCH", `/items/clubspot_registrations/${registrationId}`, { share_contact: value })).status;

for (const [text, value] of [
  ["the parent opts out for their child", false],
  ["the parent opts in for their child", true],
] as const) {
  Step(text, async () => {
    expect(await shareContact(await asThe("the parent"), the("the child").registrationId, value)).toBeLessThan(300);
  });
}

// Then: what they see.

parameter("someone", ["the teammate", "the teammate's parent", "the sailor", "the sailor's parent", "the parent"]);

const rowOf = (who: Person) => scene.rows.find((row) => row["id"] === who.id);

Step("they see {someone}", (_, label: string) => {
  expect(ids(scene.rows)).toContain(the(label).id);
});
Step("they don't see {someone}", (_, label: string) => {
  expect(ids(scene.rows)).not.toContain(the(label).id);
});
Step("they see both teammates", () => {
  const teammates = scene.people["the teammate"] ?? [];
  expect(teammates).toHaveLength(2);
  for (const teammate of teammates) {
    expect(ids(scene.rows)).toContain(teammate.id);
  }
});
Step("they see their child's roster", async () => {
  const seen = ids(await read(await theirSession(), "people"));
  for (const label of ["the child", "the teammate"]) {
    expect(seen, label).toContain(the(label).id);
  }
});
Step("they see {someone}'s email", (_, label: string) => {
  expect(rowOf(the(label))?.["email"]).toBe(the(label).email);
});
Step("they see {someone}'s name", (_, label: string) => {
  expect(rowOf(the(label))?.["first_name"]).toBeTruthy();
});

// Directus returns `email` and `phone` on every row once any policy grants them, and null on a row
// whose own filter doesn't match, so a hidden value and a missing row read the same.
function noContactDetails(...labels: string[]): void {
  for (const label of labels) {
    const row = rowOf(the(label));
    expect(row?.["email"], label).toBeFalsy();
    expect(row?.["phone"], label).toBeFalsy();
  }
}
Step("they don't see {someone}'s email or phone", (_, label: string) => noContactDetails(label));
Step("they don't see {someone}'s or their parent's email or phone", (_, label: string) =>
  noContactDetails(label, `${label}'s parent`),
);
Step("they see no email or phone for {someone}", (_, label: string) => noContactDetails(label));

Step("they see only themselves and their child", () => {
  expect(ids(scene.rows)).toEqual(new Set([the("the parent").id, the("the child").id]));
});
Step("they see no one", () => {
  expect(scene.rows).toEqual([]);
});
Step("they see their child's medical information", () => {
  expect(scene.rows.map((row) => row["person_id"])).toContain(the("the child").id);
});
Step("not the teammate's", () => {
  expect(scene.rows.map((row) => row["person_id"])).not.toContain(the("the teammate").id);
});

const link = (subject: Person, guardian: Person) => ({
  subject_id: subject.id,
  contact_id: guardian.id,
  relationship_type: "guardian",
});
Step("they see themselves listed as their child's parent", () => {
  expect(scene.rows).toContainEqual(link(the("the child"), the("the parent")));
});
Step("they see who {someone}'s parent is", (_, label: string) => {
  const subject = the(label);
  expect(scene.rows).toContainEqual(link(subject, subject.guardian!));
});

for (const [text, sees] of [
  ["the other parent sees the parent's email", true],
  ["the other parent no longer sees the parent's email", false],
] as const) {
  Step(text, async () => {
    const rows = await read(await asThe("the teammate's parent"), "people");
    const guardian = the("the parent");
    const shown = rows.find((row) => row["id"] === guardian.id)?.["email"];
    if (sees) {
      expect(shown).toBe(guardian.email);
    } else {
      expect(shown).toBeFalsy();
    }
  });
}

Step("they can opt out of sharing and back in", async () => {
  const session = await asThe("the sailor");
  const { registrationId } = the("the sailor");
  expect(await shareContact(session, registrationId, false)).toBeLessThan(300);
  expect(await shareContact(session, registrationId, true)).toBeLessThan(300);
});
for (const [text, label, session] of [
  ["they can't change whether they share", "the sailor", "the sailor"],
  ["they can't change whether the teammate shares", "the teammate", "the parent"],
  ["they can't change whether their child shares", "the child", "the parent"],
] as const) {
  Step(text, async () => {
    expect(await shareContact(await asThe(session), the(label).registrationId, true)).toBeGreaterThanOrEqual(400);
  });
}
// A sailor's program is their entry's class, and Clubspot's camp holds the class.
Step("they can't move their child to another program", async () => {
  const other = await team();
  const session = await asThe("the parent");
  const { registrationId, entryId } = the("the child");
  const moves = [
    await session.request("PATCH", `/items/clubspot_registration_entries/${entryId}`, { class_id: other.classId }),
    await session.request("PATCH", `/items/clubspot_registrations/${registrationId}`, {
      camp_id: (await camp("ended")).id,
    }),
  ];
  for (const { status } of moves) {
    expect(status).toBeGreaterThanOrEqual(400);
  }
});

// A registration that matches only the names policy comes back with family's fields as null, since
// the fields Directus returns span every read rule on the role.
Step("they can't see the teammate's sharing answer", () => {
  const registration = scene.rows.find((row) => "share_contact" in row);
  expect(registration).toBeDefined();
  expect(registration?.["share_contact"]).toBeNull();
  expect(registration?.["camp_id"]).toBeNull();
});
Step("they can't see the teammate's sign-up answers", () => {
  const participant = scene.rows.find((row) => row["id"] === the("the teammate").participantId);
  expect(Object.keys(participant ?? {}).sort()).toEqual(["id", "person_id"]);
});

Step("they can't see anyone's extra emails or phone numbers", async () => {
  const { status, body } = await (await theirSession()).request("GET", "/items/contact_points");
  if (status !== 403) {
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  }
});

Step("they can't change their child's details", async () => {
  const { status } = await (
    await theirSession()
  ).request("PATCH", `/items/people/${the("the child").id}`, { last_name: "Changed" });
  expect(status).toBe(403);
});
Step("they can't change their child's medical information", async () => {
  const { status } = await (
    await theirSession()
  ).request("PATCH", `/items/medical_profiles/${the("the child").medicalProfileId}`, { medications: "none" });
  expect(status).toBe(403);
});

// Searches on a detail hidden from the viewer (cyc-seattle/isthmia#175). Each pairs the real value
// with one no one has: if the two answers differ, or either finds someone the viewer couldn't
// already see, the search leaks the detail.
const searches: Record<string, () => [string, string, string]> = {
  "the teammate's email": () => ["filter[email][_eq]", the("the teammate").email, email("nobody")],
  "the first letters of the teammate's email": () => [
    "filter[email][_starts_with]",
    the("the teammate").email.split("@")[0]!,
    `nobody.${runId}`,
  ],
  "the teammate's phone": () => ["filter[phone][_eq]", the("the teammate").phone!, "+19999999999"],
  "any part of the teammate's email": () => ["search", the("the teammate").email, email("nobody")],
  "the teammate's parent's email": () => [
    "filter[my_contacts][contact_id][email][_eq]",
    the("the teammate's parent").email,
    email("nobody"),
  ],
};
parameter("search", Object.keys(searches));

Step("they search people for {search}", async (_, search: string) => {
  const session = await theirSession();
  const [query, real, nobody] = searches[search]!();
  scene.baseline = ids(await read(session, "people"));
  scene.probes = [];
  for (const value of [real, nobody]) {
    const result = await session.request("GET", `/items/people?${query}=${encodeURIComponent(value)}`);
    // Refusing the search outright leaks nothing either.
    expect([200, 403], `${query}=${value}`).toContain(result.status);
    scene.probes.push(result.status === 200 ? result.body.data : []);
  }
});
Step("they ask for everyone with a phone number on file", async () => {
  const result = await (await theirSession()).request("GET", "/items/people?filter[phone][_nnull]=true");
  expect([200, 403]).toContain(result.status);
  scene.probes = [result.status === 200 ? result.body.data : []];
});
Step("they don't find the teammate", () => {
  for (const probe of scene.probes) {
    expect(ids(probe)).not.toContain(the("the teammate").id);
  }
  if (scene.probes.length === 2) {
    const [real, nobody] = scene.probes as [Row[], Row[]];
    expect(ids(real)).toEqual(ids(nobody));
    for (const id of ids(real)) {
      expect(scene.baseline).toContain(id);
    }
  }
});

// Directus sorts, groups, and aggregates on the raw column, so the query guard refuses them outright.
const revealing = ["sort=email", "groupBy[]=email&aggregate[count]=id", "aggregate[countDistinct]=phone"];

Step("they ask for a list that would reveal hidden emails or phone numbers", async () => {
  const session = await theirSession();
  const statuses: Record<string, number> = {};
  for (const query of revealing) {
    statuses[query] = (await session.request("GET", `/items/people?${query}`)).status;
  }
  expectRefusal(() => expect(statuses).toEqual(Object.fromEntries(revealing.map((query) => [query, 403]))));
});

Step("they can't see the details of the program's registrations", async () => {
  const rows = await read(await theirSession(), "clubspot_registrations");
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row["camp_id"]).toBeNull();
  }
});
Step("they see no one in the program", async () => {
  const session = await theirSession();
  for (const collection of [
    "people",
    "contacts",
    "clubspot_registrations",
    "clubspot_registration_entries",
    "clubspot_participants",
  ]) {
    expect(await read(session, collection), collection).toEqual([]);
  }
});

/** The roster page's requests (isthmia's packages/portal/src/roster/browser.ts), copied by hand. */
const rosterRequests: { collection: string; fields: string[]; filter?: Row }[] = [
  {
    collection: "clubspot_registration_entries",
    fields: [
      "id",
      "class_id.id",
      "class_id.name",
      "class_id.program_id.id",
      "class_id.program_id.name",
      "registration_id.id",
      "registration_id.participant_id.person_id",
    ],
    filter: { class_id: { camp_id: ACTIVE_CAMP } },
  },
  { collection: "people", fields: ["id", "first_name", "last_name", "school", "email", "phone"] },
  { collection: "contacts", fields: ["subject_id", "contact_id", "relationship_type"] },
  // Community sends no filter.
  { collection: "clubspot_registrations", fields: ["id", "camp_id", "participant_id", "share_contact"] },
  { collection: "clubspot_participants", fields: ["id", "person_id"] },
];

let rosterPermissions: { registrations?: { read?: { access?: string } } } = {};

Step("they open the roster page", async () => {
  const session = await theirSession();
  scene.statuses = [];
  for (const request of rosterRequests) {
    const params = new URLSearchParams({ limit: "-1", fields: request.fields.join(",") });
    if (request.filter) {
      params.set("filter", JSON.stringify(request.filter));
    }
    const { status, body } = await session.request("GET", `/items/${request.collection}?${params.toString()}`);
    scene.statuses.push(status);
    if (request.collection === "clubspot_registration_entries" && status === 200) {
      scene.rows = body.data;
    }
  }
  const permissions = await session.request("GET", "/permissions/me");
  scene.statuses.push(permissions.status);
  rosterPermissions = permissions.body?.data ?? {};
});
// The portal shows a family's view when Directus reports its registrations read as partial.
Step("the page loads without errors and shows their child's roster", () => {
  expect(scene.statuses).toEqual(scene.statuses.map(() => 200));
  expect(rosterPermissions.registrations?.read?.access).toBe("partial");
  const sailors = scene.rows.map(
    (entry) =>
      (entry["registration_id"] as { participant_id?: { person_id?: string } } | null)?.participant_id?.person_id,
  );
  expect(sailors).toContain(the("the child").id);
});
