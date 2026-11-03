import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { ACTIVE_CAMP, PARENT_COORDINATOR } from "../../../stacks/backend/community-rules.ts";
import type { DirectusSession } from "../directus.ts";
import { expectRefusal, onEachScenario, parameter, setThey, Step, theirSession } from "./index.ts";
import { createUser, hasRole, type User } from "./logins.ts";
import { admin, adminCreate, email, key, runId } from "./rows.ts";
import { newCamp, newProgram, signUp, type Camp, type Program, type Season } from "./teams.ts";

// The season a family's scenario stands in: camps, rosters, sailors, and the people who sign in. Each
// scenario builds its own, so a Given says everything its Then depends on. A `Team` is a program's
// class in a Clubspot camp, and its offering. Under the old rules, the roster is the program's
// confirmed entries in camps running now. Under the new ones, a team is a program marked as one.

type Row = Record<string, unknown>;
type Team = Program;

const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
};
const ADULT = yearsAgo(40);
const CHILD = yearsAgo(12);

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
  camps: Partial<Record<Season, Camp>>;
  team?: Team;
  /** People by the label the steps call them: "the child", "the teammate", and so on. */
  people: Record<string, Person[]>;
  /** What the last read returned. */
  rows: Row[];
  /** The rows each search in a probe returned: the real value's, then, for a search, no one's. */
  probes: Row[][];
  baseline: Set<unknown>;
  statuses: number[];
  /** The person who signed in. */
  me?: Person;
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

async function camp(season: Season): Promise<Camp> {
  return (scene.camps[season] ??= await newCamp(season));
}

/** A program in a camp of `season`, which is a team if `team` is set. */
async function team(season: Season = "running", options: { team?: boolean } = {}): Promise<Team> {
  return newProgram(await camp(season), options);
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
  return { ...sailor, ...(await signUp(sailor.id, on, share)) };
}

/** A sailor's answer counts for them if they're an adult, and for their parents if not. */
async function sailor(
  name: string,
  on: Team,
  {
    share = null,
    dateOfBirth = CHILD,
    fields = {},
  }: { share?: boolean | null; dateOfBirth?: string | null; fields?: Row },
): Promise<Person> {
  const own = dateOfBirth === ADULT ? { share_contact: share } : {};
  const sailing = await register(await person(name, dateOfBirth, { ...own, ...fields }), on, share);
  const medical = await adminCreate("medical_profiles", { id: randomUUID(), person_id: sailing.id, allergies: "none" });
  return { ...sailing, medicalProfileId: medical.id };
}

async function guardianOf(
  child: Person,
  { dateOfBirth = ADULT, share = null }: { dateOfBirth?: string | null; share?: boolean | null } = {},
): Promise<Person> {
  const guardian = await person("guardian", dateOfBirth, { share_contact: share });
  await adminCreate("contacts", { subject_id: child.id, contact_id: guardian.id, relationship_type: "guardian" });
  child.guardian = guardian;
  return guardian;
}

/**
 * Gives `who` a user on `role`, matched to their person by email, and makes them "they". Links their
 * person to the login, as the group-policies hook would.
 */
