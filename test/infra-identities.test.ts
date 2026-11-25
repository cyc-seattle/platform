import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

const gkeNodes = { email: "gke-nodes@example-project.iam.gserviceaccount.com", member: "serviceAccount:gke-nodes" };

// A `--target` apply of bootstrap leaves an unknown output for each resource it didn't create.
const partial = { gkeNodes, deployWebsite: { email: pulumi.runtime.unknownValue } };

let knownAccount: typeof import("../stacks/infra/identities.ts").knownAccount;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => ({
        id: args.name,
        state: {
          outputs: args.name === "partial" ? partial : { gkeNodes, deployRunner: gkeNodes },
        },
      }),
      call: (args) => args.inputs,
    },
    "infra",
    "prod",
  );
  pulumi.runtime.setConfig("infra:bootstrapStack", "complete");
  ({ knownAccount } = await import("../stacks/infra/identities.ts"));
});

describe("infra identities", () => {
  it("reads an account from a complete bootstrap stack", async () => {
    const value = await new pulumi.StackReference("complete").requireOutputValue("gkeNodes");
    expect(knownAccount("gkeNodes", value)).toEqual(gkeNodes);
  });

  it("fails when any bootstrap output is unknown", async () => {
    const value = await new pulumi.StackReference("partial").requireOutputValue("gkeNodes");
    expect(value).toBeUndefined();
    expect(() => knownAccount("gkeNodes", value)).toThrow(/aren't all known/);
  });
});
