import { describe, it, expect, vi, afterEach } from "vitest";
import {
  omitUndefined,
  directusAccessProvider,
  directusPolicyProvider,
  directusPresetProvider,
  directusRoleProvider,
  directusSettingsProvider,
  directusUserProvider,
  savedVersionsCheckProvider,
} from "../src/directus/resources.ts";
import { describeProviderError, DirectusHttpError } from "../src/directus/client.ts";

const baseUrl = "https://directus.example.com";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function stubLogin(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { access_token: "test-token" } })); // POST /auth/login
}

const auth = { baseUrl, adminEmail: "admin@example.com", adminPassword: "hunter2" };

describe("omitUndefined", () => {
  it("drops keys whose value is undefined", () => {
    expect(omitUndefined({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("keeps null and falsy-but-defined values", () => {
    expect(omitUndefined({ a: null, b: false, c: 0, d: "" })).toEqual({ a: null, b: false, c: 0, d: "" });
  });

  it("leaves an object with no undefined values unchanged", () => {
    const obj = { a: 1, b: "x" };
    expect(omitUndefined(obj)).toEqual(obj);
  });
});

describe("describeProviderError", () => {
  it("carries a plain Error's message, tagged with the resource and method", () => {
    const result = describeProviderError("DirectusRole", "create", new Error("boom"));
    expect(result.message).toContain("DirectusRole.create");
    expect(result.message).toContain("boom");
  });

  it("carries a DirectusHttpError's message and status", () => {
    const result = describeProviderError("DirectusUser", "update", new DirectusHttpError(404, "not found"));
    expect(result.message).toContain("not found");
    expect(result.message).toContain("404");
  });

  it("falls back to String(error) for an object with no message", () => {
    const result = describeProviderError("DirectusPermissionRule", "diff", { foo: "bar" });
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).toContain("DirectusPermissionRule.diff");
  });

  it("falls back to String(error) for a thrown undefined — the case that was previously invisible", () => {
    const result = describeProviderError("DirectusPolicy", "delete", undefined);
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).toContain("DirectusPolicy.delete");
  });
});

describe("DirectusRole.delete", () => {
  const props = { ...auth, name: "Crew", appAccess: true, roleId: "role-1", policyId: "policy-1" };

  it("treats an already-gone access row, role, and policy as success (cyc-seattle/isthmia#125)", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] })); // GET /users: none
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "access-1" }] })); // GET /access
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { errors: [{ message: "not found" }] })); // DELETE /access/access-1
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { errors: [{ message: "not found" }] })); // DELETE /roles/role-1
    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined)); // DELETE /policies/policy-1
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusRoleProvider.delete?.("role-1", props)).resolves.toBeUndefined();
  });

  it("still throws on a non-404 failure", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] })); // GET /users: none
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] })); // GET /access: none
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { errors: [{ message: "forbidden" }] })); // DELETE /roles/role-1
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusRoleProvider.delete?.("role-1", props)).rejects.toThrow(/403/);
  });

  it("refuses while a user still has the role, since Directus would leave them with none", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "user-1" }] })); // GET /users
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusRoleProvider.delete?.("role-1", props)).rejects.toThrow(/Crew role still has 1 user/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});

describe("DirectusRole with a fixed ID", () => {
  it("creates the role with that ID", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: "pong" })); // GET /server/ping
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: "policy-1" } })); // POST /policies
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: "role-1" } })); // POST /roles
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 1 } })); // POST /access
    vi.stubGlobal("fetch", fetchMock);

    const result = await directusRoleProvider.create({
      ...auth,
      name: "Community",
      appAccess: false,
      fixedRoleId: "role-1",
    });

    const [, rolesInit] = fetchMock.mock.calls[3] as [string, { body: string }];
    expect(JSON.parse(rolesInit.body)).toMatchObject({ id: "role-1", name: "Community" });
    expect(result).toMatchObject({ id: "role-1", outs: { roleId: "role-1", policyId: "policy-1" } });
  });

  it("creates a role without one with no ID", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: "pong" }));
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: "policy-1" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: "role-2" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await directusRoleProvider.create({ ...auth, name: "Crew", appAccess: true });

    const [, rolesInit] = fetchMock.mock.calls[3] as [string, { body: string }];
    expect(JSON.parse(rolesInit.body)).not.toHaveProperty("id");
  });
});

