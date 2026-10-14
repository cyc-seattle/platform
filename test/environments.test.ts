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
const poolName = "projects/123/locations/global/workloadIdentityPools/github";
const providerName = `${poolName}/providers/github`;
const orgId = "4242";

let wif: typeof import("../stacks/bootstrap/workload-identity.js");

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
            state = { ...args.inputs, repoId: args.inputs.name === "platform" ? 4242 : 1717 };
            break;
          case "github:index/team:Team":
            return { id: "77", state: args.inputs };
          case "github:index/repositoryEnvironment:RepositoryEnvironment":
            state = { ...args.inputs, environment: args.inputs.environment };
            break;
        }
        return { id: `${args.name}_id`, state };
      },
      call: (args) => args.inputs,
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("github:owner", "cyc-seattle");
  pulumi.runtime.setConfig("bootstrap:githubOrgId", orgId);
  pulumi.runtime.setConfig("bootstrap:humanDeployers", JSON.stringify(["user:deployer@example.com"]));
  // The modules build their resources on import, so they load only after the mocks are set.
  wif = await import("../stacks/bootstrap/workload-identity.js");
  await import("../stacks/bootstrap/environments.js");
  await new Promise((r) => setImmediate(r));
});

describe("the github Workload Identity provider", () => {
  it("trusts GitHub's OIDC issuer, in a pool named github", () => {
    const pool = ofType("gcp:iam/workloadIdentityPool:WorkloadIdentityPool");
    expect(pool.map((p) => p.inputs.workloadIdentityPoolId)).toEqual(["github"]);
    expect(ofType("gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider")[0]!.inputs).toMatchObject({
      workloadIdentityPoolProviderId: "github",
      oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
    });
  });

  it("maps the subject, and the attributes its condition reads", () => {
    const provider = ofType("gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider")[0]!;
    expect(provider.inputs.attributeMapping).toEqual({
      "google.subject": "assertion.sub",
      "attribute.repository_owner_id": "assertion.repository_owner_id",
      "attribute.job_workflow_ref": "assertion.job_workflow_ref",
    });
  });

  it("admits only the org's tagged deploy workflow", () => {
    const { attributeCondition } = ofType("gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider")[0]!
      .inputs;
    expect(attributeCondition).toBe(
      'attribute.repository_owner_id == "4242" && ' +
        'attribute.job_workflow_ref.startsWith("cyc-seattle/.github/.github/workflows/deploy.yml@refs/tags/")',
    );
    expect(attributeCondition).toBe(wif.attributeCondition(orgId));
  });

  it("refuses an org ID that isn't a number", () => {
    expect(() => wif.attributeCondition('1" || true || "')).toThrow(/numeric ID/);
    expect(() => wif.attributeCondition("")).toThrow(/numeric ID/);
  });
});

