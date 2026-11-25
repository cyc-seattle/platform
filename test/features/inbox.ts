import { setTimeout as sleep } from "node:timers/promises";
import { authentikAdmin } from "./steps/authentik.ts";
import { addToGroup, createUser, newGroup, personFor } from "./steps/logins.ts";

const FREESCOUT_AGENT = "FreeScout Agent";

// What the shared inbox's feature reaches: Authentik's API as its admin. The CI stack doesn't run
// FreeScout, so only who may sign in is tested.

async function authentik(method: string, path: string, body?: unknown): Promise<any> {
  const { url, token } = authentikAdmin();
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Authentik ${method} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

const authentikUsers: number[] = [];

/**
 * An Authentik user named for the run, as a first sign-in makes. One allowed to use the shared inbox
 * is in a group in Directus that gives the FreeScout Agent policy, and the group-policies hook puts
 * them in Authentik's group of that name.
 */
export async function newAuthentikUser(runId: string, allowed: boolean): Promise<number> {
  // Not example.test: Directus refuses a login whose email has a TLD it doesn't know.
  const email = `inbox-${runId}@example.com`;
  const user = await authentik("POST", "/core/users/", {
    username: `inbox-${runId}`,
    name: `Inbox test ${runId}`,
    email,
    is_active: true,
  });
  authentikUsers.push(user.pk);
  if (allowed) {
    const login = await createUser(email, "Crew");
    const { groupId } = await newGroup(FREESCOUT_AGENT);
    await addToGroup(groupId, await personFor(login));
    const name = encodeURIComponent(FREESCOUT_AGENT);
    await eventually(
      "the group-policies hook to let them in",
      async () => {
        const { results } = await authentik("GET", `/core/groups/?name=${name}&include_users=false`);
        return results[0]?.users.includes(user.pk) || undefined;
      },
      1,
    );
  }
  return user.pk;
}

/** Whether Authentik lets the user into the shared inbox's application. */
export async function canSignIn(userPk: number): Promise<boolean> {
  return (await authentik("GET", `/core/applications/inbox/check_access/?for_user=${userPk}`)).passing === true;
}

export async function deleteAuthentikUsers(): Promise<void> {
  for (const pk of authentikUsers.splice(0)) {
    await authentik("DELETE", `/core/users/${pk}/`);
  }
}

/** Waits for `find` to return something, up to `minutes`. */
export async function eventually<T>(what: string, find: () => Promise<T | undefined>, minutes = 5): Promise<T> {
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    const found = await find();
    if (found !== undefined) {
      return found;
    }
    await sleep(10_000);
  }
  throw new Error(`Gave up waiting ${minutes} minutes for ${what}.`);
}
