import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

const secrets: { name: string; inputs: any }[] = [];
const reads: string[] = [];

beforeAll(async () => {
  await pulumi.runtime.setMocks({
    newResource: (args) => {
      if (args.type === "github:index/actionsSecret:ActionsSecret") secrets.push(args);
      return { id: `${args.name}_id`, state: { ...args.inputs, name: args.inputs.name ?? args.name } };
    },
    call: (args) => {
      reads.push(args.inputs.secret);
      return { ...args.inputs, secretData: "license" };
    },
  });
  pulumi.runtime.setConfig("github:owner", "cyc-seattle");
  // The module builds its resources on import, so it loads only after the mocks are set.
  await import("../stacks/bootstrap/directus-license.ts");
  await new Promise((r) => setImmediate(r));
});

describe("DIRECTUS_LICENSE_KEY", () => {
  it("goes to each repo whose integration-ci runs a licensed Directus", () => {
    expect(secrets.map((s) => s.inputs.repository).sort()).toEqual(["platform", "sail-team"]);
    for (const { inputs } of secrets) expect(inputs.secretName).toBe("DIRECTUS_LICENSE_KEY");
  });

  it("is prod's license key, from Secret Manager", () => {
    expect(reads).toEqual(["directus-license-key"]);
  });
});
