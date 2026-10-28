import fs from "node:fs";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as yaml from "js-yaml";
import { discoverSchemaFiles, mergeSchemas } from "../../src/directus/client.ts";
import {
  DirectusAccess,
  DirectusSchema,
  DirectusPermissionRule,
  type DirectusPermissionRuleArgs,
  DirectusPolicy,
  DirectusSettings,
} from "../../src/directus/resources.ts";
import * as random from "@pulumi/random";
import { crmIdentities, type CrmIdentities } from "../../src/directus/roles.ts";
import { prodDirectus } from "./prod-state.ts";
import { requireStringList } from "../../src/app/config.ts";
import { communityPolicies } from "./community-rules.ts";
import { crewRules, groupPolicies, groupPoliciesConfig, queryGuardConfig, type PolicyData } from "./policies.ts";
import { isDev, loadCluster } from "../../src/app/cluster.ts";
import { deployDirectus } from "./cluster.ts";
import { deployClubspotSync } from "./clubspot-sync.ts";
import { deployGsuiteSync } from "./gsuite-sync.ts";

// The CRM app's Directus schema and permission rules, matching docs/crm-schema.md, and the roles and
// users they attach to (src/directus/roles.ts). A second Directus-backed app would define its own
// schema/rules in its own project, reusing the Directus* resources (src/directus/).

const config = new pulumi.Config();

// Directus creates this account on its first boot.
const directusAdminEmail = config.require("directusAdminEmail");

// Directus's unlicensed Core tier refuses every permission row ("custom_permission_rules_enabled is a
// restricted resource") and any user whose provider isn't `default`, so without a license this
// project declares neither. Its roles, policies, sync users, and schema all still apply.
const licensed = config.getBoolean("licensed") ?? true;
function permissionRule(
  name: string,
  args: DirectusPermissionRuleArgs,
  opts?: pulumi.CustomResourceOptions,
): DirectusPermissionRule | undefined {
  return licensed ? new DirectusPermissionRule(name, args, opts) : undefined;
}

// Every schemas/<domain>.yaml, merged into one snapshot and applied once: a domain's own apply would
// drop the extension fields another domain declares on its collections.
const schemaFiles = discoverSchemaFiles(path.resolve(import.meta.dirname, "../../schemas"));
const loadedSchemas = schemaFiles.map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const schema = mergeSchemas(loadedSchemas);

// The policies a group can give (docs/access.md).
const grantable = groupPolicies(loadedSchemas);

// Prod keeps what its Directus had on the VM (./prod-state.ts).
const prod = isDev
  ? undefined
  : prodDirectus({
      adminEmail: directusAdminEmail,
      admins: requireStringList("directusAdmins"),
      externalDomain: config.require("externalDomain"),
      // deployDirectus needs prod's values first, so its own baseUrl comes too late.
      baseUrl: pulumi.output(loadCluster().then(({ platform }) => `https://directus.${platform.domain}`)),
    });

const app = deployDirectus(
  directusAdminEmail,
  licensed,
  {
    queryGuard: queryGuardConfig([...communityPolicies, { name: "Crew", rules: crewRules }, ...grantable]),
    groupPolicies: groupPoliciesConfig(grantable),
  },
  prod?.values,
);

function roleIds(roles: CrmIdentities) {
  return {
    crewPolicyId: roles.crewRole.policyId,
    clubspotSyncPolicyId: roles.clubspotSyncRole.policyId,
    gsuiteSyncPolicyId: roles.gsuiteSyncRole.policyId,
    communityRoleId: roles.communityRole.roleId,
    crewRoleId: roles.crewRole.roleId,
  };
}

function prodIdentities({ auth, roles, clubspotSyncToken, gsuiteSyncToken }: NonNullable<typeof prod>) {
  return {
    auth,
    clubspotSyncToken,
    gsuiteSyncToken,
    ...roleIds(roles),
  };
}

function devIdentities(directus: typeof app) {
  const auth = {
    baseUrl: directus.then(({ baseUrl }) => baseUrl),
    adminEmail: directusAdminEmail,
    adminPassword: pulumi.secret(directus.then(({ adminPassword }) => adminPassword)),
  };
  const token = (name: string) => pulumi.secret(new random.RandomPassword(name, { length: 64, special: false }).result);
  const clubspotSyncToken = token("clubspot-sync-directus-token");
  const gsuiteSyncToken = token("gsuite-sync-directus-token");
  const roles = crmIdentities({
    auth,
    readyForApiCalls: [directus.then(({ ready }) => ready)],
    // Whoever signs in through this environment's Authentik with one of these emails gets admin.
    // Core has no SSO, and refuses a user whose provider isn't `default`, so unlicensed there are none.
    admins: licensed ? (config.getObject<string[]>("directusAdmins") ?? []) : [],
    externalDomain: config.require("externalDomain"),
    clubspotSyncToken,
    gsuiteSyncToken,
    communityRoleId: pulumi.output(directus.then(({ communityRoleId }) => communityRoleId)),
  });
  return {
    auth,
    clubspotSyncToken,
    gsuiteSyncToken,
    ...roleIds(roles),
  };
}

