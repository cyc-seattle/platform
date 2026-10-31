import * as pulumi from "@pulumi/pulumi";
import {
  waitForReachable,
  login,
  directusRequest,
  applySchema,
  ensurePermission,
  reconcilePermission,
  deletePermission,
  type PermissionAction,
  type PermissionRuleInput,
  upsertUserByEmail,
  reconcileUser,
  isNotFound,
  isForbidden,
  describeProviderError,
  waitForSavedVersions,
} from "./client.ts";

// --- Shared plumbing for the dynamic resources below: all of them talk to Directus's own REST
// API rather than GCP's, authenticating as the bootstrap admin (via client.ts, kept
// pulumi-free so it's unit testable). This is the first place Pulumi authenticates to an
// application's own API rather than just GCP's — worth reading closely before extending it.

// Resolved (plain-value) auth props, as a dynamic provider's create/update/delete actually receive
// them — Pulumi resolves every Input<T> to a plain T before invoking the provider.
interface DirectusAuthProps {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
}

// Wraps a provider method (create/update/delete/diff) so whatever it throws reaches Pulumi's CLI
// as a plain Error with a message - see `describeProviderError`'s doc comment for why that isn't
// automatic. Applied at each method itself, outside any internal error handling (e.g. `DirectusUser
// .update`'s `instanceof DirectusHttpError` check), so that logic still sees the original error.
function reportErrors<Args extends unknown[], R>(
  resource: string,
  method: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw describeProviderError(resource, method, error);
    }
  };
}

// Every Directus* dynamic resource below builds its outs as `{ ...news }`, so a secret input
// (adminPassword, and DirectusUser's token) would otherwise come back out as a plain output even
// though Pulumi masks the input itself. Merges rather than replaces the caller's own opts, so a
// caller's dependsOn/parent survive.
function withSecretOutputs(keys: string[], opts?: pulumi.CustomResourceOptions): pulumi.CustomResourceOptions {
  return { ...opts, additionalSecretOutputs: [...(opts?.additionalSecretOutputs ?? []), ...keys] };
}

// The Input<T>-wrapped equivalent, for the public *Args interfaces resource constructors take.
interface DirectusAuthArgs {
  /** e.g. `https://directus.<internalDomain>` — no trailing slash. */
  baseUrl: pulumi.Input<string>;
  adminEmail: pulumi.Input<string>;
  /** An admin's actual password (read at apply time — see the caller for why that's a deliberate,
   * narrow exception to "Pulumi never touches secret values"). */
  adminPassword: pulumi.Input<string>;
}

// --- DirectusSchema: applies a schema snapshot (collections/fields/relations) via Directus's own
// /schema/diff + /schema/apply REST endpoints — not the `directus schema apply` CLI. Going through
// the running server's own API instead of a separate CLI process also sidesteps a real gotcha the
// CLI path has: the server's in-memory schema cache doesn't otherwise notice the change until it
// restarts. Confirmed hands-on: immediately after an API-driven apply, requests against the new
// collections succeed with no restart.

interface DirectusSchemaInputs extends DirectusAuthProps {
  /** The parsed schema snapshot (e.g. `yaml.load(readFileSync(schema.yaml))`), not a file path —
   * Pulumi needs the content itself to know when it's changed. */
  schema: unknown;
}

export const directusSchemaProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusSchema", "create", async (inputs: DirectusSchemaInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);
    await applySchema(inputs.baseUrl, token, inputs.schema);
    return { id: "schema", outs: inputs };
  }),

  update: reportErrors(
    "DirectusSchema",
    "update",
    async (_id: string, _olds: DirectusSchemaInputs, news: DirectusSchemaInputs) => {
      await waitForReachable(news.baseUrl);
      const token = await login(news.baseUrl, news.adminEmail, news.adminPassword);
      await applySchema(news.baseUrl, token, news.schema);
      return { outs: news };
    },
  ),

  // Deliberately a no-op: destroying this resource must not drop the app's collections (and data).
  delete: reportErrors("DirectusSchema", "delete", async () => {}),
};

export interface DirectusSchemaArgs extends DirectusAuthArgs {
  schema: pulumi.Input<unknown>;
}

/** Applies a Directus schema snapshot via the REST API. One of these per Directus-backed app. */
export class DirectusSchema extends pulumi.dynamic.Resource {
  constructor(name: string, args: DirectusSchemaArgs, opts?: pulumi.CustomResourceOptions) {
    super(directusSchemaProvider, name, { ...args }, withSecretOutputs(["adminPassword"], opts));
  }
}

