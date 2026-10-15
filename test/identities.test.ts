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
  await import("../stacks/bootstrap/deploy-runner.js");
  await import("../stacks/bootstrap/deploy-dev.js");
  await import("../stacks/bootstrap/gsuite-sync.js");
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

  it("views clusters, and holds Cloud SQL and Secret Manager roles only under conditions", () => {
    expect(projectMembers(member).sort()).toEqual([
      "roles/cloudsql.admin",
      "roles/container.clusterViewer",
      "roles/secretmanager.secretAccessor",
    ]);
    expect(grant("roles/container.clusterViewer").inputs.condition).toBeUndefined();
  });

  it("administers only the cyc-dev instance", () => {
    expect(grant("roles/cloudsql.admin").inputs.condition.expression).toBe(
      'resource.name == "projects/example-project/instances/cyc-dev" && resource.service == "sqladmin.googleapis.com"',
    );
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
      member:
        "principal://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/example-project.svc.id.goog/subject/ns/prod/sa/gsuite-sync",
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