describe("DirectusRole.diff", () => {
  const olds = { ...auth, name: "Crew", appAccess: true, roleId: "role-1", policyId: "policy-1" };

  it("ignores the provider's own code, so editing it updates no role", async () => {
    const news = { ...auth, name: "Crew", appAccess: true, __provider: "edited" };
    await expect(directusRoleProvider.diff?.("role-1", olds, news)).resolves.toEqual({ changes: false, replaces: [] });
  });

  it("updates a renamed role in place", async () => {
    const news = { ...auth, name: "Crew 2", appAccess: true };
    await expect(directusRoleProvider.diff?.("role-1", olds, news)).resolves.toEqual({ changes: true, replaces: [] });
  });

  it("replaces a role whose fixed ID changes", async () => {
    const news = { ...auth, name: "Crew", appAccess: true, fixedRoleId: "role-2" };
    await expect(directusRoleProvider.diff?.("role-1", olds, news)).resolves.toEqual({
      changes: true,
      replaces: ["fixedRoleId"],
    });
  });
});

describe("DirectusUser.diff", () => {
  const olds = { ...auth, email: "a@b.com", roleId: "role-1", provider: "authentik", userId: "user-1" };

  it("ignores the provider's own code", async () => {
    const news = { ...auth, email: "a@b.com", roleId: "role-1", provider: "authentik", __provider: "edited" };
    await expect(directusUserProvider.diff?.("user-1", olds, news)).resolves.toEqual({ changes: false });
  });

  it("updates a user whose role changes", async () => {
    const news = { ...auth, email: "a@b.com", roleId: "role-2", provider: "authentik" };
    await expect(directusUserProvider.diff?.("user-1", olds, news)).resolves.toEqual({ changes: true });
  });
});

describe("DirectusUser.delete", () => {
  const props = { ...auth, email: "a@b.com", roleId: "role-1", provider: "google", userId: "user-1", adopted: false };

  it("treats an already-gone user as success (cyc-seattle/isthmia#125)", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { errors: [{ message: "not found" }] })); // DELETE /users/user-1
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusUserProvider.delete?.("user-1", props)).resolves.toBeUndefined();
  });

  it("treats a 403 as success, since Directus answers 403 rather than 404 for a missing user (cyc-seattle/isthmia#125)", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { errors: [{ message: "forbidden" }] })); // DELETE /users/user-1
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusUserProvider.delete?.("user-1", props)).resolves.toBeUndefined();
  });

  it("still throws on a non-404/403 failure", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { errors: [{ message: "server error" }] })); // DELETE /users/user-1
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusUserProvider.delete?.("user-1", props)).rejects.toThrow(/500/);
  });
});

describe("DirectusSettings", () => {
  const settings = { mcp_enabled: true, mcp_allow_deletes: false };

  it("patches only the fields it's given", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: "pong" })); // GET /server/ping
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: settings })); // PATCH /settings
    vi.stubGlobal("fetch", fetchMock);

    await directusSettingsProvider.create({ ...auth, settings });

    const [url, init] = fetchMock.mock.calls[2]!;
    expect(url).toBe(`${baseUrl}/settings`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(settings);
  });

  it("leaves the settings alone on delete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await directusSettingsProvider.delete?.("settings", { ...auth, settings });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DirectusPolicy with no role", () => {
  it("creates only the policy, which groups give to users", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: "pong" })); // GET /server/ping
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: "policy-1" } })); // POST /policies
    vi.stubGlobal("fetch", fetchMock);

    const result = await directusPolicyProvider.create({ ...auth, name: "CRM Writer" });
    expect(result.outs).toMatchObject({ policyId: "policy-1" });
    expect(result.outs.accessId).toBeUndefined();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/access"))).toEqual([]);
  });
});