// --- SavedVersionsCheck: fails the deploy unless the saved-versions hook reports every planning
// table's trigger in place (docs/planning-schema.md). Its inputs change with the schema and the
// triggers, the only times an install can fail, so an unchanged stack shows no change.

interface SavedVersionsCheckInputs extends DirectusAuthProps {
  /** The triggers' fingerprint, from ./saved-versions.cjs. */
  fingerprint: string;
  /** A hash of the schema the check follows. */
  schemaHash: string;
  timeoutMs?: number;
  intervalMs?: number;
}

async function checkSavedVersions(inputs: SavedVersionsCheckInputs): Promise<void> {
  await waitForReachable(inputs.baseUrl);
  const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);
  await waitForSavedVersions(inputs.baseUrl, token, inputs.fingerprint, {
    ...(inputs.timeoutMs !== undefined && { timeoutMs: inputs.timeoutMs }),
    ...(inputs.intervalMs !== undefined && { intervalMs: inputs.intervalMs }),
  });
}

export const savedVersionsCheckProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("SavedVersionsCheck", "create", async (inputs: SavedVersionsCheckInputs) => {
    await checkSavedVersions(inputs);
    return { id: "saved-versions", outs: inputs };
  }),

  update: reportErrors(
    "SavedVersionsCheck",
    "update",
    async (_id: string, _olds: SavedVersionsCheckInputs, news: SavedVersionsCheckInputs) => {
      await checkSavedVersions(news);
      return { outs: news };
    },
  ),

  delete: reportErrors("SavedVersionsCheck", "delete", async () => {}),
};

export interface SavedVersionsCheckArgs extends DirectusAuthArgs {
  fingerprint: pulumi.Input<string>;
  schemaHash: pulumi.Input<string>;
}

/** Checks that the saved-versions hook's triggers are in place, after the schema it follows applies. */
export class SavedVersionsCheck extends pulumi.dynamic.Resource {
  constructor(name: string, args: SavedVersionsCheckArgs, opts?: pulumi.CustomResourceOptions) {
    super(savedVersionsCheckProvider, name, { ...args }, withSecretOutputs(["adminPassword"], opts));
  }
}

// --- DirectusRole: manages a Directus role + its policy as one unit. Reusable across any
// Directus-backed app; app-specific instances (Staff/Coach/Guardian, say) live in
// ./roles.ts. Permission rules attach to the policy but are declared
// separately, as their own `DirectusPermissionRule` resources below (see there for why a role
// can't own them).

interface DirectusRoleInputs extends DirectusAuthProps {
  name: string;
  icon?: string;
  description?: string;
  /** Whether users with this role can sign into the Directus Data Studio (the admin app UI) at
   * all, as opposed to API-only access. Directus policies default this to `false` — required here
   * (no default) rather than silently shipping a role nobody can actually log into. */
  appAccess: boolean;
  /** Whether the role's users are admins, with every permission. */
  adminAccess?: boolean;
  /** The role's ID, when something must know it before the role exists. */
  fixedRoleId?: string;
}

interface DirectusRoleOutputs extends DirectusRoleInputs {
  roleId: string;
  policyId: string;
}

