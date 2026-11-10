import * as gcp from "@pulumi/gcp";
import * as github from "@pulumi/github";
import { projectId } from "../../src/config.ts";
import { ServiceAccount } from "../../src/service-account.ts";
import { enableService } from "../../src/services.ts";
import { cscWebsite, maintainers } from "./github.ts";
import { allowEnvironment, provider, subjectPrefix } from "./workload-identity.ts";

// The public website, cyccommunitysailing.org, on Firebase Hosting (#150). This adds Firebase to the
// project and makes csc-website's deploy identity and environments. The infra stack declares the site.

const firebaseApi = enableService("firebase.googleapis.com");
const hostingApi = enableService("firebasehosting.googleapis.com");

/** The Hosting site the infra stack creates. Site IDs are global across Firebase. */
export const websiteSiteId = "csc-website";

// The Firebase API refuses a person's credentials unless the call names a quota project.
const firebaseProvider = new gcp.Provider("firebase", {
  project: projectId,
  billingProject: projectId,
  userProjectOverride: true,
});

// Firebase can't be removed from a project once added, so deleting this only forgets it.
export const firebaseProject = new gcp.firebase.Project(
  "firebase",
  { project: projectId },
  { provider: firebaseProvider, dependsOn: [firebaseApi, hostingApi], protect: true },
);

/** The Directus tokens the site's builds read: dev's for PR previews, prod's for live (#150). */
export const directusTokenSecrets = {
  dev: "dev-csc-website-directus-token",
  prod: "csc-website-directus-token",
};

export const deployWebsite = new ServiceAccount(
  "deploy-website",
  "Deploys cyc-seattle/csc-website to Firebase Hosting.",
);

// Hosting has no per-site IAM and no custom roles, so this account can deploy to, create, or delete
// any Hosting site in the project. Keeping csc-website the project's only site is what limits it.
for (const role of [
  "roles/firebasehosting.admin",
  "roles/serviceusage.serviceUsageViewer",
  "roles/serviceusage.apiKeysViewer",
]) {
  new gcp.projects.IAMMember(
    `deploy-website-${role.replace("roles/", "")}`,
    { project: projectId, role, member: deployWebsite.member },
    { deleteBeforeReplace: true },
  );
}

// Secret Manager names a secret by the project's number, not its ID.
const projectNumber = gcp.organizations.getProjectOutput({ projectId }).number;

// The secrets may not exist yet, so the grant is project-wide with a condition, not on each secret.
// The trailing slash matches the secret's versions and no other secret.
new gcp.projects.IAMMember(
  "deploy-website-secretmanager.secretAccessor",
  {
    project: projectId,
    role: "roles/secretmanager.secretAccessor",
    member: deployWebsite.member,
    condition: {
      title: "Only the csc-website Directus tokens",
      expression: projectNumber.apply((number) =>
        Object.values(directusTokenSecrets)
          .map((secret) => `resource.name.startsWith("projects/${number}/secrets/${secret}/")`)
          .join(" || "),
      ),
    },
  },
  { deleteBeforeReplace: true },
);

interface WebsiteEnvironment {
  name: string;
  /** Deploys only from `main`. `dev` takes PR branches. */
  mainOnly: boolean;
  /** A maintainer must approve before the job starts. */
  approval: boolean;
  directusTokenSecret: string;
}

// csc-website's workflows call the org's deploy.yml, the only workflow the WIF provider trusts, and
// its `deploy` task deploys `dev` to a PR's preview channel and the others live. All three assume
// deploy-website, which IAM can't limit to a channel, so only the branch rules keep `dev` off the
// live site. A fork's PR gets no OIDC token.
const environments: WebsiteEnvironment[] = [
  { name: "dev", mainOnly: false, approval: false, directusTokenSecret: directusTokenSecrets.dev },
  // Code changes, after a maintainer approves.
  { name: "prod", mainOnly: true, approval: true, directusTokenSecret: directusTokenSecrets.prod },
  // Content changes from Directus and the nightly build, with no reviewer.
  { name: "publish", mainOnly: true, approval: false, directusTokenSecret: directusTokenSecrets.prod },
];

// A reviewer team needs access to the repository.
new github.TeamRepository("csc-website-maintainers", {
  teamId: maintainers.id,
  repository: cscWebsite.name,
  permission: "pull",
});

const prefix = subjectPrefix("csc-website", cscWebsite.repoId);

for (const env of environments) {
  const environment = new github.RepositoryEnvironment(`csc-website-${env.name}`, {
    repository: cscWebsite.name,
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
      `csc-website-${env.name}-main`,
      { repository: cscWebsite.name, environment: environment.environment, branchPattern: "main" },
      { parent: environment },
    );
  }

  const variables = {
    GCP_WORKLOAD_IDENTITY_PROVIDER: provider.name,
    GCP_SERVICE_ACCOUNT: deployWebsite.email,
    FIREBASE_PROJECT: firebaseProject.project,
    FIREBASE_SITE: websiteSiteId,
    DIRECTUS_TOKEN_SECRET: env.directusTokenSecret,
  };
  for (const [variableName, value] of Object.entries(variables)) {
    new github.ActionsEnvironmentVariable(
      `csc-website-${env.name}-${variableName.toLowerCase().replace(/_/g, "-")}`,
      { repository: cscWebsite.name, environment: environment.environment, variableName, value },
      { parent: environment },
    );
  }

  allowEnvironment(deployWebsite, "deploy-website", "csc-website", prefix, env.name);
}
