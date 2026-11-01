import { describe, expect, it } from "vitest";
import {
  databaseError,
  guard,
  REFUSED,
  RESULTS_BY_SAVE,
  type Lookup,
  type Plan,
  type Version,
  type Write,
} from "../stacks/backend/saved-versions.cjs";

const versions: Record<string, Version> = {
  draft: { id: "draft", plan_id: "plan", status: "draft", platform_version: null },
  calculated: { id: "calculated", plan_id: "plan", status: "draft", platform_version: "1.4.0" },
  saved: { id: "saved", plan_id: "plan", status: "saved", platform_version: "1.4.0" },
  other: { id: "other", plan_id: "other-plan", status: "saved", platform_version: "1.4.0" },
};
// Each offering is named for the version it belongs to.
const config = {
  versioned: ["plan_offerings", "plan_result_lines"],
  results: ["plan_result_lines"],
  links: {},
  deletable: false,
  platformVersion: "1.5.0+engine.abc",
  decimals: {},
};

// Each plan is named for its kind.
const plans: Record<string, Plan> = {
  area: { id: "area", kind: "program_area", program_area_id: "summer" },
  operations: { id: "operations", kind: "operations", program_area_id: null },
};

function lookup(deletesSaved = false): Lookup {
  return {
    versionIds: async (_, keys) => keys,
    plans: async (ids) => ids.map((id) => plans[id]!).filter(Boolean),
    versions: async (ids) => ids.map((id) => versions[id]!).filter(Boolean),
    deletesSaved: async () => deletesSaved,
  };
}

const now = "2027-01-01T00:00:00.000Z";
const check = (write: Omit<Write, "now">, deletesSaved = false) =>
  guard({ user: "planner", ...write, now }, config, lookup(deletesSaved));

describe("the saved-versions hook", () => {
  describe("a version's results", () => {
    it("can't be written through the API, even to a draft", async () => {
      for (const event of ["create", "update", "delete"] as const) {
        await expect(
          check({ collection: "plan_result_lines", event, payload: { version_id: "saved" }, keys: ["saved"] }),
        ).rejects.toThrow(RESULTS_BY_SAVE);
      }
    });

    it("can be deleted only where dev's tests clean up", async () => {
      await expect(
        check({ collection: "plan_result_lines", event: "delete", payload: ["saved"], keys: ["saved"] }, true),
      ).resolves.toEqual(["saved"]);
    });
  });

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

    it("is saved with the hook's engine version, stamped with who saved it and when", async () => {
      const payload = { status: "saved", platform_version: "1.4.0", saved_by: "someone-else", saved_at: "1999-01-01" };
      await expect(check({ collection: "plan_versions", event: "update", payload, keys: ["draft"] })).resolves.toEqual({
        status: "saved",
        platform_version: "1.5.0+engine.abc",
        saved_by: "planner",
        saved_at: now,
      });
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

    it("adds to the plan's history, which no one changes", async () => {
      await expect(
        check({ collection: "plan_activations", event: "update", payload: { version_id: "saved" }, keys: ["a"] }),
      ).rejects.toThrow(/stays in the plan's history/);
    });

    it("can be undone only by the user dev lets clean up", async () => {
      const write: Omit<Write, "now"> = {
        collection: "plan_activations",
        event: "delete",
        payload: ["a"],
        keys: ["a"],
      };
      await expect(check(write)).rejects.toThrow(/stays in the plan's history/);
      await expect(check(write, true)).resolves.toEqual(["a"]);
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

  describe("a plan", () => {
    const message = "A program area's plan names its program area, and an Operations Plan names none.";

    it("for a program area names it, and an Operations Plan names none", async () => {
      for (const payload of [{ kind: "program_area" }, { kind: "program_area", program_area_id: null }]) {
        await expect(check({ collection: "plans", event: "create", payload })).rejects.toThrow(message);
      }
      await expect(
        check({ collection: "plans", event: "create", payload: { kind: "operations", program_area_id: "summer" } }),
      ).rejects.toThrow(message);
      for (const payload of [{ kind: "program_area", program_area_id: "summer" }, { kind: "operations" }]) {
        await expect(check({ collection: "plans", event: "create", payload })).resolves.toEqual(payload);
      }
    });

    it("keeps that rule when it changes", async () => {
      const update = (payload: Record<string, unknown>, keys: string[]) =>
        check({ collection: "plans", event: "update", payload, keys });
      await expect(update({ program_area_id: null }, ["area"])).rejects.toThrow(message);
      await expect(update({ kind: "operations" }, ["area"])).rejects.toThrow(message);
      await expect(update({ program_area_id: "summer" }, ["operations"])).rejects.toThrow(message);
      await expect(update({ kind: "operations", program_area_id: null }, ["area"])).resolves.toBeDefined();
      await expect(update({ name: "Renamed" }, ["area", "operations"])).resolves.toEqual({ name: "Renamed" });
    });
  });

  it("leaves other collections alone", async () => {
    await expect(
      check({ collection: "people", event: "delete", payload: ["saved"], keys: ["saved"] }),
    ).resolves.toEqual(["saved"]);
  });
});

describe("a database error", () => {
  // knex puts the statement ahead of the trigger's message.
  const raised = (message: string) =>
    Object.assign(new Error(`update "plan_versions" set "message" = $1 - ${message}`), { code: "CY001" });

  it("from a trigger's refusal, reads as the hook's own refusal", () => {
    expect(databaseError(raised(REFUSED))).toMatchObject({ name: "DirectusError", status: 403, message: REFUSED });
    expect(databaseError(raised("A plan row can only link to rows in its own version."))).toMatchObject({
      status: 400,
      message: "A plan row can only link to rows in its own version.",
    });
  });

  it("from a unique column of plans, stays as it is", () => {
    const duplicate = { code: "RECORD_NOT_UNIQUE", extensions: { collection: "plans", field: "id" } };
    expect(databaseError(duplicate)).toBe(duplicate);
  });

  it("from anything else, stays as it is", () => {
    const other = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    expect(databaseError(other)).toBe(other);
  });
});
