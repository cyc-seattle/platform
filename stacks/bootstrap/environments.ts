import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as github from "@pulumi/github";
import { deployDev } from "./deploy-dev.ts";
import { deployRunner } from "./deploy-runner.ts";
import { isthmia, maintainers, platform } from "./github.ts";
import { stateBackends } from "./state.ts";
import { allowEnvironment, provider, subjectPrefix } from "./workload-identity.ts";

// The GitHub environments a deploy job runs in, and the identity each one assumes (#215). An
// environment's name is the last part of the token's subject, so the WIF binding and the environment
// together decide who can deploy where.

interface Environment {
  name: string;
  account: gcp.serviceaccount.Account;
  accountLabel: string;
  backendUrl: pulumi.Input<string>;
  /** Deploys only from `main`. `dev` takes PR branches. */
  mainOnly: boolean;
  /** A maintainer must approve before the job starts. */
  approval: boolean;
}

const environments: Environment[] = [
  {
    name: "dev",
    account: deployDev,
    accountLabel: "deploy-dev",
    backendUrl: stateBackends.dev.url,
    mainOnly: false,
    approval: false,
  },
  {
    name: "prod-preview",
    account: deployRunner,
    accountLabel: "deploy-runner",
    backendUrl: stateBackends.prod.url,
    mainOnly: true,
    approval: false,
  },
  {
    name: "prod",
    account: deployRunner,
    accountLabel: "deploy-runner",
    backendUrl: stateBackends.prod.url,
    mainOnly: true,
    approval: true,
  },
];

// platform was created with immutable OIDC subjects; isthmia predates them.
const repositories = [
  { name: "isthmia", resource: isthmia, prefix: subjectPrefix("isthmia") },
  { name: "platform", resource: platform, prefix: subjectPrefix("platform", platform.repoId) },
];

for (const { name: repo, resource, prefix } of repositories) {
  // A reviewer team needs access to the repository.
  new github.TeamRepository(`${repo}-maintainers`, {
    teamId: maintainers.id,
    repository: resource.name,
    permission: "pull",
  });

  for (const env of environments) {
    const environment = new github.RepositoryEnvironment(`${repo}-${env.name}`, {
      repository: resource.name,
      environment: env.name,
      deploymentBranchPolicy: env.mainOnly ? { protectedBranches: false, customBranchPolicies: true } : undefined,
      reviewers: env.approval ? [{ teams: [maintainers.id.apply(Number)] }] : undefined,
      // One maintainer, so they approve their own deploy.
      preventSelfReview: false,
      // Admins could otherwise skip the branch rule and the approval.
      canAdminsBypass: false,
    });

    if (env.mainOnly) {
      new github.RepositoryEnvironmentDeploymentPolicy(
        `${repo}-${env.name}-main`,
        { repository: resource.name, environment: environment.environment, branchPattern: "main" },
        { parent: environment },
      );
    }

    const variables = {
      GCP_WORKLOAD_IDENTITY_PROVIDER: provider.name,
      GCP_SERVICE_ACCOUNT: env.account.email,
      PULUMI_BACKEND_URL: env.backendUrl,
    };
    for (const [variableName, value] of Object.entries(variables)) {
      new github.ActionsEnvironmentVariable(
        `${repo}-${env.name}-${variableName.toLowerCase().replace(/_/g, "-")}`,
        { repository: resource.name, environment: environment.environment, variableName, value },
        { parent: environment },
      );
    }

    // Both prod environments share deploy-runner, so a binding per (repo, environment) pair.
    allowEnvironment(env.account, env.accountLabel, repo, prefix, env.name);
  }
}
