import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

pulumi.runtime.setMocks(
  {
    newResource: ({ name, inputs }) => ({
      id: `${name}-id`,
      state: { ...inputs, roleId: `${name}-role`, policyId: `${name}-policy`, userId: `${name}-user` },
    }),
    call: ({ inputs }) => inputs,
  },
  "project",
  "stack",
  false,
);

let resources: typeof import("../src/directus/resources.ts");

beforeAll(async () => {
  resources = await import("../src/directus/resources.ts");
});

function value<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => output.apply(resolve));
}

// Type stripping turns `roleId!: Output<string>` into a field set to undefined after the constructor
// runs, which hides the output. `declare` erases it.
describe("the Directus resources' outputs", () => {
  const auth = { baseUrl: "https://directus.example.com", adminEmail: "a@example.com", adminPassword: "p" };

  it("carry a role's IDs", async () => {
    const role = new resources.DirectusRole("staff", { ...auth, name: "Staff", appAccess: true });
    expect(await value(role.roleId)).toBe("staff-role");
    expect(await value(role.policyId)).toBe("staff-policy");
  });

  it("carry a user's ID", async () => {
    const user = new resources.DirectusUser("user", {
      ...auth,
      email: "u@example.com",
      roleId: "r",
      provider: "default",
    });
    expect(await value(user.userId)).toBe("user-user");
  });
});
