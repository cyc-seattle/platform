import { describe, expect, it } from "vitest";
import { guard, REFUSED, type Lookup, type Version, type Write } from "../stacks/backend/saved-versions.cjs";

const versions: Record<string, Version> = {
  draft: { id: "draft", plan_id: "plan", status: "draft", platform_version: null },
  saved: { id: "saved", plan_id: "plan", status: "saved", platform_version: "1.4.0" },
  other: { id: "other", plan_id: "other-plan", status: "saved", platform_version: "1.4.0" },
};
// Each offering is named for the version it belongs to.
const config = { versioned: ["plan_offerings"], deletable: false };

function lookup(deletesSaved = false): Lookup {
  return {
    versionIds: async (_, keys) => keys,
    versions: async (ids) => ids.map((id) => versions[id]!).filter(Boolean),
    deletesSaved: async () => deletesSaved,
  };
}

const now = "2027-01-01T00:00:00.000Z";
const check = (write: Omit<Write, "now">, deletesSaved = false) =>
  guard({ user: "planner", ...write, now }, config, lookup(deletesSaved));

describe("the saved-versions hook", () => {
  describe("a saved version", () => {
    it("can't be changed, or turned back into a draft", async () => {
      for (const payload of [{ message: "Changed." }, { status: "draft" }]) {
        await expect(check({ collection: "plan_versions", event: "update", payload, keys: ["saved"] })).rejects.toThrow(
          REFUSED,
        );
      }
    });

    it("can't be deleted", async () => {
      await expect(
        check({ collection: "plan_versions", event: "delete", payload: ["saved"], keys: ["saved"] }),
      ).rejects.toThrow(REFUSED);
    });

    it("can be deleted only by the user dev lets clean up", async () => {
      const write: Omit<Write, "now"> = {
        collection: "plan_versions",
        event: "delete",
        payload: ["saved"],
        keys: ["saved"],
      };
      await expect(check(write, true)).resolves.toEqual(["saved"]);
    });

    it("refuses with a 403 the Data Studio shows as it is", async () => {
      const error = await check({ collection: "plan_versions", event: "update", payload: {}, keys: ["saved"] }).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ name: "DirectusError", code: "FORBIDDEN", status: 403 });
    });
  });

  describe("a saved version's rows", () => {
    it("can't be added, changed, or deleted", async () => {
      const writes: Omit<Write, "now">[] = [
        { collection: "plan_offerings", event: "create", payload: { version_id: "saved", name: "Copied" } },
        { collection: "plan_offerings", event: "create", payload: { version_id: { id: "saved" } } },
        { collection: "plan_offerings", event: "update", payload: { name: "Changed" }, keys: ["saved"] },
        { collection: "plan_offerings", event: "delete", payload: ["saved"], keys: ["saved"] },
      ];
      for (const write of writes) {
        await expect(check(write), `${write.event}`).rejects.toThrow(REFUSED);
      }
    });

    it("can't take a draft's row moved into them", async () => {
      await expect(
        check({ collection: "plan_offerings", event: "update", payload: { version_id: "saved" }, keys: ["draft"] }),
      ).rejects.toThrow(REFUSED);
    });
  });

  describe("a draft", () => {
    it("can be changed, and its rows added, changed, and deleted", async () => {
      await expect(
        check({ collection: "plan_versions", event: "update", payload: { message: "Changed." }, keys: ["draft"] }),
      ).resolves.toEqual({ message: "Changed." });
      for (const event of ["update", "delete"] as const) {
        await expect(
          check({ collection: "plan_offerings", event, payload: { name: "Changed" }, keys: ["draft"] }),
        ).resolves.toBeDefined();
      }
      await expect(
        check({ collection: "plan_offerings", event: "create", payload: { version_id: "draft" } }),
      ).resolves.toEqual({ version_id: "draft" });
    });

    it("is saved with the platform version that calculated it, stamped with who saved it and when", async () => {
      const payload = { status: "saved", platform_version: "1.4.0", saved_by: "someone-else", saved_at: "1999-01-01" };
      await expect(check({ collection: "plan_versions", event: "update", payload, keys: ["draft"] })).resolves.toEqual({
        status: "saved",
        platform_version: "1.4.0",
        saved_by: "planner",
        saved_at: now,
      });
    });

    it("can't be saved without the platform version", async () => {
      await expect(
        check({ collection: "plan_versions", event: "update", payload: { status: "saved" }, keys: ["draft"] }),
      ).rejects.toThrow(/platform version/);
    });

    it("can't have its save stamps set by hand", async () => {
      await expect(
        check({ collection: "plan_versions", event: "update", payload: { saved_by: "someone" }, keys: ["draft"] }),
      ).resolves.toEqual({});
    });
  });

  describe("a new version", () => {
    it("starts as a draft", async () => {
      await expect(
        check({ collection: "plan_versions", event: "create", payload: { plan_id: "plan" } }),
      ).resolves.toEqual({
        plan_id: "plan",
      });
      await expect(
        check({ collection: "plan_versions", event: "create", payload: { plan_id: "plan", status: "saved" } }),
      ).rejects.toThrow(/starts as a draft/);
    });
  });

  describe("making a version active", () => {
    it("takes a saved version of the plan, and records who made it active and when", async () => {
      await expect(
        check({ collection: "plan_activations", event: "create", payload: { version_id: "saved", activated_by: "x" } }),
      ).resolves.toEqual({ version_id: "saved", plan_id: "plan", activated_by: "planner", activated_at: now });
    });

    it("refuses a draft, or another plan's version", async () => {
      await expect(
        check({ collection: "plan_activations", event: "create", payload: { version_id: "draft" } }),
      ).rejects.toThrow(/Only a saved version/);
      await expect(
        check({ collection: "plan_activations", event: "create", payload: { plan_id: "plan", version_id: "other" } }),
      ).rejects.toThrow(/its own plan/);
    });
  });

  it("leaves other collections alone", async () => {
    await expect(
      check({ collection: "people", event: "delete", payload: ["saved"], keys: ["saved"] }),
    ).resolves.toEqual(["saved"]);
  });
});
