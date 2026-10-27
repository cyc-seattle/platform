import { randomBytes } from "node:crypto";
import { DirectusSession } from "../directus.ts";
import { admin, adminCreate, email, guardianPersonId, newRow } from "./rows.ts";

// The users a scenario signs in as. A feature login is made on first use, so a file makes only the
// ones its running scenarios name. A named person ("Pat") is one a scenario sets up itself.

/**
 * Each feature login's role today. Until step 8a builds the three roles and groups, a login signs in
 * on the role of today's that has the same access (cyc-seattle/workplace#6).
 */
const todaysRoles: Record<string, string> = {
  "CRM Writer": "Staff",
  Crew: "Coach",
  Community: "Community",
  Admin: "Administrator",
  "clubspot-sync": "Clubspot Sync",
  "gsuite-sync": "Gsuite Sync",
};

interface Login {
  userId?: string;
  personId?: string;
  session?: DirectusSession;
}

const logins: Record<string, Promise<Login>> = {};

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

async function createUser(name: string, role: string): Promise<{ userId: string; session: DirectusSession }> {
  const session = await admin();
  const signIn = email(name.toLowerCase().replace(/\W+/g, "-"));
  const password = `password-${randomBytes(12).toString("hex")}`;
  const user = await session.ok("POST", "/users", {
    email: signIn,
    password,
    role: await roleId(role),
    provider: "default",
    status: "active",
  });
  userIds.push(user.id);
  return { userId: user.id, session: new DirectusSession(session.baseUrl, signIn, password) };
}

async function featureLogin(name: string): Promise<Login> {
  const role = todaysRoles[name];
  if (role === undefined) {
    return notBuilt(name === "Engine" ? "11" : "8a");
  }
  const login = await createUser(name, role);
  if (name === "Community") {
    await (await admin()).ok("PATCH", `/items/people/${guardianPersonId}`, { directus_user_id: login.userId });
    return { ...login, personId: guardianPersonId };
  }
  return login;
}

async function login(name: string): Promise<Login> {
  logins[name] ??= featureLogin(name);
  return logins[name];
}

/** The session a scenario signs in with, as a feature login or a named person. */
export async function as(name: string): Promise<DirectusSession> {
  const { session } = await login(name);
  if (session === undefined) {
    throw new Error(`${name} has no login.`);
  }
  return session;
}

export async function userId(name: string): Promise<string> {
  const { userId } = await login(name);
  if (userId === undefined) {
    throw new Error(`${name} has no login.`);
  }
  return userId;
}

/** Sets up a named person, with a user on `role` unless `role` is undefined. */
export async function person(name: string, role: string | undefined, fields: Record<string, unknown> = {}) {
  logins[name] = (async () => {
    const user: Login = role === undefined ? {} : await createUser(name, role);
    const { id } = await adminCreate(
      "people",
      await newRow("people", { first_name: name, directus_user_id: user.userId ?? null, ...fields }),
    );
    return { ...user, personId: id };
  })();
  return logins[name];
}

/** The name of the role a user holds now. */
export async function roleOf(name: string): Promise<string | undefined> {
  const user = await (await admin()).ok("GET", `/users/${await userId(name)}?fields=role.name`);
  return user.role?.name;
}

export async function setRole(name: string, role: string): Promise<void> {
  await (await admin()).ok("PATCH", `/users/${await userId(name)}`, { role: await roleId(role) });
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