export const directusRoleProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusRole", "create", async (inputs: DirectusRoleInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);

    const policy = await directusRequest<{ data: { id: string } }>(inputs.baseUrl, token, "POST", "/policies", {
      name: inputs.name,
      icon: inputs.icon,
      description: inputs.description,
      app_access: inputs.appAccess,
      admin_access: inputs.adminAccess ?? false,
    });
    const policyId = policy.data.id;

    const role = await directusRequest<{ data: { id: string } }>(inputs.baseUrl, token, "POST", "/roles", {
      id: inputs.fixedRoleId,
      name: inputs.name,
      icon: inputs.icon,
      description: inputs.description,
    });
    const roleId = role.data.id;
    await directusRequest(inputs.baseUrl, token, "POST", "/access", { role: roleId, policy: policyId });

    const outs: DirectusRoleOutputs = { ...inputs, roleId, policyId };
    return { id: roleId, outs };
  }),

  update: reportErrors(
    "DirectusRole",
    "update",
    async (_id: string, olds: DirectusRoleOutputs, news: DirectusRoleInputs) => {
      await waitForReachable(news.baseUrl);
      const token = await login(news.baseUrl, news.adminEmail, news.adminPassword);

      await directusRequest(news.baseUrl, token, "PATCH", `/policies/${olds.policyId}`, {
        name: news.name,
        icon: news.icon,
        description: news.description,
        app_access: news.appAccess,
        admin_access: news.adminAccess ?? false,
      });
      await directusRequest(news.baseUrl, token, "PATCH", `/roles/${olds.roleId}`, {
        name: news.name,
        icon: news.icon,
        description: news.description,
      });

      const outs: DirectusRoleOutputs = { ...news, roleId: olds.roleId, policyId: olds.policyId };
      return { outs };
    },
  ),

  // Tolerates the access row(s), role, or policy already being gone (cyc-seattle/isthmia#125) rather than 404-ing the
  // apply into a dead end — same spirit as DirectusUser.delete below.
  delete: reportErrors("DirectusRole", "delete", async (_id: string, props: DirectusRoleOutputs) => {
    const token = await login(props.baseUrl, props.adminEmail, props.adminPassword);
    // Directus would set their role to null, leaving them no access, so move them off first.
    const holders = await directusRequest<{ data: { id: string }[] }>(
      props.baseUrl,
      token,
      "GET",
      `/users?filter[role][_eq]=${props.roleId}&fields=id&limit=-1`,
    );
    if (holders.data.length > 0) {
      throw new Error(
        `The ${props.name} role still has ${holders.data.length} user(s). Move them to another role before deleting it.`,
      );
    }
    const access = await directusRequest<{ data: { id: string }[] }>(
      props.baseUrl,
      token,
      "GET",
      `/access?filter[role][_eq]=${props.roleId}&limit=-1`,
    );
    const paths = [
      ...access.data.map((row) => `/access/${row.id}`),
      `/roles/${props.roleId}`,
      `/policies/${props.policyId}`,
    ];
    for (const path of paths) {
      try {
        await directusRequest(props.baseUrl, token, "DELETE", path);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
  }),

  // Without a diff, Pulumi compares every input, including this provider's serialized code, so any
  // edit to it would update every role and leave its roleId unknown in a preview, which replaces
  // what depends on it.
  diff: reportErrors(
    "DirectusRole",
    "diff",
    async (_id: string, olds: DirectusRoleOutputs, news: DirectusRoleInputs) => {
      const replaces = olds.fixedRoleId !== news.fixedRoleId ? ["fixedRoleId"] : [];
      const changes =
        replaces.length > 0 ||
        (
          ["baseUrl", "adminEmail", "adminPassword", "name", "icon", "description", "appAccess", "adminAccess"] as const
        ).some((key) => olds[key] !== news[key]);
      return { changes, replaces };
    },
  ),
};

export interface DirectusRoleArgs extends DirectusAuthArgs {
  name: pulumi.Input<string>;
  icon?: pulumi.Input<string>;
  description?: pulumi.Input<string>;
  /** Whether users with this role can sign into the Directus Data Studio (the admin app UI), as
   * opposed to API-only access. No default — pick `true` for a role real staff sign into the
   * Directus app with, `false` for API-only access (e.g. a future end-user-facing portal). */
  appAccess: pulumi.Input<boolean>;
  /** Whether the role's users are admins, with every permission. Defaults to false. */
  adminAccess?: pulumi.Input<boolean>;
  /**
   * The role's ID, for a role something must name before it exists, such as Directus's own
   * `AUTH_AUTHENTIK_DEFAULT_ROLE_ID`. Changing it replaces the role.
   */
  fixedRoleId?: pulumi.Input<string>;
}

/**
 * A Directus role + its policy, managed as one Pulumi resource. Waits (with retries) for Directus
 * to become reachable before authenticating, since it may still be starting.
 */
export class DirectusRole extends pulumi.dynamic.Resource {
  declare public readonly roleId: pulumi.Output<string>;
  declare public readonly policyId: pulumi.Output<string>;

  constructor(name: string, args: DirectusRoleArgs, opts?: pulumi.CustomResourceOptions) {
    super(
      directusRoleProvider,
      name,
      { ...args, roleId: undefined, policyId: undefined },
      withSecretOutputs(["adminPassword"], opts),
    );
  }
}

// --- DirectusPermissionRule: a single permission row under a policy (one collection/action pair).
// Its own resource rather than an input on DirectusRole, so a project that doesn't own the role can
// still attach rules to its policy without a shared `update` clobbering rows another project
// declared.

/** The content of one permission row, independent of which row (policy, collection, action) it is.
 * Handy for building a list of rules before turning each into its own `DirectusPermissionRule`. */
export type DirectusPermissionRuleFields = PermissionRuleInput;

interface DirectusPermissionRuleInputs extends DirectusAuthProps {
  policyId: string;
  collection: string;
  action: PermissionAction;
  permissions?: Record<string, unknown>;
  fields?: string[];
}

interface DirectusPermissionRuleOutputs extends DirectusPermissionRuleInputs {
  permissionId: string;
}

export const directusPermissionRuleProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusPermissionRule", "create", async (inputs: DirectusPermissionRuleInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);

    // Adopts a row the old DirectusRole provider already created for this (policy, collection,
    // action) instead of posting a duplicate, and reconciles its permissions/fields to match -
    // see ensurePermission's doc comment for why adoption alone isn't enough.
    const permissionId = await ensurePermission(inputs.baseUrl, token, inputs.policyId, inputs);

    const outs: DirectusPermissionRuleOutputs = { ...inputs, permissionId };
    return { id: permissionId, outs };
  }),

  update: reportErrors(
    "DirectusPermissionRule",
    "update",
    async (_id: string, olds: DirectusPermissionRuleOutputs, news: DirectusPermissionRuleInputs) => {
      await waitForReachable(news.baseUrl);
      const token = await login(news.baseUrl, news.adminEmail, news.adminPassword);
      // Recreates rather than failing if the row is gone (e.g. DirectusRole.delete dropped its
      // policy, taking every row under it - possibly declared in a different stack than the one
      // deleting the policy) - mirrors ensurePermission's find-or-create-and-reconcile shape.
      const permissionId = await reconcilePermission(news.baseUrl, token, news.policyId, olds.permissionId, news);

      const outs: DirectusPermissionRuleOutputs = { ...news, permissionId };
      return { outs };
    },
  ),

  delete: reportErrors(
    "DirectusPermissionRule",
    "delete",
    async (_id: string, props: DirectusPermissionRuleOutputs) => {
      const token = await login(props.baseUrl, props.adminEmail, props.adminPassword);
      await deletePermission(props.baseUrl, token, props.permissionId);
    },
  ),

  // (policy, collection, action) is this row's identity. Without a replaces list here, the default
  // dynamic-provider diff (no replace unless told) would PATCH the existing row in place on any
  // change, silently repointing it at a different collection/action instead of creating a new row
  // and leaving the old one alone. The auth props (baseUrl/adminEmail/adminPassword) must report a
  // change too - not a replace, the row itself is unaffected by which credential wrote it - or a
  // rotated admin password (see directus.ts) is never picked up: `update` never runs, so `outs`
  // (and the credential a later `delete` authenticates with) stay frozen at whatever `create` saw.
  diff: reportErrors(
    "DirectusPermissionRule",
    "diff",
    async (_id: string, olds: DirectusPermissionRuleOutputs, news: DirectusPermissionRuleInputs) => {
      const replaces = (["policyId", "collection", "action"] as const).filter((key) => olds[key] !== news[key]);
      const authChanged = (["baseUrl", "adminEmail", "adminPassword"] as const).some((key) => olds[key] !== news[key]);
      const changes =
        replaces.length > 0 ||
        authChanged ||
        JSON.stringify(olds.permissions ?? {}) !== JSON.stringify(news.permissions ?? {}) ||
        JSON.stringify(olds.fields ?? ["*"]) !== JSON.stringify(news.fields ?? ["*"]);
      return { changes, replaces };
    },
  ),
};

