import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const byType = (type: string) => created.filter((r) => r.type === type);

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}_id`, state: args.inputs };
      },
      call: (args) => args.inputs,
    },
    "cloud",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  // The module builds its resources on import, so it loads only after the mocks are set.
  await import("../stacks/cloud/database.js");
  await new Promise((r) => setImmediate(r));
});

describe("PostgresInstance", () => {
  const instance = () => byType("gcp:sql/databaseInstance:DatabaseInstance")[0]!.inputs;

  it("has no public IP", () => {
    expect(instance().settings.ipConfiguration).toMatchObject({ ipv4Enabled: false, privateNetwork: "substrate_id" });
  });

  it("keeps backups with point-in-time recovery", () => {
    expect(instance().settings.backupConfiguration).toMatchObject({
      enabled: true,
      pointInTimeRecoveryEnabled: true,
      backupRetentionSettings: { retainedBackups: 30 },
    });
  });

  it("can't be deleted by accident", () => {
    expect(instance().deletionProtection).toBe(true);
  });
});
