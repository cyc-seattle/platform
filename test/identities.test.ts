import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const byName = (name: string) => created.find((r) => r.name === name)!;
const ofType = (type: string) => created.filter((r) => r.type === type);
const projectMembers = (member: string) =>
  ofType("gcp:projects/iAMMember:IAMMember")
    .filter((r) => r.inputs.member === member)
    .map((r) => r.inputs.role);

const email = (accountId: string) => `${accountId}@example-project.iam.gserviceaccount.com`;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        const state =
          args.type === "gcp:serviceaccount/account:Account"
            ? {
                ...args.inputs,
                name: `projects/example-project/serviceAccounts/${email(args.inputs.accountId)}`,
                member: `serviceAccount:${email(args.inputs.accountId)}`,
              }
            : args.inputs;
        return { id: `${args.name}_id`, state };
      },
      call: (args) => args.inputs,
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("bootstrap:humanDeployers", JSON.stringify(["user:deployer@example.com"]));
  // The modules build their resources on import, so they load only after the mocks are set.
  await import("../stacks/bootstrap/deploy-runner.js");
  await import("../stacks/bootstrap/deploy-dev.js");
  await new Promise((r) => setImmediate(r));
});

describe("gke-nodes", () => {
  it("holds only the default node service account role", () => {
    expect(projectMembers(`serviceAccount:${email("gke-nodes")}`)).toEqual([
      "roles/container.defaultNodeServiceAccount",
    ]);
  });
});

describe("deploy-dev", () => {
  it("views clusters and holds no other project role", () => {
    expect(projectMembers(`serviceAccount:${email("deploy-dev")}`)).toEqual(["roles/container.clusterViewer"]);
  });
});

describe("deploy-runner", () => {
  const member = `serviceAccount:${email("deploy-runner")}`;

  it("administers GKE and Certificate Manager", () => {
    expect(projectMembers(member)).toEqual(
      expect.arrayContaining(["roles/container.admin", "roles/certificatemanager.editor"]),
    );
  });

  it("can act as gke-nodes", () => {
    expect(byName("deploy-runner-user-gke-nodes").inputs).toEqual({
      serviceAccountId: `projects/example-project/serviceAccounts/${email("gke-nodes")}`,
      role: "roles/iam.serviceAccountUser",
      member,
    });
  });

  it("has no OS Admin Login, which is root on the VM", () => {
    expect(projectMembers(member)).not.toContain("roles/compute.osAdminLogin");
  });
});

describe("deployer role", () => {
  it("can't set a service account's IAM policy", () => {
    const { permissions } = byName("deployer").inputs;
    expect(permissions).not.toContain("iam.serviceAccounts.setIamPolicy");
    expect(permissions).toContain("iam.serviceAccounts.getIamPolicy");
  });
});
