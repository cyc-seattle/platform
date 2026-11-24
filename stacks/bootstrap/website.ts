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

/** The Directus token the site's builds read, prod's (#150). */
const directusTokenSecret = "csc-website-directus-token";

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

// The secret may not exist yet, so the grant is project-wide with a condition, not on the secret.
// The trailing slash matches the secret's versions and no other secret.
new gcp.projects.IAMMember(
  "deploy-website-secretmanager.secretAccessor",
  {
    project: projectId,
    role: "roles/secretmanager.secretAccessor",
    member: deployWebsite.member,
    condition: {
      title: "Only the csc-website Directus token",
      expression: projectNumber.apply(
        (number) => `resource.name.startsWith("projects/${number}/secrets/${directusTokenSecret}/")`,
      ),
    },
  },
  { deleteBeforeReplace: true },
);

interface WebsiteEnvironment {
  name: string;
  /** A maintainer must approve before the job starts. */
  approval: boolean;
}

// csc-website's workflows call the org's deploy.yml, the only workflow the WIF provider trusts, and
// its `deploy` task deploys the live site. It has no PR previews (cyc-seattle/csc-website#11), so no
// `dev`, and both environments deploy only from `main`.
const environments: WebsiteEnvironment[] = [
  // Code changes, after a maintainer approves.
  { name: "prod", approval: true },
  // Content changes from Directus and the nightly build, with no reviewer.
  { name: "publish", approval: false },
];

// The repo predates immutable OIDC subjects, so its tokens name it, like isthmia's.
const prefix = subjectPrefix("csc-website");

for (const env of environments) {
  const environment = new github.RepositoryEnvironment(`csc-website-${env.name}`, {
    repository: cscWebsite.name,
    environment: env.name,
    deploymentBranchPolicy: { protectedBranches: false, customBranchPolicies: true },
    reviewers: env.approval ? [{ teams: [maintainers.id.apply(Number)] }] : undefined,
    // One maintainer, so they approve their own deploy.
    preventSelfReview: false,
    // Admins could otherwise skip the branch rule and the approval.
    canAdminsBypass: false,
  });

  new github.RepositoryEnvironmentDeploymentPolicy(
    `csc-website-${env.name}-main`,
    { repository: cscWebsite.name, environment: environment.environment, branchPattern: "main" },
    { parent: environment },
  );

  // deploy.yml reads only these. csc-website's mise.toml sets the project, site and secret (#212).
  const variables = {
    GCP_WORKLOAD_IDENTITY_PROVIDER: provider.name,
    GCP_SERVICE_ACCOUNT: deployWebsite.email,
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
