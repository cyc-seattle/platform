import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Registered {
  type: string;
  name: string;
  inputs: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const resources: Registered[] = [];
const lookups: Record<string, unknown>[] = [];

// Made-up accounts: one admin with an active account, one who hasn't signed in yet.
const accounts: Record<string, { pk: number }[]> = {
  "admin-b@example.test": [{ pk: 42 }],
  "admin-a@example.test": [{ pk: 7 }],
  "new-admin@example.test": [],
};

pulumi.runtime.setMocks(
  {
    newResource: ({ type, name, inputs }) => {
      resources.push({ type, name, inputs });
      return { id: `${name}-id`, state: inputs };
    },
    call: ({ token, inputs }) => {
      if (token === "authentik:index/getUsers:getUsers") {
        lookups.push(inputs);
        return { ...inputs, id: "users", users: accounts[inputs["email"] as string] ?? [] };
      }
      return inputs;
    },
  },
  "authentik",
  "dev",
  false,
);

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

let group: Registered;

beforeAll(async () => {
  // Imported after setMocks, since the modules read the stack name when they load.
  const authentik = await import("@pulumi/authentik");
  const { adminGroup } = await import("../stacks/authentik/admins.ts");
  const provider = new authentik.Provider("authentik", { url: "https://login.example.test", token: "token" });
  adminGroup(Object.keys(accounts), { provider });
  await settle();
  group = resources.find((r) => r.type === "authentik:index/group:Group")!;
});

describe("adminGroup", () => {
  it("makes Directus's admins Authentik superusers, so they can impersonate", () => {
    expect(group.name).toBe("admins");
    expect(group.inputs).toMatchObject({ name: "Admins", isSuperuser: true });
  });

  it("finds each admin's account by email, only once it's active", () => {
    expect(lookups.map(({ email, isActive }) => ({ email, isActive }))).toEqual(
      Object.keys(accounts).map((email) => ({ email, isActive: true })),
    );
  });

  it("adds the admins who have an account, in a stable order, and skips those who don't", () => {
    expect(group.inputs["users"]).toEqual([7, 42]);
  });
});
