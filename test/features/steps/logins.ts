import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { DirectusSession } from "../directus.ts";
import { admin, adminCreate, created, email, guardianPersonId, itemPath, key, runRows } from "./rows.ts";
import { onATeam } from "./teams.ts";

// The users a scenario signs in as. An actor's user is made the first time a scenario names it, and
// shared by every scenario in the file after that.

/** Who a Given makes "they": a user with a role and the policies a group gives, or a service account. */
export interface Actor {
  role?: string;
  policies?: string[];
  service?: string;
}

const services: Record<string, string> = {
  "the Clubspot sync": "Clubspot Sync",
  "the Google sync": "Gsuite Sync",
  "the website build": "Website Build",
};

export const policyNames = [
  "CRM Reader",
  "CRM Writer",
  "Medical Reader",
  "Medical Writer",
  "Catalog Reader",
  "Catalog Writer",
  "Crew Reader",
  "Crew Writer",
  "Plan Reader",
  "Plan Writer",
  "Plan Admin",
  "Link Writer",
  "Announcement Writer",
  "FreeScout Agent",
  "Listmonk Write",
  "Listmonk Send",
];
export const roleNames = ["Community", "Team", "Crew", "Staff", "Admin"];
export const serviceNames = Object.keys(services);

/** Every user this run created, so cleanup can delete them. */
export const userIds: string[] = [];

async function idByName(collection: "roles" | "policies", name: string): Promise<string> {
  const filter = encodeURIComponent(JSON.stringify({ name: { _eq: name } }));
  const [found] = await (await admin()).ok("GET", `/${collection}?filter=${filter}&fields=id`);
  if (!found) {
    throw new Error(`Directus has no ${collection === "roles" ? "role" : "policy"} named ${name}.`);
  }
  return found.id;
}

export const roleId = (name: string) => idByName("roles", name);
export const policyId = (name: string) => idByName("policies", name);

export interface User {
  userId: string;
  email: string;
  password: string;
  session: DirectusSession;
}

/**
 * A local-password user on a role, named or given by its id. `signIn` is the email as typed at
 * sign-in, which Directus stores in lowercase.
 */
export async function createUser(signIn: string, role: string | { id: string }): Promise<User> {
  const session = await admin();
  // The seed's users share one password, so a person can sign in as them.
  const password = process.env["SEED_PASSWORD"] ?? `password-${randomBytes(12).toString("hex")}`;
  // A password sign-in costs Directus a hash and a session row, so a user signs in with a static token,
  // unless the email is typed differently from how it's stored, which only a real sign-in can check.
  const token = signIn === signIn.toLowerCase() ? randomBytes(24).toString("hex") : undefined;
  const user = await session.ok("POST", "/users", {
    email: signIn.toLowerCase(),
    password,
    ...(token && { token }),
    role: typeof role === "string" ? await roleId(role) : role.id,
    provider: "default",
    status: "active",
  });
  userIds.push(user.id);
  return {
    userId: user.id,
    email: signIn.toLowerCase(),
    password,
    session: new DirectusSession(session.baseUrl, signIn, password, token),
  };
}