export interface DirectusPermissionRuleArgs extends DirectusAuthArgs {
  policyId: pulumi.Input<string>;
  collection: pulumi.Input<string>;
  action: pulumi.Input<PermissionAction>;
  permissions?: pulumi.Input<Record<string, unknown>>;
  fields?: pulumi.Input<string[]>;
}

/** One permission row under a policy. `policyId` typically comes from a `DirectusRole`'s output,
 * but the rule itself doesn't have to be declared by whatever owns that role. */
export class DirectusPermissionRule extends pulumi.dynamic.Resource {
  declare public readonly permissionId: pulumi.Output<string>;

  constructor(name: string, args: DirectusPermissionRuleArgs, opts?: pulumi.CustomResourceOptions) {
    super(
      directusPermissionRuleProvider,
      name,
      { ...args, permissionId: undefined },
      withSecretOutputs(["adminPassword"], opts),
    );
  }
}

// --- DirectusUser: a Directus user record linked to a Google account (via OIDC provider +
// external_identifier — the same email-matching Directus's own native OIDC config does, per
// docs/crm-schema.md's Auth identity section) and a role. No password: signing in via
// Google is the only way in. Reusable across any Directus-backed app.

interface DirectusUserInputs extends DirectusAuthProps {
  email: string;
  roleId: string;
  /** e.g. "google" for an OIDC user, or "default" for a machine user with no interactive login. */
  provider: string;
  /** The identity Directus's OIDC config matches on first login — email, for our Google setup.
   * Omitted for a machine user, which authenticates with `token` instead. */
  externalIdentifier?: string;
  /** A Directus static access token, for a machine user in place of an interactive login. */
  token?: string;
}