const identities = prod ? prodIdentities(prod) : devIdentities(app);
const { auth, crewPolicyId, clubspotSyncPolicyId, gsuiteSyncPolicyId, communityRoleId, crewRoleId } = identities;

// The syncs' CronJobs take their machine users' tokens straight into their Secrets.
const { clubspotSyncToken, gsuiteSyncToken } = identities;
void loadCluster().then((cluster) => {
  deployClubspotSync(cluster, clubspotSyncToken);
  deployGsuiteSync(cluster, gsuiteSyncToken);
});

// Authentik registers Directus's client from these (cyc-seattle/workplace#6).
export const directusOidcClientId = pulumi.output(app.then(({ oidcClientId }) => oidcClientId));
export const directusOidcClientSecret = pulumi.secret(app.then(({ oidcClientSecret }) => oidcClientSecret));

// Settings -> AI. MCP acts as the signed-in user and adds no access of its own, so it's on for every
// signed-in user, in prod too (cyc-seattle/workplace#6 decision 16, docs/backend.md).
const mcp = config.getBoolean("mcp") ?? false;
new DirectusSettings(
  "directus-settings",
  {
    ...auth,
    settings: {
      mcp_enabled: mcp,
      mcp_oauth_enabled: mcp,
      mcp_oauth_cimd_enabled: mcp,
      mcp_oauth_dcr_enabled: false,
      mcp_allow_deletes: false,
    },
  },
  { dependsOn: [app.then(({ ready }) => ready)] },
);

const crmSchema = new DirectusSchema(
  "crm-schema",
  { ...auth, schema },
  { dependsOn: [app.then(({ ready }) => ready)] },
);

for (const rule of crewRules) {
  const name = `${rule.collection}-${rule.action}`;
  permissionRule(
    `crm-crew-${name}`,
    { ...auth, policyId: crewPolicyId, ...rule },
    { dependsOn: crmSchema, aliases: [{ name: `crm-coach-${name}` }] },
  );
}

/**
 * Declares a policy once, attached to each of `roleIds`, or to none for one that groups give. Its
 * rules are named by collection and action, and by their fields where a policy has two of a pair.
 */
function declarePolicy(prefix: string, policy: PolicyData, roleIds: pulumi.Input<string>[] = []): void {
  const [roleId, ...others] = roleIds;
  const resource = new DirectusPolicy(
    prefix,
    {
      ...auth,
      ...(roleId !== undefined && { roleId }),
      name: policy.name,
      icon: policy.icon,
      description: policy.description,
    },
    { dependsOn: crmSchema },
  );
  others.forEach((other, index) => {
    new DirectusAccess(`${prefix}-role-${index + 1}`, { ...auth, roleId: other, policyId: resource.policyId });
  });
  const named = new Set<string>();
  for (const rule of policy.rules) {
    let name = `${prefix}-${rule.collection}-${rule.action}`;
    if (named.has(name)) {
      name = `${name}-${(rule.fields ?? []).join("-")}`;
    }
    named.add(name);
    permissionRule(name, { ...auth, policyId: resource.policyId, ...rule }, { dependsOn: crmSchema });
  }
}

// Least privilege for the clubspot-sync machine user (crm-clubspot-sync in
// src/directus/roles.ts): create/read/update on every collection it writes.
// `programs` is deliberately absent: a program is durable and staff-created, and Clubspot has no
// durable program id to derive one from. Withholding the grant makes that a rule the permission
// system enforces, not just one the mapping code happens to follow.
const clubspotSyncCollections = [
  "camps",
  "sessions",
  "classes",
  "entry_caps",
  "people",
  "contacts",
  "medical_profiles",
  "registrations",
  "registration_entries",
  "registration_billing",
  "custom_field_definitions",
  "custom_field_responses",
  "participants",
  "contact_points",
  "sync_tasks",
  "sync_runs",
  "audit_findings",
];

for (const collection of clubspotSyncCollections) {
  for (const action of ["create", "read", "update"] as const) {
    permissionRule(
      `crm-clubspot-sync-${collection}-${action}`,
      { ...auth, policyId: clubspotSyncPolicyId, collection, action },
      { dependsOn: crmSchema },
    );
  }
}

// session_classes is a pure join with no status field, so a class a session no longer offers is
// deleted outright instead of cancelled - the one collection that needs the delete action.
for (const action of ["create", "read", "update", "delete"] as const) {
  permissionRule(
    `crm-clubspot-sync-session_classes-${action}`,
    { ...auth, policyId: clubspotSyncPolicyId, collection: "session_classes", action },
    { dependsOn: crmSchema },
  );
}

