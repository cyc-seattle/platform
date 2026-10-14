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
        return { id: `${args.name}_id`, state: { ...args.inputs, ...selfLink } };
      },
      call: (args) => args.inputs,
    },
    "cloud",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  // The module builds its resources on import, so it loads only after the mocks are set.
  await import("../stacks/cloud/database.js");
  await import("../stacks/cloud/network.js");
  await new Promise((r) => setImmediate(r));
});

describe("PostgresInstance", () => {
  it.each(["substrate", "cyc-dev"])("%s has no public IP", (name: string) => {
    expect(instance(name).settings.ipConfiguration).toMatchObject({
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
  // Any change here is a change to prod's instance, which the cloud preview must not show.
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

describe("the dev instance", () => {
  it("is named cyc-dev, which isthmia's db-tunnel filter doesn't match", () => {
    expect(instance("cyc-dev").name).toBe("cyc-dev");
    expect(instance("cyc-dev").name).not.toMatch(/substrate/);
  });

  it("is the smallest shared-core tier", () => {
    expect(instance("cyc-dev").settings.tier).toBe("db-f1-micro");
  });

  it("keeps a week of daily backups and no point-in-time recovery", () => {
    expect(instance("cyc-dev").settings.backupConfiguration).toEqual({
      enabled: true,
      pointInTimeRecoveryEnabled: false,
      startTime: "09:00",
      backupRetentionSettings: { retainedBackups: 7 },
    });
  });

  it("can be deleted", () => {
    expect(instance("cyc-dev").deletionProtection).toBe(false);
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