describe("DirectusAccess", () => {
  it("links a policy to a role, and replaces the link when either changes", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: "pong" })); // GET /server/ping
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: "access-1" } })); // POST /access
    vi.stubGlobal("fetch", fetchMock);

    const result = await directusAccessProvider.create({ ...auth, roleId: "crew", policyId: "names" });
    expect(result.outs).toMatchObject({ accessId: "access-1" });
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(init.body)).toEqual({ role: "crew", policy: "names" });

    const diff = await directusAccessProvider.diff?.("access-1", result.outs, {
      ...auth,
      roleId: "admin",
      policyId: "names",
    });
    expect(diff).toMatchObject({ changes: true, replaces: ["roleId"] });
  });
});

describe("SavedVersionsCheck", () => {
  const inputs = { ...auth, fingerprint: "abc", schemaHash: "def" };
  const ready = { fingerprint: "abc", tables: { plans: true }, indexes: { cyc_one_program_area_plan: true } };

  it.each(["create", "update"] as const)("checks the triggers on %s", async (method) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, "pong")); // GET /server/ping
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ready));
    vi.stubGlobal("fetch", fetchMock);
    const run =
      method === "create"
        ? savedVersionsCheckProvider.create!(inputs)
        : savedVersionsCheckProvider.update!("saved-versions", inputs, inputs);
    await expect(run).resolves.toMatchObject({ outs: inputs });
    expect(fetchMock).toHaveBeenLastCalledWith(`${baseUrl}/saved-versions/status`, expect.anything());
  });

  it("fails the deploy, naming the provider, when a trigger is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, "pong"));
    stubLogin(fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(200, { ...ready, tables: { plans: false } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(savedVersionsCheckProvider.create!({ ...inputs, timeoutMs: 50, intervalMs: 10 })).rejects.toThrow(
      /SavedVersionsCheck.create failed: .*plans has no trigger/,
    );
  });
});

describe("DirectusPreset", () => {
  const view = { collection: "camps", sort: ["-start_date"], fields: ["name", "start_date"] };

  function stubCreate(existing: { id: number }[]) {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: "pong" })); // GET /server/ping
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: existing })); // GET /presets
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 7 } })); // POST or PATCH /presets
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("creates the collection's global preset, for no user, role, or bookmark", async () => {
    const fetchMock = stubCreate([]);

    const result = await directusPresetProvider.create({ ...auth, ...view });

    expect(result.outs).toMatchObject({ presetId: 7 });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`${baseUrl}/presets`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      collection: "camps",
      user: null,
      role: null,
      bookmark: null,
      layout: "tabular",
      layout_query: { tabular: { sort: ["-start_date"], fields: ["name", "start_date"], page: 1 } },
      filter: null,
    });
  });

  it("takes over a global preset an admin already saved, rather than adding a second", async () => {
    const fetchMock = stubCreate([{ id: 3 }]);

    const result = await directusPresetProvider.create({ ...auth, ...view });

    expect(result.outs).toMatchObject({ presetId: 3 });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`${baseUrl}/presets/3`);
    expect(init.method).toBe("PATCH");
  });

  it("updates in place, and replaces only when the collection changes", async () => {
    const olds = { ...auth, ...view, presetId: 3 };
    expect(await directusPresetProvider.diff?.("3", olds, { ...auth, ...view })).toMatchObject({ changes: false });
    expect(await directusPresetProvider.diff?.("3", olds, { ...auth, ...view, sort: ["name"] })).toMatchObject({
      changes: true,
      replaces: [],
    });
    expect(await directusPresetProvider.diff?.("3", olds, { ...auth, ...view, collection: "sessions" })).toMatchObject({
      changes: true,
      replaces: ["collection"],
    });
  });

  it("treats an already-gone preset as deleted", async () => {
    const fetchMock = vi.fn();
    stubLogin(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { errors: [] })); // DELETE /presets/3
    vi.stubGlobal("fetch", fetchMock);

    await expect(directusPresetProvider.delete?.("3", { ...auth, ...view, presetId: 3 })).resolves.toBeUndefined();
  });
});
