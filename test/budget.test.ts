import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const byName = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)!.inputs;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}_id`, state: args.inputs };
      },
      call: (args) =>
        args.token === "gcp:organizations/getProject:getProject"
          ? { ...args.inputs, billingAccount: "BILLING" }
          : args.inputs,
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  await import("../stacks/bootstrap/budget.ts");
  await new Promise((r) => setImmediate(r));
});

describe("monthly budget", () => {
  it("is $150 a month on the project's whole billing account", () => {
    const budget = byName("gcp:billing/budget:Budget", "monthly");
    expect(budget.billingAccount).toBe("BILLING");
    expect(budget.budgetFilter).toBeUndefined();
    expect(budget.amount).toEqual({ specifiedAmount: { currencyCode: "USD", units: "150" } });
  });

  it("warns at half, 90% and all of it spent, and when the forecast passes it", () => {
    expect(byName("gcp:billing/budget:Budget", "monthly").thresholdRules).toEqual([
      { thresholdPercent: 0.5 },
      { thresholdPercent: 0.9 },
      { thresholdPercent: 1.0 },
      { thresholdPercent: 1.0, spendBasis: "FORECASTED_SPEND" },
    ]);
  });
});