/** Waits for what a hook does after the request that set it off has answered. */
export async function eventually(check: () => Promise<void>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

/** The names of the policies linked to a user's own account, which groups give. */
export async function policiesOf(userId: string): Promise<string[]> {
  const user = await (await admin()).ok("GET", `/users/${userId}?fields=policies.policy.name`);
  return (user.policies ?? []).map((access: { policy: { name: string } }) => access.policy.name).sort();
}

/** Waits until the hook has given a user exactly `policies`. */
export async function hasPolicies(userId: string, policies: string[]): Promise<void> {
  await eventually(async () => expect(await policiesOf(userId)).toEqual([...new Set(policies)].sort()));
}

/** A person in the CRM, with their own email, and a login if they have one. */
export async function newPerson(fields: Record<string, unknown> = {}): Promise<string> {
  const person = await adminCreate("people", {
    id: randomUUID(),
    first_name: "Lee",
    last_name: `Test ${key("person")}`,
    email: email("lee"),
    ...fields,
  });
  return person.id;
}

/** Links a login to its person, as an admin does, or the group-policies hook does by email. */
export async function linkLogin(userId: string, personId: string): Promise<void> {
  await (await admin()).ok("PATCH", `/users/${userId}`, { person_id: personId });
}

/** A person in the CRM with the user's email, linked to their login. */
export async function personFor(user: Pick<User, "userId" | "email">, fields: Record<string, unknown> = {}) {
  const personId = await newPerson({ email: user.email, ...fields });
  await linkLogin(user.userId, personId);
  return personId;
}

/** The junction collection behind each of a group's many-to-many fields. */
const groupJunctions = { members: "group_members", policies: "group_policies" } as const;
type GroupField = keyof typeof groupJunctions;

/** Links a row to a group through the group itself, as the Data Studio's many-to-many list does. */
async function addThroughGroup(groupId: string, field: GroupField, link: Record<string, string>): Promise<string> {
  const id = randomUUID();
  await (
    await admin()
  ).ok("PATCH", itemPath("groups", groupId), {
    [field]: { create: [{ id, ...link }], update: [], delete: [] },
  });
  created.push({ collection: groupJunctions[field], id });
  return id;
}

/** Unlinks a row from a group through the group itself, as the Data Studio's many-to-many list does. */
export async function removeFromGroup(groupId: string, field: GroupField, id: string): Promise<void> {
  await (await admin()).ok("PATCH", itemPath("groups", groupId), { [field]: { create: [], update: [], delete: [id] } });
  const index = created.findIndex((row) => row.collection === groupJunctions[field] && row.id === id);
  if (index >= 0) created.splice(index, 1);
}

/** A group of this run's that gives `policies`. */
export async function newGroup(...policies: string[]): Promise<{ groupId: string; grantIds: string[] }> {
  const group = await adminCreate("groups", { id: randomUUID(), name: `Test group ${key("group")}` });
  const grantIds: string[] = [];
  for (const policy of policies) {
    grantIds.push(await addThroughGroup(group.id, "policies", { policy_id: await policyId(policy) }));
  }
  return { groupId: group.id, grantIds };
}

export async function addToGroup(groupId: string, personId: string): Promise<string> {
  return addThroughGroup(groupId, "members", { person_id: personId });
}

/** Gives a user each policy through a group of its own, and waits for the hook to link them. */
export async function joinGroups(user: User, personId: string, policies: string[]): Promise<void> {
  for (const policy of policies) {
    const { groupId } = await newGroup(policy);
    await addToGroup(groupId, personId);
  }
  await hasPolicies(user.userId, policies);
}

function actorRole({ role, service }: Actor): string {
  if (service !== undefined) {
    return services[service]!;
  }
  // Everyone's role on their first sign-in.
  return role ?? "Community";
}

const users: Record<string, Promise<User>> = {};

async function actorUser(actor: Actor): Promise<User> {
  const role = actorRole(actor);
  // The hook makes a family Team only while they're on a team, so a Team user starts as Community.
  const user = await createUser(
    // An email's local part is at most 64 characters; the run and a serial keep it unique.
    email(JSON.stringify(actor).replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(0, 32)),
    role === "Team" ? "Community" : role,
  );
  const policies = actor.policies ?? [];
  if (actor.service !== undefined) {
    return user;
  }
  if (role === "Community" && policies.length === 0) {
    // A family member, so the Community role's own-family rules have someone to match.
    await runRows();
    await (await admin()).ok("PATCH", `/items/people/${guardianPersonId}`, { email: user.email });
    await linkLogin(user.userId, guardianPersonId);
    return user;
  }
  if (role === "Team") {
    await onATeam(await personFor(user, { date_of_birth: "1980-01-01" }));
    await hasRole(user.userId, "Team");
  }
  if (policies.length > 0) {
    await joinGroups(user, await personFor(user), policies);
  }
  return user;
}

/** The actor's user, made on first use. */
export function userFor(actor: Actor): Promise<User> {
  const key = JSON.stringify(actor);
  users[key] ??= actorUser(actor);
  return users[key];
}

/** Makes the next scenario that names `actor` get a user of its own, for a scenario that changed this one's. */
export function forget(actor: Actor): void {
  delete users[JSON.stringify(actor)];
}

/** The name of the role a user holds now. */
export async function roleOf(userId: string): Promise<string | undefined> {
  const user = await (await admin()).ok("GET", `/users/${userId}?fields=role.name`);
  return user.role?.name;
}

/** Waits until the hook has given a user `role`. It runs after every change the tests make, so give it time. */
export async function hasRole(userId: string, role: string): Promise<void> {
  await eventually(async () => expect(await roleOf(userId)).toBe(role), 60_000);
}

export async function setRole(userId: string, role: string): Promise<void> {
  await (await admin()).ok("PATCH", `/users/${userId}`, { role: await roleId(role) });
}

/** Deletes every user this run created. Returns what it couldn't delete. */
export async function deleteUsers(): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }
  const session = await admin();
  const failures: string[] = [];
  for (const id of userIds) {
    const { status, body } = await session.request("DELETE", `/users/${id}`);
    if (status !== 204) {
      failures.push(`user ${id}: ${status} ${JSON.stringify(body)}`);
    }
  }
  return failures;
}
