import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { DirectusSession } from "../directus.ts";
import { admin, adminCreate, created, email, guardianPersonId, itemPath, key, runRows } from "./rows.ts";

// The users a scenario signs in as. An actor's user is made the first time a scenario names it, and
// shared by every scenario in the file after that.

/** Who a Given makes "they": a user with a role and the policies a group gives, or a service account. */
export interface Actor {
  role?: string;
  policies?: string[];
  service?: string;
}

/** The cyc-seattle/workplace#6 step that builds each policy a later step builds. */
const laterPolicies: Record<string, string> = {
  "Plan Reader": "11",
  "Plan Writer": "11",
};

const services: Record<string, string> = {
  "the Clubspot sync": "Clubspot Sync",
  "the Google sync": "Gsuite Sync",
};

export const policyNames = [
  "CRM Reader",
  "CRM Writer",
  "Medical Reader",
  "Medical Writer",
  "Catalog Reader",
  "Catalog Writer",
  ...Object.keys(laterPolicies),
];
export const roleNames = ["Community", "Crew", "Admin"];
export const serviceNames = Object.keys(services);

/** Every user this run created, so cleanup can delete them. */
export const userIds: string[] = [];

/** Throws for a step that a later step of cyc-seattle/workplace#6 builds. */
export function notBuilt(step: string): never {
  throw new Error(`Not built yet: cyc-seattle/workplace#6 step ${step} builds this step.`);
}

async function idByName(collection: "roles" | "policies", name: string): Promise<string> {
  const filter = encodeURIComponent(JSON.stringify({ name: { _eq: name } }));
  const [found] = await (await admin()).ok("GET", `/${collection}?filter=${filter}&fields=id`);
  if (!found) {
    throw new Error(`Dev's Directus has no ${collection === "roles" ? "role" : "policy"} named ${name}.`);
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
  const password = `password-${randomBytes(12).toString("hex")}`;
  const user = await session.ok("POST", "/users", {
    email: signIn.toLowerCase(),
    password,
    role: typeof role === "string" ? await roleId(role) : role.id,
    provider: "default",
    status: "active",
  });
  userIds.push(user.id);
  return {
    userId: user.id,
    email: signIn.toLowerCase(),
    password,
    session: new DirectusSession(session.baseUrl, signIn, password),
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

/** A group of this run's that gives `policies`. */
export async function newGroup(...policies: string[]): Promise<{ groupId: string; grantIds: string[] }> {
  const group = await adminCreate("groups", { id: randomUUID(), name: `Test group ${key("group")}` });
  const grantIds: string[] = [];
  for (const policy of policies) {
    const grant = await adminCreate("group_policies", {
      id: randomUUID(),
      group_id: group.id,
      policy_id: await policyId(policy),
    });
    grantIds.push(grant.id);
  }
  return { groupId: group.id, grantIds };
}

export async function addToGroup(groupId: string, personId: string): Promise<string> {
  return (await adminCreate("group_members", { id: randomUUID(), group_id: groupId, person_id: personId })).id;
}

/** Deletes a row a scenario made, as an admin would in the Data Studio. */
export async function adminDelete(collection: string, id: string): Promise<void> {
  await (await admin()).ok("DELETE", itemPath(collection, id));
  const index = created.findIndex((row) => row.collection === collection && row.id === id);
  if (index >= 0) created.splice(index, 1);
}

/** Gives a user each policy through a group of its own, and waits for the hook to link them. */
export async function joinGroups(user: User, personId: string, policies: string[]): Promise<void> {
  for (const policy of policies) {
    const { groupId } = await newGroup(policy);
    await addToGroup(groupId, personId);
  }
  await hasPolicies(user.userId, policies);
}

function actorRole({ role, policies = [], service }: Actor): string {
  if (service !== undefined) {
    return services[service]!;
  }
  for (const policy of policies) {
    const step = laterPolicies[policy];
    if (step !== undefined) notBuilt(step);
  }
  // Everyone's role on their first sign-in.
  return role ?? "Community";
}

const users: Record<string, Promise<User>> = {};

async function actorUser(actor: Actor): Promise<User> {
  const role = actorRole(actor);
  const user = await createUser(email(JSON.stringify(actor).replace(/\W+/g, "-")), role);
  const policies = actor.policies ?? [];
  if (actor.service !== undefined) {
    return user;
  }
  if (role === "Community" && policies.length === 0) {
    // A family member, so the Community role's own-family rules have someone to match.
    await runRows();
    await (
      await admin()
    ).ok("PATCH", `/items/people/${guardianPersonId}`, {
      email: user.email,
      directus_user_id: user.userId,
    });
    return user;
  }
  if (policies.length > 0) {
    await joinGroups(user, await newPerson({ email: user.email, directus_user_id: user.userId }), policies);
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
