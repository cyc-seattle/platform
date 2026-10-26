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
      call: (args) =>
        args.token === "gcp:organizations/getProject:getProject"
          ? { ...args.inputs, number: "123456789" }
          : args.inputs,
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("bootstrap:humanDeployers", JSON.stringify(["user:deployer@example.com"]));
  // The modules build their resources on import, so they load only after the mocks are set.
  await import("../stacks/bootstrap/deploy-runner.ts");
  await import("../stacks/bootstrap/deploy-dev.ts");
  await import("../stacks/bootstrap/gsuite-sync.ts");
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
  const member = `serviceAccount:${email("deploy-dev")}`;
  const grant = (role: string) =>
    ofType("gcp:projects/iAMMember:IAMMember").find((r) => r.inputs.member === member && r.inputs.role === role)!;

  it("views clusters, and reads secrets only under a condition", () => {
    expect(projectMembers(member).sort()).toEqual([
      "roles/container.clusterViewer",
      "roles/secretmanager.secretAccessor",
    ]);
    expect(grant("roles/container.clusterViewer").inputs.condition).toBeUndefined();
  });

  it("holds no Cloud SQL role, which ignores conditions on user and database calls", () => {
    expect(projectMembers(member).filter((role) => role.includes("cloudsql"))).toEqual([]);
  });

  it("reads only secrets whose IDs start with dev-", () => {
    expect(grant("roles/secretmanager.secretAccessor").inputs.condition.expression).toBe(
      'resource.name.startsWith("projects/123456789/secrets/dev-")',
    );
  });
});

describe("gsuite-sync", () => {
  it("can be impersonated by the gsuite-sync ServiceAccount in namespace prod only", () => {
    expect(byName("gsuite-sync-wif-prod").inputs).toEqual({
      serviceAccountId: `projects/example-project/serviceAccounts/${email("gsuite-sync")}`,
      role: "roles/iam.workloadIdentityUser",
      member: "serviceAccount:example-project.svc.id.goog[prod/gsuite-sync]",
    });
  });
});

describe("deploy-runner", () => {
  const member = `serviceAccount:${email("deploy-runner")}`;

  it("administers GKE and Certificate Manager", () => {
    expect(projectMembers(member)).toEqual(
      expect.arrayContaining(["roles/container.admin", "roles/certificatemanager.editor"]),
    );
  });

  it("edits alert policies and notification channels, and log metrics through its custom role", () => {
    expect(projectMembers(member)).toEqual(
      expect.arrayContaining(["roles/monitoring.alertPolicyEditor", "roles/monitoring.notificationChannelEditor"]),
    );
    expect(byName("deployer").inputs.permissions).toEqual(
      expect.arrayContaining(["logging.logMetrics.create", "logging.logMetrics.update", "logging.logMetrics.delete"]),
    );
    expect(projectMembers(member)).not.toContain("roles/logging.configWriter");
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