async function signIn(who: Person, role = "Community", typed = who.email): Promise<Person> {
  who.user = await createUser(typed, role);
  if (who.id !== "") {
    await (await admin()).ok("PATCH", `/items/people/${who.id}`, { directus_user_id: who.user.userId });
  }
  scene.me = who;
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

async function aGuardian(role: string, on?: Team): Promise<Person> {
  if (on) scene.team = on;
  const child = call("the child", await sailor("child", await theTeam(), {}));
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

// The teammate is an adult wherever their age doesn't matter, so their own email is shareable.
Step("another sailor in the program", () => aTeammate({ share: true, dateOfBirth: ADULT }));
Step("a teammate who hasn't answered the sharing question, and their parent", async () => {
  const teammate = await aTeammate({ share: null, fields: { phone: phone() } });
  call("the teammate's parent", await guardianOf(teammate));
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
Step("a family member who is on race committee for a program", async () => {
  const role = await adminCreate("program_roles", { name: `Race committee ${key("role")}` });
  await aVolunteer(role.id, null);
  await aTeammate({ share: true, dateOfBirth: ADULT }, "the sailor");
});
for (const text of [
  "a sailor in the program who hasn't answered the sharing question, and their parent",
  "a sailor in a program who hasn't answered the sharing question, and their parent",
]) {
  Step(text, async () => {
    const sailing = await aTeammate({ share: null }, "the sailor");
    call("the sailor's parent", await guardianOf(sailing));
  });
}

// Teams. The group-policies hook makes a family Team once their child is on one.

async function aTeam(season: Season = "running"): Promise<Team> {
  return team(season, { team: true });
}

Step("a parent whose child is on a team", async () => {
  const parent = await aGuardian("Community", await aTeam());
  await hasRole(parent.user!.userId, "Team");
});
Step("a parent whose child's last time on a team ended 13 months ago", async () => {
  await aGuardian("Community", await aTeam("lapsed"));
});
Step("a sailor who is only on another team", async () => {
  call("the sailor", await sailor("sailor", await aTeam(), {}));
});
Step("a sailor who is only in a program that isn't a team", async () => {
  call("the sailor", await sailor("sailor", await team(), {}));
});
Step("a sailor whose last time on a team ended a month ago", async () => {
  call("the sailor", await sailor("sailor", await aTeam("ended"), {}));
});
Step("a sailor whose last time on a team ended 13 months ago", async () => {
  call("the sailor", await sailor("sailor", await aTeam("lapsed"), {}));
});
Step("an adult teammate who chose to share", () => aTeammate({ share: true, dateOfBirth: ADULT }));
Step("an adult teammate who chose not to share", () => aTeammate({ share: false, dateOfBirth: ADULT }));
Step("a teammate who is a child, and their parent, who chose to share", async () => {
  const teammate = await aTeammate({ share: true });
  call("the teammate's parent", await guardianOf(teammate, { share: true }));
});
Step(
  "a teammate who is a child, with an email and phone of their own, and their parent, who chose to share",
  async () => {
    // Their own answer is yes too, so only their age hides their email and phone.
    const teammate = await aTeammate({ share: true, fields: { phone: phone(), share_contact: true } });
    call("the teammate's parent", await guardianOf(teammate, { share: true }));
  },
);
Step("a teammate with no date of birth on file, and an email and phone of their own", async () => {
  await aTeammate({ share: true, dateOfBirth: null, fields: { phone: phone(), share_contact: true } });
});

// Whens: what they look at, or change.

// Every row, past Directus's default of 100: Crew and Team read rows other runs left on dev too.
async function read(session: DirectusSession, collection: string, query = "?limit=-1"): Promise<Row[]> {
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

// Then: what they see.

parameter("someone", ["the teammate", "the teammate's parent", "the sailor", "the sailor's parent", "the parent"]);

const rowOf = (who: Person) => scene.rows.find((row) => row["id"] === who.id);

Step("they see {someone}", (_, label: string) => {
  expect(ids(scene.rows)).toContain(the(label).id);
});
Step("they don't see {someone}", (_, label: string) => {
  expect(ids(scene.rows)).not.toContain(the(label).id);
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

Step("they see only themselves and their child", () => {
  expect(ids(scene.rows)).toEqual(new Set([the("the parent").id, the("the child").id]));
});
Step("they see no one", () => {
  expect(scene.rows).toEqual([]);
});
Step("they see their child's medical information", () => {
  expect(scene.rows.map((row) => row["person_id"])).toContain(the("the child").id);
});
for (const text of ["not the other sailor's", "not the teammate's"]) {
  Step(text, () => {
    expect(scene.rows.map((row) => row["person_id"])).not.toContain(the("the teammate").id);
  });
}
Step("they see their own medical information", () => {
  expect(scene.rows.map((row) => row["person_id"])).toContain(scene.me!.id);
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

/** Changes whether `who` shares their email and phone, as the signed-in user. */
const sharing = async (who: Person, value: boolean) =>
  (await (await theirSession()).request("PATCH", `/items/people/${who.id}`, { share_contact: value })).status;
const shares = async (who: Person) =>
  (await (await admin()).ok("GET", `/items/people/${who.id}?fields=share_contact`)).share_contact;

Step("they can't change whether they share", async () => {
  const sailing = the("the sailor");
  expect(await sharing(sailing, true)).toBe(403);
  expect(await shareContact(await asThe("the sailor"), sailing.registrationId, true)).toBeGreaterThanOrEqual(400);
});
Step("they can stop sharing and share again", async () => {
  for (const value of [false, true]) {
    expect(await sharing(scene.me!, value)).toBeLessThan(300);
    expect(await shares(scene.me!)).toBe(value);
  }
});
Step("they can't change whether the teammate's parent shares", async () => {
  const parent = the("the teammate's parent");
  expect(await sharing(parent, true)).toBe(403);
  expect(await shares(parent)).toBeNull();
});
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
Step("they can't see the teammate's sharing answer", async () => {
  const registration = scene.rows.find((row) => "share_contact" in row);
  expect(registration).toBeDefined();
  expect(registration?.["share_contact"]).toBeNull();
  expect(registration?.["camp_id"]).toBeNull();
  const person = await read(await theirSession(), "people", `?filter[id][_eq]=${the("the teammate").id}`);
  expect(person[0]?.["share_contact"] ?? null).toBeNull();
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

// They see themselves, who aren't in the program.
Step("they see no one in the program", async () => {
  const session = await theirSession();
  for (const collection of [
    "people",
    "contacts",
    "clubspot_registrations",
    "clubspot_registration_entries",
    "clubspot_participants",
    "registrations",
  ]) {
    const rows = await read(session, collection);
    expect(
      rows.filter((row) => row["id"] !== scene.me?.id),
      collection,
    ).toEqual([]);
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
});
