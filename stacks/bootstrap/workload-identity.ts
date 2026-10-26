import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { enableService } from "../../src/services.ts";

// Lets GitHub Actions jobs exchange their OIDC token for a service account's credentials (#215).
const iamApi = enableService("iam.googleapis.com");
const stsApi = enableService("sts.googleapis.com");
const iamCredentialsApi = enableService("iamcredentials.googleapis.com");
// A service account's calls bill the project itself, so the project lookups the stacks make (such as
// `getProject`, for the project number) need the API enabled here; a person's login works without it.
enableService("cloudresourcemanager.googleapis.com");

const owner = new pulumi.Config("github").require("owner");

/** The one workflow that may deploy: the org's reusable `deploy.yml`, at a release tag. */
export const deployWorkflowRef = `${owner}/.github/.github/workflows/deploy.yml@refs/tags/`;

/**
 * The CEL condition a token must meet. It pins the org by numeric ID, so a renamed or recreated org
 * can't match, and the calling workflow's ref, so only the org's tagged deploy workflow can assume
 * an identity.
 */
export function attributeCondition(orgId: string): string {
  // The ID goes into a CEL string literal, so anything but digits is refused.
  if (!/^[0-9]+$/.test(orgId)) {
    throw new Error(`Config "githubOrgId" must be the org's numeric ID, but holds ${JSON.stringify(orgId)}.`);
  }
  return `attribute.repository_owner_id == "${orgId}" && attribute.job_workflow_ref.startsWith("${deployWorkflowRef}")`;
}

export const pool = new gcp.iam.WorkloadIdentityPool(
  "github",
  { workloadIdentityPoolId: "github", displayName: "GitHub Actions" },
  { dependsOn: [iamApi, stsApi, iamCredentialsApi] },
);

export const provider = new gcp.iam.WorkloadIdentityPoolProvider("github", {
  workloadIdentityPoolId: pool.workloadIdentityPoolId,
  workloadIdentityPoolProviderId: "github",
  displayName: "GitHub Actions OIDC",
  oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
  attributeMapping: {
    "google.subject": "assertion.sub",
    "attribute.repository_owner_id": "assertion.repository_owner_id",
    "attribute.job_workflow_ref": "assertion.job_workflow_ref",
  },
  attributeCondition: attributeCondition(new pulumi.Config().require("githubOrgId")),
});

/**
 * A repository's OIDC `sub` prefix. A repository with immutable subjects names the org and itself by
 * numeric ID, so a renamed or recreated repository can't match (`gh api
 * repos/<owner>/<repo>/actions/oidc/customization/sub` shows which a repository uses).
 */
export function subjectPrefix(repository: string, repoId?: pulumi.Input<number>): pulumi.Output<string> {
  if (repoId === undefined) {
    return pulumi.output(`repo:${owner}/${repository}`);
  }
  const orgId = new pulumi.Config().require("githubOrgId");
  return pulumi.interpolate`repo:${owner}@${orgId}/${repository}@${repoId}`;
}

/** The principal for jobs of one repository running in one of its environments. */
export function environmentPrincipal(prefix: pulumi.Input<string>, environment: string): pulumi.Output<string> {
  return pulumi.interpolate`principal://iam.googleapis.com/${pool.name}/subject/${prefix}:environment:${environment}`;
}

/** Lets jobs of one repository, in one environment, run as a service account. */
export function allowEnvironment(
  account: gcp.serviceaccount.Account,
  accountLabel: string,
  repository: string,
  prefix: pulumi.Input<string>,
  environment: string,
): gcp.serviceaccount.IAMMember {
  return new gcp.serviceaccount.IAMMember(
    `${accountLabel}-wif-${repository}-${environment}`,
    {
      serviceAccountId: account.name,
      role: "roles/iam.workloadIdentityUser",
      member: environmentPrincipal(prefix, environment),
    },
    // An IAM member is read-modify-write against one shared policy (#153).
    { deleteBeforeReplace: true },
  );
}
