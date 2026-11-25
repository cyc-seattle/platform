import { familyPolicies, teamPolicies } from "./community-rules.ts";
import type { DirectusExtensions } from "./directus-files.ts";
import { engineFiles, engineVersion } from "./engine-files.ts";
import {
  crewRules,
  frozenPlansConfig,
  groupPolicies,
  groupPoliciesConfig,
  queryGuardConfig,
  sailTeamPolicy,
  WEBSITE_BUILD,
  websiteBuildRules,
  websitePublishConfig,
  type FrozenPlansConfig,
  type LoadedSchema,
  type PolicyData,
} from "./policies.ts";
import type { PermissionRuleInput } from "../../src/directus/client.ts";

// What the hooks are configured with, from the stack's config. The cluster deploy and the CI stack
// (scripts/ci-stack) both build Directus's extensions from it, so the two can't differ.

export interface ExtensionSettings {
  contactTo: string;
  formsOrigins: string[];
  externalDomain: string;
  formsPerIp: number;
  formsHostname: string;
  websitePublishAppId: string | undefined;
  frozenPlansDeletable: boolean;
}

export interface BackendPolicies {
  extensions: DirectusExtensions;
  frozenPlans: FrozenPlansConfig;
  /** The policies a group can give (docs/access.md). */
  grantable: PolicyData[];
  /** What the csc-website build reads (docs/access.md). */
  websiteBuild: PermissionRuleInput[];
}

export function backendPolicies(schemas: LoadedSchema[], settings: ExtensionSettings): BackendPolicies {
  const grantable = groupPolicies(schemas);
  const websiteBuild = websiteBuildRules(schemas);
  // The hook runs the engine when a Financial Plan is frozen, and records which engine it was.
  const engine = engineFiles();
  const frozenPlans = frozenPlansConfig(schemas, settings.frozenPlansDeletable, engineVersion(engine));
  return {
    grantable,
    websiteBuild,
    frozenPlans,
    extensions: {
      queryGuard: queryGuardConfig([
        ...familyPolicies,
        ...teamPolicies,
        { name: "Crew", rules: crewRules },
        { name: WEBSITE_BUILD, rules: websiteBuild },
        sailTeamPolicy,
        ...grantable,
      ]),
      groupPolicies: groupPoliciesConfig(grantable),
      frozenPlans,
      // Set once the GitHub App exists (docs/manual-setup.md §6).
      websitePublish: websitePublishConfig(schemas, settings.websitePublishAppId),
      forms: {
        to: settings.contactTo,
        allowedOrigins: settings.formsOrigins,
        siteUrl: `https://${settings.externalDomain}`,
        perIp: settings.formsPerIp,
      },
      formsHostname: settings.formsHostname,
      engine,
    },
  };
}
