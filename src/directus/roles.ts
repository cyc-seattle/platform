import * as pulumi from "@pulumi/pulumi";
import { DirectusRole, DirectusUser } from "./resources.ts";

// The CRM's roles and the users assigned to them. `backend` declares them for prod's existing Directus
// and for dev's, so both call this.

export interface CrmIdentityArgs {
  auth: { baseUrl: pulumi.Input<string>; adminEmail: pulumi.Input<string>; adminPassword: pulumi.Input<string> };
  /** What must exist before Directus answers: the roles wait on it. */
  readyForApiCalls: pulumi.Input<pulumi.Resource>[];
  /** The admins' accounts, signed in through Authentik. */
  admins: string[];
  /** The sync users' email domain. */
  externalDomain: string;
  clubspotSyncToken: pulumi.Input<string>;
  gsuiteSyncToken: pulumi.Input<string>;
  /** Fixes the Community role's ID, so Directus can name it as the default role before it exists. */
  communityRoleId?: pulumi.Input<string>;
}

export interface CrmIdentities {
  communityRole: DirectusRole;
  crewRole: DirectusRole;
  adminRole: DirectusRole;
  clubspotSyncRole: DirectusRole;
  gsuiteSyncRole: DirectusRole;
  clubspotSyncUser: DirectusUser;
  gsuiteSyncUser: DirectusUser;
}

export function crmIdentities(args: CrmIdentityArgs): CrmIdentities {
  const { auth, readyForApiCalls } = args;

  // Everyone who signs in has Community, Crew, or Admin (docs/access.md). Groups give the rest.

  // Everyone's role on their first sign-in, through Directus's AUTH_AUTHENTIK_DEFAULT_ROLE_ID. Its
  // permissions come from the Community policies in stacks/backend/community-rules.ts.
  const communityRole = new DirectusRole(
    "crm-community",
    {
      ...auth,
      name: "Community",
      icon: "groups",
      description: "Families and members: their own children, and their children's teammates. See docs/access.md.",
      appAccess: true,
      ...(args.communityRoleId !== undefined && { fixedRoleId: args.communityRoleId }),
    },
    { dependsOn: readyForApiCalls },
  );

  // Coach, renamed, so its users are Crew with no data step.
  const crewRole = new DirectusRole(
    "crm-crew",
    {
      ...auth,
      name: "Crew",
      icon: "sports",
      description:
        "People an admin trusts with every roster. Also has the Community policies, for their own children. " +
        "See docs/access.md.",
      appAccess: true,
    },
    { dependsOn: readyForApiCalls, aliases: [{ name: "crm-coach" }] },
  );

  const adminRole = new DirectusRole(
    "crm-admin",
    {
      ...auth,
      name: "Admin",
      icon: "shield_person",
      description: "The people who run the system. Every permission. See docs/access.md.",
      appAccess: true,
      adminAccess: true,
    },
    { dependsOn: readyForApiCalls },
  );

  // Admins, signed in through Authentik with no password.
  //
  // Via `authentik` (cyc-seattle/isthmia#166): a Directus username is a unique email, and an admin who's also a
  // parent would collide with the Community account the `authentik` provider's public registration
  // creates for them. Directus has no second OIDC provider to fall back to - the built-in
  // ADMIN_EMAIL/ADMIN_PASSWORD account is the break-glass login if Authentik is down.
  //
  // They keep the `crm-staff-` names they had before the Admin role, so prod doesn't replace them. The
  // aliases keep the names from when they were keyed on the email's local part.
  for (const email of args.admins) {
    const handle = email.replace(/@.*/, "");
    new DirectusUser(
      `crm-staff-${email}`,
      { ...auth, email, roleId: adminRole.roleId, provider: "authentik", externalIdentifier: email },
      { aliases: [{ name: `crm-staff-${handle}` }] },
    );
  }

  // Least privilege for the clubspot-sync job: no Data Studio access, and (per its permission rules
  // in stacks/backend/index.ts) write access to only the collections it syncs. The role is collection-agnostic
  // identity; the rules need the schema applied first, so they live in stacks/backend/.
  const clubspotSyncRole = new DirectusRole(
    "crm-clubspot-sync",
    {
      ...auth,
      name: "Clubspot Sync",
      icon: "sync",
      description: "Machine user for the clubspot-sync job. API-only, least privilege.",
      appAccess: false,
    },
    { dependsOn: readyForApiCalls },
  );

  // A machine user authenticated by a static token (`token`), not an interactive login - there is no
  // human to sign in as, so `provider: "default"` and no `externalIdentifier`.
  const clubspotSyncUser = new DirectusUser("crm-clubspot-sync-user", {
    ...auth,
    email: `clubspot-sync@${args.externalDomain}`,
    roleId: clubspotSyncRole.roleId,
    provider: "default",
    token: args.clubspotSyncToken,
  });

  // Same shape as clubspot-sync above, for the gsuite-sync job: no Data Studio access, and (per its
  // permission rules in stacks/backend/index.ts) read on what it maps from into Google Groups plus write on
  // sync_tasks/audit_findings only.
  const gsuiteSyncRole = new DirectusRole(
    "crm-gsuite-sync",
    {
      ...auth,
      name: "Gsuite Sync",
      icon: "sync",
      description: "Machine user for the gsuite-sync job. API-only, least privilege.",
      appAccess: false,
    },
    { dependsOn: readyForApiCalls },
  );

  const gsuiteSyncUser = new DirectusUser("crm-gsuite-sync-user", {
    ...auth,
    email: `gsuite-sync@${args.externalDomain}`,
    roleId: gsuiteSyncRole.roleId,
    provider: "default",
    token: args.gsuiteSyncToken,
  });

  return {
    communityRole,
    crewRole,
    adminRole,
    clubspotSyncRole,
    gsuiteSyncRole,
    clubspotSyncUser,
    gsuiteSyncUser,
  };
}
