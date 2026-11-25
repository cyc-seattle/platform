import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const instance = (name: string) =>
  created.find((r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance" && r.name === name)!.inputs;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        const selfLink = args.type === "gcp:compute/address:Address" ? { selfLink: `${args.name}_selfLink` } : {};
        const result =
          args.type === "random:index/randomPassword:RandomPassword" ? { result: `${args.name}_result` } : {};
        return { id: `${args.name}_id`, state: { ...args.inputs, ...selfLink, ...result } };
      },
      call: (args) => args.inputs,
    },
    "infra",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  // The module builds its resources on import, so it loads only after the mocks are set.
  await import("../stacks/infra/database.ts");
  await import("../stacks/infra/network.ts");
  await new Promise((r) => setImmediate(r));
});

describe("PostgresInstance", () => {
  it("is the only instance", () => {
    expect(created.filter((r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance").map((r) => r.name)).toEqual([
      "substrate",
    ]);
  });

  it("has no public IP", () => {
    expect(instance("substrate").settings.ipConfiguration).toMatchObject({
      ipv4Enabled: false,
      privateNetwork: "substrate_id",
    });
  });

  it("keeps backups with point-in-time recovery", () => {
    expect(instance("substrate").settings.backupConfiguration).toMatchObject({
      enabled: true,
      pointInTimeRecoveryEnabled: true,
      backupRetentionSettings: { retainedBackups: 30 },
    });
  });

  it("can't be deleted by accident", () => {
    expect(instance("substrate").deletionProtection).toBe(true);
  });
});

describe("the prod instance", () => {
  // Any change here is a change to prod's instance, which the infra preview must not show.
  it("keeps its inputs", () => {
    expect(instance("substrate")).toEqual({
      databaseVersion: "POSTGRES_16",
      region: "us-west1",
      settings: {
        edition: "ENTERPRISE",
        tier: "db-g1-small",
        availabilityType: "ZONAL",
        diskType: "PD_SSD",
        diskAutoresize: true,
        ipConfiguration: { ipv4Enabled: false, privateNetwork: "substrate_id" },
        backupConfiguration: {
          enabled: true,
          pointInTimeRecoveryEnabled: true,
          startTime: "09:00",
          transactionLogRetentionDays: 7,
          backupRetentionSettings: { retainedBackups: 30 },
        },
      },
      deletionProtection: true,
    });
  });
});

describe("the cluster's Cloud NAT", () => {
  const nat = () => created.find((r) => r.type === "gcp:compute/routerNat:RouterNat" && r.name === "cluster")!.inputs;

  it("sends egress from one reserved address, which the SMTP relay admits", () => {
    expect(created.find((r) => r.name === "cluster-nat")).toMatchObject({
      type: "gcp:compute/address:Address",
      inputs: { region: "us-west1", addressType: "EXTERNAL" },
    });
    expect(nat()).toMatchObject({ natIpAllocateOption: "MANUAL_ONLY", natIps: ["cluster-nat_selfLink"] });
  });

  it("serves only the cluster subnet", () => {
    expect(nat()).toMatchObject({
      sourceSubnetworkIpRangesToNat: "LIST_OF_SUBNETWORKS",
      subnetworks: [{ name: "cluster_id", sourceIpRangesToNats: ["ALL_IP_RANGES"] }],
    });
  });
});
