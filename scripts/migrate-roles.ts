// Moves $PULUMI_STACK's users onto the three roles of cyc-seattle/workplace#6 step 8a, after the
// deploy that builds them: Guardian users become Community, and Staff users join the Staff group,
// which gives CRM Writer and Medical Writer, then become Crew. Coaches are Crew already, since Coach
// was renamed. Admins stay Admin.
//
// A dry run unless given --apply. Safe to run again: each step checks what's already done. It never
// changes a user's role until their new access covers their old access. docs/access.md has the steps.
//
//   PULUMI_STACK=dev mise run migrate-roles [--apply]

import { GoogleAuth } from "google-auth-library";
import { outputsObject, parsePlatformOutputs, stateBucket } from "../src/outputs.ts";

const apply = process.argv.includes("--apply");
const environment = process.env["PULUMI_STACK"];
const project = process.env["GCP_PROJECT"];
if (!environment || !project) {
  throw new Error("Run under mise, with PULUMI_STACK set to dev or prod.");
}

const STAFF_GROUP = "Staff";
const STAFF_POLICIES = ["CRM Writer", "Medical Writer"];

const google = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function googleFetch(url: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${await google.getAccessToken()}` } });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Reads the admin's password from the Secret Directus reads it from, as the integration tests do.
async function directusAdmin(): Promise<{ baseUrl: string; email: string; password: string }> {
  const bucket = stateBucket(project!, environment!);
  const text = JSON.stringify(
    await googleFetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(outputsObject)}?alt=media`,
    ),
  );
  const platform = parsePlatformOutputs(text, `gs://${bucket}/${outputsObject}`);
  const kube = (path: string) => googleFetch(`https://${platform.clusterEndpoint}${path}`);
  const deployment = await kube(`/apis/apps/v1/namespaces/${platform.namespace}/deployments/directus`);
  const env: { name: string; value?: string }[] = deployment.spec.template.spec.containers[0].env;
  const email = env.find(({ name }) => name === "ADMIN_EMAIL")?.value;
  const secret = await kube(`/api/v1/namespaces/${platform.namespace}/secrets/directus`);
  const password = Buffer.from(secret.data.ADMIN_PASSWORD, "base64").toString("utf8");
  if (!email) throw new Error("Directus's Deployment sets no ADMIN_EMAIL.");
  return { baseUrl: `https://directus.${platform.domain}`, email, password };
}

const { baseUrl, email: adminEmail, password } = await directusAdmin();

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${await token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text).data : undefined;
}

const token = (async () => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  if (!response.ok) throw new Error(`The admin can't sign in: ${response.status}`);
  return ((await response.json()) as { data: { access_token: string } }).data.access_token;
})();

const query = (filter: unknown) => encodeURIComponent(JSON.stringify(filter));

interface DirectusUser {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  role: { id: string; name: string } | null;
}

async function users(): Promise<DirectusUser[]> {
  return call("GET", "/users?fields=id,email,first_name,last_name,role.id,role.name&limit=-1");
}

async function roles(): Promise<Map<string, string>> {
  const found: { id: string; name: string }[] = await call("GET", "/roles?fields=id,name&limit=-1");
  return new Map(found.map(({ id, name }) => [name, id]));
}