// registration_billing keys on the billing objectId, so a replaced billing object is a delete of
// the old row followed by a create, not an update - see planRegistrationBilling.
permissionRule(
  "crm-clubspot-sync-registration_billing-delete",
  { ...auth, policyId: clubspotSyncPolicyId, collection: "registration_billing", action: "delete" },
  { dependsOn: crmSchema },
);

// promoted_fields is staff-maintained configuration, not synced data - the sync only reads it to
// know which custom-field labels feed which people column.
permissionRule(
  "crm-clubspot-sync-promoted_fields-read",
  { ...auth, policyId: clubspotSyncPolicyId, collection: "promoted_fields", action: "read" },
  { dependsOn: crmSchema },
);

// program_role_assignments, event_staff, and google_group_memberships are owned elsewhere - the
// merge executor only repoints person_id off a duplicate onto its keeper (cyc-seattle/isthmia#133).
for (const collection of ["program_role_assignments", "event_staff", "google_group_memberships"]) {
  for (const action of ["read", "update"] as const) {
    permissionRule(
      `crm-clubspot-sync-${collection}-${action}`,
      { ...auth, policyId: clubspotSyncPolicyId, collection, action },
      { dependsOn: crmSchema },
    );
  }
}

// A person merge stops while a duplicate is still in a group (packages/clubspot-sync/src/merge.ts), so
// it reads who is in each one, and changes none of them.
permissionRule(
  "crm-clubspot-sync-group_members-read",
  { ...auth, policyId: clubspotSyncPolicyId, collection: "group_members", action: "read", fields: ["id", "person_id"] },
  { dependsOn: crmSchema },
);

// A person merge folds a duplicate's own rows onto its keeper, then deletes the duplicate - the
// only deletes clubspot-sync's policy grants (cyc-seattle/isthmia#133).
for (const collection of ["people", "contacts", "contact_points", "medical_profiles"]) {
  permissionRule(
    `crm-clubspot-sync-${collection}-delete`,
    { ...auth, policyId: clubspotSyncPolicyId, collection, action: "delete" },
    { dependsOn: crmSchema },
  );
}

// Least privilege for the gsuite-sync machine user (crm-gsuite-sync in
// src/directus/roles.ts): read on every collection it maps from into Google Groups.
const gsuiteSyncReadCollections = [
  "people",
  "contacts",
  "registrations",
  "registration_entries",
  "classes",
  "camps",
  "programs",
  "program_role_assignments",
];

for (const collection of gsuiteSyncReadCollections) {
  permissionRule(
    `crm-gsuite-sync-${collection}-read`,
    { ...auth, policyId: gsuiteSyncPolicyId, collection, action: "read" },
    { dependsOn: crmSchema },
  );
}

// participants holds guardian and medical answers gsuite-sync has no reason to see - only the
// link back to a person, to find its planned group membership.
permissionRule(
  "crm-gsuite-sync-participants-read",
  { ...auth, policyId: gsuiteSyncPolicyId, collection: "participants", action: "read", fields: ["id", "person_id"] },
  { dependsOn: crmSchema },
);

// contact_points holds every email and phone, not only the primary - gsuite-sync reads it to spot
// a live group member whose address is a person's known secondary, not an unexpected one.
permissionRule(
  "crm-gsuite-sync-contact_points-read",
  {
    ...auth,
    policyId: gsuiteSyncPolicyId,
    collection: "contact_points",
    action: "read",
    fields: ["id", "person_id", "kind", "normalized"],
  },
  { dependsOn: crmSchema },
);

// The audit checks each program's product is a program, and that a camp's classes book to one
// revenue account, so it reads only the fields that link a program to its account.
for (const [collection, fields] of [
  ["products", ["id", "kind", "revenue_account_id"]],
  ["accounts", ["id", "number"]],
] as const) {
  permissionRule(
    `crm-gsuite-sync-${collection}-read`,
    { ...auth, policyId: gsuiteSyncPolicyId, collection, action: "read", fields: [...fields] },
    { dependsOn: crmSchema },
  );
}

// The only collections gsuite-sync writes: its own run queue, the audit findings it raises, the
// groups discovery mirrors out of Workspace, and the memberships it records (cyc-seattle/isthmia#265). No delete: a
// group that vanishes from Workspace is archived, and only staff delete a membership row.
for (const collection of ["sync_tasks", "audit_findings", "google_groups", "google_group_memberships"]) {
  for (const action of ["create", "read", "update"] as const) {
    permissionRule(
      `crm-gsuite-sync-${collection}-${action}`,
      { ...auth, policyId: gsuiteSyncPolicyId, collection, action },
      { dependsOn: crmSchema },
    );
  }
}

// The Community role's policies (./community-rules.ts), which Crew has too, so a Crew member who is
// a parent sees what any parent sees.
for (const policy of communityPolicies) {
  declarePolicy(`crm-community-${policy.key}`, policy, [communityRoleId, crewRoleId]);
}

// The policies a group can give, attached to no role. The group-policies hook gives them to users.
for (const policy of grantable) {
  declarePolicy(`crm-${policy.key}`, policy);
}
