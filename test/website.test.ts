import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const ofType = (type: string) => created.filter((r) => r.type === type);
const byName = (name: string) => created.find((r) => r.name === name)!;

const email = (accountId: string) => `${accountId}@example-project.iam.gserviceaccount.com`;
const member = `serviceAccount:${email("deploy-website")}`;
const poolName = "projects/123/locations/global/workloadIdentityPools/github";
const providerName = `${poolName}/providers/github`;
const orgId = "4242";
const repoId = 1717;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        let state = args.inputs;
        switch (args.type) {
          case "gcp:serviceaccount/account:Account":
            state = {
              ...args.inputs,
              email: email(args.inputs.accountId),
              name: `projects/example-project/serviceAccounts/${email(args.inputs.accountId)}`,
              member: `serviceAccount:${email(args.inputs.accountId)}`,
            };
            break;
          case "gcp:iam/workloadIdentityPool:WorkloadIdentityPool":
            state = { ...args.inputs, name: poolName };
            break;
          case "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider":
            state = { ...args.inputs, name: providerName };
            break;
          case "github:index/repository:Repository":
            state = { ...args.inputs, repoId };
            break;
          case "github:index/team:Team":
            return { id: "77", state: args.inputs };
        }
        return { id: `${args.name}_id`, state };
      },
      call: (args) =>
        args.token === "gcp:organizations/getProject:getProject"
          ? { ...args.inputs, number: "123456789" }
          : args.inputs,
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("github:owner", "cyc-seattle");
  pulumi.runtime.setConfig("bootstrap:githubOrgId", orgId);
  // The module builds its resources on import, so it loads only after the mocks are set.
  await import("../stacks/bootstrap/website.ts");
  await new Promise((r) => setImmediate(r));
});

describe("Firebase", () => {
  it("is added to the project through a provider that names it as the quota project", () => {
    expect(byName("firebase").inputs).toMatchObject({ project: "example-project" });
    expect(ofType("pulumi:providers:gcp").map((p) => p.inputs)).toEqual([
      expect.objectContaining({ billingProject: "example-project", userProjectOverride: "true" }),
    ]);
  });
});

describe("deploy-website", () => {
  const projectRoles = () =>
    ofType("gcp:projects/iAMMember:IAMMember")
      .filter((r) => r.inputs.member === member)
      .map((r) => r.inputs.role)
      .sort();

  it("holds only Hosting admin, the service usage reads the Firebase CLI makes, and the secret accessor", () => {
    expect(projectRoles()).toEqual([
      "roles/firebasehosting.admin",
      "roles/secretmanager.secretAccessor",
      "roles/serviceusage.apiKeysViewer",
      "roles/serviceusage.serviceUsageViewer",
    ]);
  });

  it("reads only the two csc-website Directus tokens", () => {
    const { condition } = byName("deploy-website-secretmanager.secretAccessor").inputs;
    expect(condition.expression).toBe(
      'resource.name.startsWith("projects/123456789/secrets/dev-csc-website-directus-token/") || ' +
        'resource.name.startsWith("projects/123456789/secrets/csc-website-directus-token/")',
    );
  });

  it("is assumed only by csc-website's three environments", () => {
    const bindings = ofType("gcp:serviceaccount/iAMMember:IAMMember")
      .filter((r) => r.inputs.role === "roles/iam.workloadIdentityUser")
      .map((r) => r.inputs.member)
      .sort();
    const subject = (env: string) =>
      `principal://iam.googleapis.com/${poolName}/subject/repo:cyc-seattle@${orgId}/csc-website@${repoId}:environment:${env}`;
    expect(bindings).toEqual(["dev", "prod", "publish"].map(subject).sort());
  });
});

describe("csc-website's environments", () => {
  const env = (name: string) => byName(`csc-website-${name}`).inputs;
  const policies = (name: string) =>
    ofType("github:index/repositoryEnvironmentDeploymentPolicy:RepositoryEnvironmentDeploymentPolicy")
      .filter((p) => p.inputs.environment === name)
      .map((p) => p.inputs.branchPattern);
  const variables = (name: string) =>
    Object.fromEntries(
      ofType("github:index/actionsEnvironmentVariable:ActionsEnvironmentVariable")
        .filter((v) => v.inputs.environment === name)
        .map((v) => [v.inputs.variableName, v.inputs.value]),
    );

  it("has exactly dev, prod, and publish", () => {
    expect(
      ofType("github:index/repositoryEnvironment:RepositoryEnvironment")
        .filter((e) => e.inputs.repository === "csc-website")
        .map((e) => e.inputs.environment)
        .sort(),
    ).toEqual(["dev", "prod", "publish"]);
  });

  it("lets dev deploy previews from any branch with no reviewer", () => {
    expect(env("dev").reviewers).toBeUndefined();
    expect(env("dev").deploymentBranchPolicy).toBeUndefined();
    expect(policies("dev")).toEqual([]);
  });

  it("limits prod to main, with a maintainer's approval", () => {
    expect(env("prod").reviewers).toEqual([{ teams: [77] }]);
    expect(policies("prod")).toEqual(["main"]);
  });

  it("limits publish to main, with no reviewer", () => {
    expect(env("publish").reviewers).toBeUndefined();
    expect(env("publish").deploymentBranchPolicy).toEqual({ protectedBranches: false, customBranchPolicies: true });
    expect(policies("publish")).toEqual(["main"]);
  });

  it("keeps admins from bypassing any of them", () => {
    for (const name of ["dev", "prod", "publish"]) {
      expect(env(name).canAdminsBypass).toBe(false);
    }
  });

  it.each([
    ["dev", "dev-csc-website-directus-token"],
    ["prod", "csc-website-directus-token"],
    ["publish", "csc-website-directus-token"],
  ])("points %s at deploy-website, the site, and %s", (name, secret) => {
    expect(variables(name)).toEqual({
      GCP_WORKLOAD_IDENTITY_PROVIDER: providerName,
      GCP_SERVICE_ACCOUNT: email("deploy-website"),
      FIREBASE_PROJECT: "example-project",
      FIREBASE_SITE: "csc-website",
      DIRECTUS_TOKEN_SECRET: secret,
    });
  });
});