describe("workload identity bindings", () => {
  const bindings = (account: string) =>
    ofType("gcp:serviceaccount/iAMMember:IAMMember")
      .filter((r) => r.inputs.serviceAccountId === `projects/example-project/serviceAccounts/${email(account)}`)
      .filter((r) => r.inputs.role === "roles/iam.workloadIdentityUser")
      .map((r) => r.inputs.member)
      .sort();
  // platform uses immutable subjects (its numeric IDs); isthmia uses names.
  const prefix = (repo: string) =>
    repo === "platform" ? `repo:cyc-seattle@${orgId}/platform@4242` : `repo:cyc-seattle/${repo}`;
  const subject = (repo: string, env: string) =>
    `principal://iam.googleapis.com/${poolName}/subject/${prefix(repo)}:environment:${env}`;

  it("lets dev's environment on isthmia and platform assume deploy-dev, and nothing else", () => {
    expect(bindings("deploy-dev")).toEqual([subject("isthmia", "dev"), subject("platform", "dev")].sort());
  });

  it("lets the prod environments on isthmia and platform assume deploy-runner, and nothing else", () => {
    expect(bindings("deploy-runner")).toEqual(
      ["isthmia", "platform"].flatMap((repo) => ["prod", "prod-preview"].map((env) => subject(repo, env))).sort(),
    );
  });

  it("binds each subject exactly, with no wildcard", () => {
    for (const member of [...bindings("deploy-dev"), ...bindings("deploy-runner")]) {
      expect(member).not.toContain("*");
      expect(member).not.toMatch(/\/attribute\.|\/group\//);
    }
  });
});

describe("the maintainers team", () => {
  it("is created with no members", () => {
    expect(ofType("github:index/team:Team").map((t) => t.inputs.name)).toEqual(["maintainers"]);
    expect(ofType("github:index/teamMembers:TeamMembers")).toEqual([]);
    expect(ofType("github:index/teamMembership:TeamMembership")).toEqual([]);
  });
});

describe.each(["isthmia", "platform"])("%s's environments", (repo) => {
  const env = (name: string) => byName(`${repo}-${name}`).inputs;
  const policies = (name: string) =>
    ofType("github:index/repositoryEnvironmentDeploymentPolicy:RepositoryEnvironmentDeploymentPolicy")
      .filter((p) => p.inputs.repository === repo && p.inputs.environment === name)
      .map((p) => p.inputs);
  const variables = (name: string) =>
    Object.fromEntries(
      ofType("github:index/actionsEnvironmentVariable:ActionsEnvironmentVariable")
        .filter((v) => v.inputs.repository === repo && v.inputs.environment === name)
        .map((v) => [v.inputs.variableName, v.inputs.value]),
    );

  it("has exactly dev, prod-preview, and prod", () => {
    const names = ofType("github:index/repositoryEnvironment:RepositoryEnvironment")
      .filter((e) => e.inputs.repository === repo)
      .map((e) => e.inputs.environment);
    expect(names.sort()).toEqual(["dev", "prod", "prod-preview"]);
  });

  it("lets dev deploy from any branch with no reviewer", () => {
    expect(env("dev").reviewers).toBeUndefined();
    expect(env("dev").deploymentBranchPolicy).toBeUndefined();
    expect(policies("dev")).toEqual([]);
  });

  it("limits prod-preview to main, with no reviewer", () => {
    expect(env("prod-preview").reviewers).toBeUndefined();
    expect(env("prod-preview").deploymentBranchPolicy).toEqual({
      protectedBranches: false,
      customBranchPolicies: true,
    });
    expect(policies("prod-preview")).toEqual([expect.objectContaining({ branchPattern: "main" })]);
  });

  it("limits prod to main, and lets the one maintainer approve their own deploy", () => {
    expect(env("prod").reviewers).toEqual([{ teams: [77] }]);
    expect(env("prod").preventSelfReview).toBe(false);
    expect(env("prod").deploymentBranchPolicy).toEqual({ protectedBranches: false, customBranchPolicies: true });
    expect(policies("prod")).toEqual([expect.objectContaining({ branchPattern: "main" })]);
  });

  it("keeps admins from bypassing a protected environment", () => {
    expect(env("prod").canAdminsBypass).toBe(false);
    expect(env("prod-preview").canAdminsBypass).toBe(false);
  });

  it("points dev at deploy-dev and dev's state bucket", () => {
    expect(variables("dev")).toEqual({
      GCP_WORKLOAD_IDENTITY_PROVIDER: providerName,
      GCP_SERVICE_ACCOUNT: email("deploy-dev"),
      PULUMI_BACKEND_URL: "gs://example-project-pulumi-dev",
    });
  });

  it.each(["prod-preview", "prod"])("points %s at deploy-runner and prod's state bucket", (name) => {
    expect(variables(name)).toEqual({
      GCP_WORKLOAD_IDENTITY_PROVIDER: providerName,
      GCP_SERVICE_ACCOUNT: email("deploy-runner"),
      PULUMI_BACKEND_URL: "gs://example-project-pulumi-prod",
    });
  });
});