interface DirectusUserOutputs extends DirectusUserInputs {
  userId: string;
  /** Whether `create` adopted a user that already existed rather than creating one. Governs whether
   * `delete` may remove the account - see the provider's delete. Absent on state written before
   * adoption existed, which is deliberately treated as "not ours to delete". */
  adopted?: boolean | undefined;
}

// A dynamic provider's `outs` crosses a protobuf Struct, which can't represent `undefined` (only a
// present key, or `null`) - an outs object with an explicit `undefined` value fails deep in the
// provider RPC layer with "Unexpected struct type." `adopted` (above) carries `undefined` forward
// from `olds` on every update once a user predates the field. Dropping the key entirely round-trips
// as "absent" on the next read, which is already what "absent" means to `adopted`'s readers.
export function omitUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

function userFields(inputs: DirectusUserInputs) {
  return {
    email: inputs.email,
    role: inputs.roleId,
    status: "active",
    provider: inputs.provider,
    external_identifier: inputs.externalIdentifier,
    token: inputs.token,
  };
}

export const directusUserProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusUser", "create", async (inputs: DirectusUserInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);
    const { userId, adopted } = await upsertUserByEmail(inputs.baseUrl, token, userFields(inputs));
    const outs: DirectusUserOutputs = { ...inputs, userId, adopted };
    return { id: userId, outs: omitUndefined(outs) };
  }),

  // Re-resolves by email when the stored id is gone. Without this, a user deleted out of band -
  // including by this provider's own delete during a resource rename - leaves state pointing at a
  // dead id, and every later apply fails with no way forward but editing state by hand. See
  // reconcileUser's doc comment for why it verifies the id first rather than PATCHing and catching
  // a failure.
  update: reportErrors(
    "DirectusUser",
    "update",
    async (_id: string, olds: DirectusUserOutputs, news: DirectusUserInputs) => {
      await waitForReachable(news.baseUrl);
      const token = await login(news.baseUrl, news.adminEmail, news.adminPassword);
      const { userId, adopted } = await reconcileUser(news.baseUrl, token, olds.userId, olds.adopted, userFields(news));
      const outs = { ...news, userId, adopted } satisfies DirectusUserOutputs;
      return { outs: omitUndefined(outs) };
    },
  ),

  /**
   * Deletes the account only when this resource is the one that created it.
   *
   * Renaming a resource makes Pulumi create the new one and then delete the old, and both name the
   * same person - so the new resource adopts the existing account and the old resource's delete then
   * removes it, taking a live login with it. That is not hypothetical; it happened, and locking the
   * only Staff user out of Directus is not something a rename should be able to do.
   *
   * `adopted === undefined` means state written before adoption existed. Treated as not ours, since
   * that is exactly the state a rename is migrating away from.
   */
  delete: reportErrors("DirectusUser", "delete", async (_id: string, props: DirectusUserOutputs) => {
    if (props.adopted !== false) {
      pulumi.log.warn(
        `Leaving Directus user ${props.email} in place: this resource adopted it rather than ` +
          `creating it, so another resource may now own it. Delete it in the Data Studio if it is ` +
          `genuinely unwanted.`,
      );
      return;
    }
    const token = await login(props.baseUrl, props.adminEmail, props.adminPassword);
    // Tolerates the user already being gone (cyc-seattle/isthmia#125) — e.g. removed by hand in the Data Studio.
    // Directus answers 403 rather than 404 for a missing user id (see client.ts's isForbidden),
    // so both read as "already gone" here.
    try {
      await directusRequest(props.baseUrl, token, "DELETE", `/users/${props.userId}`);
    } catch (error) {
      if (!isNotFound(error) && !isForbidden(error)) throw error;
    }
  }),

  // Ignores the provider's own code, as DirectusRole's diff does.
  diff: reportErrors(
    "DirectusUser",
    "diff",
    async (_id: string, olds: DirectusUserOutputs, news: DirectusUserInputs) => {
      const keys = [
        "baseUrl",
        "adminEmail",
        "adminPassword",
        "email",
        "roleId",
        "provider",
        "externalIdentifier",
        "token",
      ] as const;
      return { changes: keys.some((key) => olds[key] !== news[key]) };
    },
  ),
};

export interface DirectusUserArgs extends DirectusAuthArgs {
  email: pulumi.Input<string>;
  roleId: pulumi.Input<string>;
  provider: pulumi.Input<string>;
  externalIdentifier?: pulumi.Input<string>;
  token?: pulumi.Input<string>;
}

/** A Directus user provisioned for a specific Google account — no password, no manual "create my
 * account" step; signing in with that Google account just works. */