function census(all: DirectusUser[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const user of all) {
    const name = user.role?.name ?? "(no role)";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** A permission row, as a key that says what it allows. */
interface Grant {
  collection: string;
  action: string;
  filtered: boolean;
  fields: string[];
}

/** What a user can do: every rule of their role's policies and their own. */
async function grantsOf(userId: string): Promise<Grant[]> {
  const user = await call("GET", `/users/${userId}?fields=role,policies.policy`);
  const own = (user.policies ?? []).map((access: { policy: string }) => access.policy);
  const viaRole = user.role
    ? (await call("GET", `/access?filter=${query({ role: { _eq: user.role } })}&fields=policy&limit=-1`)).map(
        (access: { policy: string }) => access.policy,
      )
    : [];
  const policyIds = [...own, ...viaRole];
  if (policyIds.length === 0) return [];
  const rows = await call(
    "GET",
    `/permissions?filter=${query({ policy: { _in: policyIds } })}&fields=collection,action,permissions,fields&limit=-1`,
  );
  return rows.map(
    (row: { collection: string; action: string; permissions: object | null; fields: string[] | null }) => ({
      collection: row.collection,
      action: row.action,
      filtered: row.permissions !== null && Object.keys(row.permissions).length > 0,
      fields: row.fields ?? [],
    }),
  );
}

/** The grants in `before` that nothing in `after` covers as fully. */
function lost(before: Grant[], after: Grant[]): Grant[] {
  return before.filter(
    (old) =>
      !after.some(
        (now) =>
          now.collection === old.collection &&
          now.action === old.action &&
          (!now.filtered || old.filtered) &&
          (now.fields.includes("*") || old.fields.every((field) => now.fields.includes(field))),
      ),
  );
}

async function waitFor<T>(what: string, check: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = await check();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function ensure<T>(
  what: string,
  find: () => Promise<T | undefined>,
  create: () => Promise<T>,
): Promise<T | undefined> {
  const found = await find();
  if (found !== undefined) return found;
  console.log(`${apply ? "Creating" : "Would create"} ${what}.`);
  return apply ? create() : undefined;
}

const before = await users();
console.log(`${environment}: users by role before:`, census(before));

const roleIds = await roles();
const failures: string[] = [];

// Guardian had no login, but any user left on it would lose their role when the role is deleted.
const community = roleIds.get("Community");
for (const user of before.filter((each) => each.role?.name === "Guardian")) {
  console.log(`${apply ? "Moving" : "Would move"} a Guardian user to Community.`);
  if (apply && community) await call("PATCH", `/users/${user.id}`, { role: community });
}

const crew = roleIds.get("Crew");
const staffUsers = before.filter((each) => each.role?.name === "Staff");
if (!crew || roleIds.has("Coach")) {
  console.log("Crew isn't built yet: deploy step 8a first. Staff users stay as they are.");
} else if (staffUsers.length > 0) {
  const policies: { id: string; name: string }[] = await call(
    "GET",
    `/policies?filter=${query({ name: { _in: STAFF_POLICIES } })}&fields=id,name`,
  );
  if (policies.length !== STAFF_POLICIES.length) {
    throw new Error(`Expected the policies ${STAFF_POLICIES.join(" and ")}: deploy step 8a first.`);
  }

  const group = await ensure(
    `the ${STAFF_GROUP} group`,
    async () =>
      (await call("GET", `/items/groups?filter=${query({ name: { _eq: STAFF_GROUP } })}&fields=id`))[0]?.id as
        string | undefined,
    async () =>
      (
        await call("POST", "/items/groups", {
          name: STAFF_GROUP,
          description: "Today's staff, who had the Staff role before cyc-seattle/workplace#6 step 8a.",
        })
      ).id as string,
  );
  for (const policy of policies) {
    await ensure(
      `the ${STAFF_GROUP} group's ${policy.name} grant`,
      async () =>
        group === undefined
          ? undefined
          : (
              await call(
                "GET",
                `/items/group_policies?filter=${query({ group_id: { _eq: group }, policy_id: { _eq: policy.id } })}&fields=id`,
              )
            )[0]?.id,
      async () => call("POST", "/items/group_policies", { group_id: group, policy_id: policy.id }),
    );
  }

  for (const user of staffUsers) {
    try {
      // Their person: the one linked to their login, or else the one person with their email.
      let person = (
        await call("GET", `/items/people?filter=${query({ directus_user_id: { _eq: user.id } })}&fields=id`)
      )[0]?.id as string | undefined;
      if (person === undefined && user.email) {
        const matches: { id: string; directus_user_id: string | null }[] = await call(
          "GET",
          `/items/people?filter=${query({ email: { _icontains: user.email } })}&fields=id,email,directus_user_id&limit=-1`,
        ).then((rows) =>
          rows.filter((row: { email: string | null }) => row.email?.toLowerCase() === user.email!.toLowerCase()),
        );
        if (matches.length > 1) {
          throw new Error(
            `${matches.length} people share their email. Link one to their login by hand, then run again.`,
          );
        }
        const [match] = matches;
        if (match && match.directus_user_id !== null) {
          throw new Error("The person with their email is linked to another login. Fix it by hand, then run again.");
        }
        if (match) {
          console.log(`${apply ? "Linking" : "Would link"} a Staff user's person to their login.`);
          if (apply) await call("PATCH", `/items/people/${match.id}`, { directus_user_id: user.id });
          person = match.id;
        }
      }
      if (person === undefined) {
        console.log(`${apply ? "Adding" : "Would add"} a person for a Staff user who has none.`);
        if (apply) {
          person = (
            await call("POST", "/items/people", {
              first_name: user.first_name ?? user.email?.replace(/@.*/, "") ?? "Staff",
              last_name: user.last_name,
              email: user.email?.toLowerCase(),
              directus_user_id: user.id,
            })
          ).id as string;
        }
      }
      if (!apply || person === undefined || group === undefined) {
        console.log("Would add a Staff user to the Staff group, wait for its policies, and make them Crew.");
        continue;
      }

      const oldGrants = await grantsOf(user.id);
      const member = (
        await call(
          "GET",
          `/items/group_members?filter=${query({ group_id: { _eq: group }, person_id: { _eq: person } })}&fields=id`,
        )
      )[0];
      if (!member) await call("POST", "/items/group_members", { group_id: group, person_id: person });
      // The group-policies hook gives the Staff group's policies while they're still Staff.
      await waitFor("the Staff group's policies", async () => {
        const own = await call("GET", `/users/${user.id}?fields=policies.policy.name`);
        const names = (own.policies ?? []).map((access: { policy: { name: string } }) => access.policy.name);
        return STAFF_POLICIES.every((name) => names.includes(name)) ? true : undefined;
      });
      await call("PATCH", `/users/${user.id}`, { role: crew });
      const missing = lost(oldGrants, await grantsOf(user.id));
      if (missing.length > 0) {
        await call("PATCH", `/users/${user.id}`, { role: roleIds.get("Staff") });
        throw new Error(`Back on Staff: Crew would lose ${JSON.stringify(missing)}.`);
      }
      console.log("Moved a Staff user to Crew, with the Staff group's policies, and no access lost.");
    } catch (error) {
      failures.push((error as Error).message);
      console.error(`A Staff user wasn't moved: ${(error as Error).message}`);
    }
  }
}

const after = await users();
console.log(`${environment}: users by role after:`, census(after));
const others = after.filter(
  (user) =>
    !["Community", "Crew", "Admin", "Administrator", "Clubspot Sync", "Gsuite Sync"].includes(user.role?.name ?? ""),
);
console.log(`Users on any other role, or none: ${others.length}.`);
if (!apply) console.log("A dry run. Run again with --apply to make these changes.");
if (failures.length > 0) {
  process.exitCode = 1;
}
