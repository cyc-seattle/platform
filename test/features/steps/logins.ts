import { randomBytes } from "node:crypto";
import { DirectusSession } from "../directus.ts";
import { admin, adminCreate, email, guardianPersonId, newRow, runRows } from "./rows.ts";

// The users a scenario signs in as. An actor's user is made the first time a scenario names it, and
// shared by every scenario in the file after that.

/** Who a Given makes "they": a user with a role and the policies a group grants, or a service account. */
export interface Actor {
  role?: string;
  policies?: string[];
  service?: string;
}

/**
 * The role of today's that has each role's access, until step 8a of cyc-seattle/workplace#6 builds
 * Crew and Admin. Crew keeps Coach's rules.
 */
const todaysRoles: Record<string, string> = { Community: "Community", Crew: "Coach", Admin: "Administrator" };

/** A policy's role of today's, for a user who holds only that policy. Staff is CRM Writer's. */
const todaysPolicies: Record<string, string> = { "CRM Writer": "Staff" };

/** The cyc-seattle/workplace#6 step that builds each policy. */
const policySteps: Record<string, string> = {
  "CRM Reader": "8a",
  "CRM Writer": "8a",
  "Medical Reader": "8a",
  "Medical Writer": "8a",
  "Catalog Reader": "9",
  "Catalog Writer": "9",
  "Plan Reader": "11",
  "Plan Writer": "11",
};

const services: Record<string, string> = {
  "clubspot-sync": "Clubspot Sync",
  "gsuite-sync": "Gsuite Sync",
};

/** The name of today's role with a role's access. */
export const todaysRoleName = (role: string) => todaysRoles[role] ?? role;

export const policyNames = Object.keys(policySteps);
export const roleNames = Object.keys(todaysRoles);
export const serviceNames = Object.keys(services);

/** Every user this run created, so cleanup can delete them. */
export const userIds: string[] = [];

/** Throws for a step that a later step of cyc-seattle/workplace#6 builds. */
export function notBuilt(step: string): never {
  throw new Error(`Not built yet: cyc-seattle/workplace#6 step ${step} builds this step.`);
}

export async function roleId(name: string): Promise<string> {
  const filter = encodeURIComponent(JSON.stringify({ name: { _eq: name } }));
  const [role] = await (await admin()).ok("GET", `/roles?filter=${filter}&fields=id`);
  if (!role) {
    throw new Error(`Dev's Directus has no role named ${name}.`);
  }
  return role.id;
}

export interface User {
  userId: string;
  email: string;
  session: DirectusSession;
}

/**
 * A local-password user on a role of today's. `signIn` is the email as typed at sign-in, which
 * Directus stores in lowercase.
 */
export async function createUser(signIn: string, role: string): Promise<User> {
  const session = await admin();
  const password = `password-${randomBytes(12).toString("hex")}`;
  const user = await session.ok("POST", "/users", {
    email: signIn.toLowerCase(),
    password,
    role: await roleId(role),
    provider: "default",
    status: "active",
  });
  userIds.push(user.id);
  return {
    userId: user.id,
    email: signIn.toLowerCase(),
    session: new DirectusSession(session.baseUrl, signIn, password),
  };
}

/** Today's role for an actor, or the step that builds it. */
function todaysRole({ role, policies = [], service }: Actor): string {
  if (service !== undefined) {
    return services[service]!;
  }
  if (role !== undefined && policies.length === 0) {
    return todaysRoles[role]!;
  }
  const [policy, ...others] = policies;
  if (role === undefined && policy !== undefined && others.length === 0) {
    return todaysPolicies[policy] ?? notBuilt(policySteps[policy]!);
  }
  // A role and a policy together need groups.
  return notBuilt("8a");
}

const users: Record<string, Promise<User>> = {};

async function actorUser(actor: Actor): Promise<User> {
  const user = await createUser(email(JSON.stringify(actor).replace(/\W+/g, "-")), todaysRole(actor));
  if (actor.role === "Community") {
    // A family member, so the Community role's own-family rules have someone to match.
    await runRows();
    await (
      await admin()
    ).ok("PATCH", `/items/people/${guardianPersonId}`, {
      email: user.email,
      directus_user_id: user.userId,
    });
  }
  return user;
}

/** The actor's user, made on first use. */
export function userFor(actor: Actor): Promise<User> {
  const key = JSON.stringify(actor);
  users[key] ??= actorUser(actor);
  return users[key];
}

/** A person in the CRM with a user of their own, on a role of today's. */
export async function personWithUser(
  fields: Record<string, unknown>,
  role: string,
): Promise<User & { personId: string }> {
  const signIn = email(String(fields["first_name"] ?? "person").toLowerCase());
  const { id } = await adminCreate("people", await newRow("people", { ...fields, email: signIn }));
  return { ...(await createUser(signIn, todaysRoleName(role))), personId: id };
}

/** The name of the role a user holds now. */
export async function roleOf(userId: string): Promise<string | undefined> {
  const user = await (await admin()).ok("GET", `/users/${userId}?fields=role.name`);
  return user.role?.name;
}

export async function setRole(userId: string, role: string): Promise<void> {
  await (await admin()).ok("PATCH", `/users/${userId}`, { role: await roleId(todaysRoleName(role)) });
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