export class DirectusUser extends pulumi.dynamic.Resource {
  declare public readonly userId: pulumi.Output<string>;

  constructor(name: string, args: DirectusUserArgs, opts?: pulumi.CustomResourceOptions) {
    super(
      directusUserProvider,
      name,
      { ...args, userId: undefined },
      withSecretOutputs(["adminPassword", "token"], opts),
    );
  }
}

// --- DirectusPolicy: an extra policy attached to an existing role via `/access`'s `role` key, for
// a role that needs more than the one policy `DirectusRole` bundles with it - e.g. the Community
// role's three separate policies (../crm/community-rules.ts), one per collection-scoped rule set
// since a `DirectusPermissionRule` row is keyed on (policy, collection, action). It grants only
// whatever `DirectusPermissionRule`s later attach to its `policyId`, nothing on its own.

interface DirectusPolicyInputs extends DirectusAuthProps {
  /** Omitted for a policy that groups give to users, not a role. */
  roleId?: string;
  name: string;
  icon?: string;
  description?: string;
}

interface DirectusPolicyOutputs extends DirectusPolicyInputs {
  policyId: string;
  accessId?: string;
}

export const directusPolicyProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusPolicy", "create", async (inputs: DirectusPolicyInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);

    const policy = await directusRequest<{ data: { id: string } }>(inputs.baseUrl, token, "POST", "/policies", {
      name: inputs.name,
      icon: inputs.icon,
      description: inputs.description,
      app_access: false,
    });
    const policyId = policy.data.id;

    const access =
      inputs.roleId === undefined
        ? undefined
        : await directusRequest<{ data: { id: string } }>(inputs.baseUrl, token, "POST", "/access", {
            role: inputs.roleId,
            policy: policyId,
          });

    const outs: DirectusPolicyOutputs = { ...inputs, policyId, ...(access && { accessId: access.data.id }) };
    return { id: policyId, outs };
  }),

  update: reportErrors(
    "DirectusPolicy",
    "update",
    async (_id: string, olds: DirectusPolicyOutputs, news: DirectusPolicyInputs) => {
      await waitForReachable(news.baseUrl);
      const token = await login(news.baseUrl, news.adminEmail, news.adminPassword);

      await directusRequest(news.baseUrl, token, "PATCH", `/policies/${olds.policyId}`, {
        name: news.name,
        icon: news.icon,
        description: news.description,
        app_access: false,
      });

      const outs: DirectusPolicyOutputs = {
        ...news,
        policyId: olds.policyId,
        ...(olds.accessId !== undefined && { accessId: olds.accessId }),
      };
      return { outs };
    },
  ),

  // Tolerates the access row or policy already being gone (cyc-seattle/isthmia#125), same spirit as
  // DirectusRole.delete above.
  delete: reportErrors("DirectusPolicy", "delete", async (_id: string, props: DirectusPolicyOutputs) => {
    const token = await login(props.baseUrl, props.adminEmail, props.adminPassword);
    const paths = [...(props.accessId ? [`/access/${props.accessId}`] : []), `/policies/${props.policyId}`];
    for (const path of paths) {
      try {
        await directusRequest(props.baseUrl, token, "DELETE", path);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
  }),

  // roleId is this row's identity: `/access` ties the policy to one specific role, and there's no
  // way to repoint that link in place without leaving the old role's grant dangling, so a changed
  // roleId replaces rather than updates.
  diff: reportErrors(
    "DirectusPolicy",
    "diff",
    async (_id: string, olds: DirectusPolicyOutputs, news: DirectusPolicyInputs) => {
      const replaces = olds.roleId !== news.roleId ? ["roleId"] : [];
      const authChanged = (["baseUrl", "adminEmail", "adminPassword"] as const).some((key) => olds[key] !== news[key]);
      const changes =
        replaces.length > 0 ||
        authChanged ||
        olds.name !== news.name ||
        olds.icon !== news.icon ||
        olds.description !== news.description;
      return { changes, replaces };
    },
  ),
};

export interface DirectusPolicyArgs extends DirectusAuthArgs {
  /** The role the policy is attached to. Omit for a policy that groups give to users. */
  roleId?: pulumi.Input<string>;
  name: pulumi.Input<string>;
  icon?: pulumi.Input<string>;
  description?: pulumi.Input<string>;
}

/** An extra policy attached to an existing role via `/access`'s `role` key - for a role (like
 * Community) that needs more than the one policy `DirectusRole` bundles with it. Permission rules
 * attach to `policyId`, as their own `DirectusPermissionRule` resources, same as any other policy. */
export class DirectusPolicy extends pulumi.dynamic.Resource {
  declare public readonly policyId: pulumi.Output<string>;
  declare public readonly accessId: pulumi.Output<string>;

  constructor(name: string, args: DirectusPolicyArgs, opts?: pulumi.CustomResourceOptions) {
    super(
      directusPolicyProvider,
      name,
      { ...args, policyId: undefined, accessId: undefined },
      withSecretOutputs(["adminPassword"], opts),
    );
  }
}

// --- DirectusAccess: attaches an existing policy to one more role, for a policy that several roles
// share, such as the Community policies Crew also gets.

interface DirectusAccessInputs extends DirectusAuthProps {
  roleId: string;
  policyId: string;
}

interface DirectusAccessOutputs extends DirectusAccessInputs {
  accessId: string;
}

export const directusAccessProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusAccess", "create", async (inputs: DirectusAccessInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);
    const access = await directusRequest<{ data: { id: string } }>(inputs.baseUrl, token, "POST", "/access", {
      role: inputs.roleId,
      policy: inputs.policyId,
    });
    const outs: DirectusAccessOutputs = { ...inputs, accessId: access.data.id };
    return { id: access.data.id, outs };
  }),

  update: reportErrors(
    "DirectusAccess",
    "update",
    async (_id: string, olds: DirectusAccessOutputs, news: DirectusAccessInputs) => {
      const outs: DirectusAccessOutputs = { ...news, accessId: olds.accessId };
      return { outs };
    },
  ),

  delete: reportErrors("DirectusAccess", "delete", async (_id: string, props: DirectusAccessOutputs) => {
    const token = await login(props.baseUrl, props.adminEmail, props.adminPassword);
    try {
      await directusRequest(props.baseUrl, token, "DELETE", `/access/${props.accessId}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }),

  // The role and policy are the row's identity, so a change to either replaces it.
  diff: reportErrors(
    "DirectusAccess",
    "diff",
    async (_id: string, olds: DirectusAccessOutputs, news: DirectusAccessInputs) => {
      const replaces = (["roleId", "policyId"] as const).filter((key) => olds[key] !== news[key]);
      const changes =
        replaces.length > 0 ||
        (["baseUrl", "adminEmail", "adminPassword"] as const).some((key) => olds[key] !== news[key]);
      return { changes, replaces };
    },
  ),
};

export interface DirectusAccessArgs extends DirectusAuthArgs {
  roleId: pulumi.Input<string>;
  policyId: pulumi.Input<string>;
}

/** Attaches a policy to a role, beside whatever else the role has. */
export class DirectusAccess extends pulumi.dynamic.Resource {
  declare public readonly accessId: pulumi.Output<string>;

  constructor(name: string, args: DirectusAccessArgs, opts?: pulumi.CustomResourceOptions) {
    super(directusAccessProvider, name, { ...args, accessId: undefined }, withSecretOutputs(["adminPassword"], opts));
  }
}

// --- DirectusSettings: the fields of the `directus_settings` singleton that a stack owns, such as
// Settings -> AI's MCP switches. It writes only the fields it's given, and leaves the rest to admins.

interface DirectusSettingsInputs extends DirectusAuthProps {
  settings: Record<string, unknown>;
}

async function patchSettings(inputs: DirectusSettingsInputs): Promise<void> {
  await waitForReachable(inputs.baseUrl);
  const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);
  await directusRequest(inputs.baseUrl, token, "PATCH", "/settings", inputs.settings);
}

export const directusSettingsProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusSettings", "create", async (inputs: DirectusSettingsInputs) => {
    await patchSettings(inputs);
    return { id: "settings", outs: inputs };
  }),

  update: reportErrors(
    "DirectusSettings",
    "update",
    async (_id: string, _olds: DirectusSettingsInputs, news: DirectusSettingsInputs) => {
      await patchSettings(news);
      return { outs: news };
    },
  ),

  // A no-op: there's no earlier value to restore, and the singleton can't be deleted.
  delete: reportErrors("DirectusSettings", "delete", async () => {}),
};

export interface DirectusSettingsArgs extends DirectusAuthArgs {
  settings: pulumi.Input<Record<string, pulumi.Input<unknown>>>;
}

/** Sets fields of the `directus_settings` singleton. One per Directus. */
export class DirectusSettings extends pulumi.dynamic.Resource {
  constructor(name: string, args: DirectusSettingsArgs, opts?: pulumi.CustomResourceOptions) {
    super(directusSettingsProvider, name, { ...args }, withSecretOutputs(["adminPassword"], opts));
  }
}

// --- DirectusPreset: a collection's global default view, the one a user sees until they save their
// own. Directus marks it with no user, role, or bookmark. A user's own saved view still wins over it.

/** How a collection's table opens: its sort, its columns, and an optional filter. */
export interface DefaultView {
  collection: string;
  /** Fields to sort by, `-` first for descending, such as `["-start_date", "name"]`. */
  sort: string[];
  /** The columns, in order. A dotted path shows a related row's field. */
  fields: string[];
  /** A Directus filter, such as `{ removed_at: { _null: true } }`. */
  filter?: Record<string, unknown>;
}

interface DirectusPresetInputs extends DirectusAuthProps, DefaultView {}

interface DirectusPresetOutputs extends DirectusPresetInputs {
  presetId: number;
}

function presetBody(view: DefaultView): Record<string, unknown> {
  return {
    collection: view.collection,
    user: null,
    role: null,
    bookmark: null,
    layout: "tabular",
    layout_query: { tabular: { sort: view.sort, fields: view.fields, page: 1 } },
    filter: view.filter ?? null,
  };
}

/** Writes the collection's global preset, taking over one an admin already saved rather than adding a second. */
async function writePreset(inputs: DirectusPresetInputs, token: string, presetId?: number): Promise<number> {
  const body = presetBody(inputs);
  if (presetId !== undefined) {
    try {
      await directusRequest(inputs.baseUrl, token, "PATCH", `/presets/${presetId}`, body);
      return presetId;
    } catch (error) {
      if (!isNotFound(error) && !isForbidden(error)) throw error;
    }
  }
  const existing = await directusRequest<{ data: { id: number }[] }>(
    inputs.baseUrl,
    token,
    "GET",
    `/presets?filter[collection][_eq]=${encodeURIComponent(inputs.collection)}` +
      "&filter[user][_null]=true&filter[role][_null]=true&filter[bookmark][_null]=true&fields=id&limit=1",
  );
  const found = existing.data[0];
  if (found !== undefined) {
    await directusRequest(inputs.baseUrl, token, "PATCH", `/presets/${found.id}`, body);
    return found.id;
  }
  const created = await directusRequest<{ data: { id: number } }>(inputs.baseUrl, token, "POST", "/presets", body);
  return created.data.id;
}

export const directusPresetProvider: pulumi.dynamic.ResourceProvider = {
  create: reportErrors("DirectusPreset", "create", async (inputs: DirectusPresetInputs) => {
    await waitForReachable(inputs.baseUrl);
    const token = await login(inputs.baseUrl, inputs.adminEmail, inputs.adminPassword);
    const presetId = await writePreset(inputs, token);
    const outs: DirectusPresetOutputs = { ...inputs, presetId };
    return { id: String(presetId), outs };
  }),

  update: reportErrors(
    "DirectusPreset",
    "update",
    async (_id: string, olds: DirectusPresetOutputs, news: DirectusPresetInputs) => {
      await waitForReachable(news.baseUrl);
      const token = await login(news.baseUrl, news.adminEmail, news.adminPassword);
      const presetId = await writePreset(news, token, olds.presetId);
      const outs: DirectusPresetOutputs = { ...news, presetId };
      return { outs };
    },
  ),

  delete: reportErrors("DirectusPreset", "delete", async (_id: string, props: DirectusPresetOutputs) => {
    const token = await login(props.baseUrl, props.adminEmail, props.adminPassword);
    try {
      await directusRequest(props.baseUrl, token, "DELETE", `/presets/${props.presetId}`);
    } catch (error) {
      if (!isNotFound(error) && !isForbidden(error)) throw error;
    }
  }),

  // The collection is the preset's identity, so a change to it replaces the preset.
  diff: reportErrors(
    "DirectusPreset",
    "diff",
    async (_id: string, olds: DirectusPresetOutputs, news: DirectusPresetInputs) => {
      const replaces = olds.collection !== news.collection ? ["collection"] : [];
      const changes =
        replaces.length > 0 ||
        (["baseUrl", "adminEmail", "adminPassword"] as const).some((key) => olds[key] !== news[key]) ||
        JSON.stringify(presetBody(olds)) !== JSON.stringify(presetBody(news));
      return { changes, replaces };
    },
  ),
};

export interface DirectusPresetArgs extends DirectusAuthArgs, DefaultView {}

/** A collection's global default view: its sort and columns for anyone who hasn't saved their own. */
export class DirectusPreset extends pulumi.dynamic.Resource {
  declare public readonly presetId: pulumi.Output<number>;

  constructor(name: string, args: DirectusPresetArgs, opts?: pulumi.CustomResourceOptions) {
    super(directusPresetProvider, name, { ...args, presetId: undefined }, withSecretOutputs(["adminPassword"], opts));
  }
}
