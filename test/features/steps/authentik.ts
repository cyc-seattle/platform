import { devPlatform, secretValue } from "../support.ts";
import { localTarget } from "../target.ts";

// Authentik, the CI stack's or dev's, signed in with its bootstrap token, which only the tests and Pulumi's bootstrap
// provider use. The tests make the Authentik accounts a real sign-in would, and read the sign-in
// groups the group-policies hook fills.

let api: Promise<(route: string, method?: string, body?: unknown) => Promise<unknown>> | undefined;

function authentik() {
  api ??= (async () => {
    const { url, token } = await authentikAdmin();
    return async (route: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${url}${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        throw new Error(`Authentik answered ${method} ${route} with ${response.status}: ${await response.text()}`);
      }
      return response.status === 204 ? undefined : response.json();
    };
  })();
  return api;
}

/** Authentik's API and its bootstrap token. */
export async function authentikAdmin(): Promise<{ url: string; token: string }> {
  const local = localTarget()?.authentik;
  if (local) {
    return { url: `${local.url}/api/v3`, token: local.token };
  }
  const platform = await devPlatform();
  return {
    url: `https://login.${platform.domain}/api/v3`,
    token: await secretValue(platform, "authentik", "AUTHENTIK_BOOTSTRAP_TOKEN"),
  };
}

/** Every Authentik account this run made, so cleanup can delete them. */
const accounts: number[] = [];

/** An active Authentik account for `email`, as signing in for the first time makes. Returns its pk. */
export async function authentikAccount(email: string): Promise<number> {
  const request = await authentik();
  const { pk } = (await request("/core/users/", "POST", {
    username: email,
    name: email,
    email,
    is_active: true,
    type: "internal",
  })) as { pk: number };
  accounts.push(pk);
  return pk;
}

/** Deletes `email`'s Authentik account with the others, once a real sign-in has made it. */
export async function forgetAccount(email: string): Promise<void> {
  const request = await authentik();
  const { results } = (await request(`/core/users/?email=${encodeURIComponent(email)}`)) as {
    results: { pk: number }[];
  };
  accounts.push(...results.map(({ pk }) => pk));
}

async function signInGroup(name: string): Promise<{ pk: string; users: number[] }> {
  const request = await authentik();
  const { results } = (await request(`/core/groups/?name=${encodeURIComponent(name)}&include_users=false`)) as {
    results: { pk: string; name: string; users: number[] }[];
  };
  const group = results.find((result) => result.name === name);
  if (!group) {
    throw new Error(`Authentik has no ${name} group.`);
  }
  return group;
}

/** The pks of the Authentik accounts in the sign-in group `name`. */
export async function signInGroupMembers(name: string): Promise<number[]> {
  return (await signInGroup(name)).users;
}

/** Adds an account to the sign-in group `name` by hand, as an Authentik admin could. */
export async function addToSignInGroup(name: string, pk: number): Promise<void> {
  const request = await authentik();
  await request(`/core/groups/${(await signInGroup(name)).pk}/add_user/`, "POST", { pk });
}

/** Deletes every Authentik account this run made. Returns what it couldn't delete. */
export async function deleteAccounts(): Promise<string[]> {
  if (accounts.length === 0) {
    return [];
  }
  const request = await authentik();
  const failures: string[] = [];
  for (const pk of accounts.splice(0)) {
    await request(`/core/users/${pk}/`, "DELETE").catch((error: Error) => failures.push(`account ${pk}: ${error}`));
  }
  return failures;
}
