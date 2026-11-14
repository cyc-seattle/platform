import { describe, expect, it, vi } from "vitest";
import {
  databaseError,
  draftQueue,
  guard,
  MEMBERS_FIXED,
  ONE_PER_AREA,
  REFUSED,
  RESULTS_BY_SAVE,
  SAVED_WITH_SET,
  SET_STAYS,
  type FinancialPlan,
  type Lookup,
  type Plan,
  type Version,
  type Write,
} from "../stacks/backend/saved-versions.cjs";

const versions: Record<string, Version> = {
  draft: { id: "draft", plan_id: "plan", status: "draft", platform_version: null },
  saved: { id: "saved", plan_id: "plan", status: "saved", platform_version: "1.4.0" },
};
// Each Financial Plan, and each of its members, is named for its status.
const sets: Record<string, FinancialPlan> = {
  draft: { id: "draft", status: "draft" },
  saved: { id: "saved", status: "saved" },
  archived: { id: "archived", status: "saved", archived_at: "2027-01-01T00:00:00.000Z" },
};
// Each offering is named for the version it belongs to.
const config = {
  versioned: ["plan_offerings"],
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
    sets: async (ids) => ids.map((id) => sets[id]!).filter(Boolean),
    memberSets: async (keys) => keys,
    deletesSaved: async () => deletesSaved,
  };
}

const now = "2027-01-01T00:00:00.000Z";
const check = (write: Omit<Write, "now">, deletesSaved = false) =>
  guard({ user: "planner", ...write, now }, config, lookup(deletesSaved));

describe("the saved-versions hook", () => {
  describe("a Financial Plan's results", () => {
    it("can't be written through the API", async () => {
      for (const event of ["create", "update", "delete"] as const) {
        await expect(
          check({ collection: "plan_result_lines", event, payload: { version_set_id: "saved" }, keys: ["saved"] }),
        ).rejects.toThrow(RESULTS_BY_SAVE);
      }
    });

    it("can be deleted only where dev's tests clean up", async () => {
      await expect(
        check({ collection: "plan_result_lines", event: "delete", payload: ["saved"], keys: ["saved"] }, true),
      ).resolves.toEqual(["saved"]);
    });
  });

  describe("a new Financial Plan", () => {
    it("starts as a draft, and can't be stamped by hand", async () => {
      await expect(
        check({ collection: "version_sets", event: "create", payload: { name: "Budget", saved_by: "someone" } }),
      ).resolves.toEqual({ name: "Budget" });
      await expect(
        check({ collection: "version_sets", event: "create", payload: { name: "Budget", status: "saved" } }),
      ).rejects.toThrow(/starts as a draft/);
    });
  });

  describe("a draft Financial Plan", () => {
    it("is saved with the hook's engine version, stamped with who saved it and when", async () => {
      const payload = { status: "saved", platform_version: "1.4.0", saved_by: "someone-else" };
      await expect(check({ collection: "version_sets", event: "update", payload, keys: ["draft"] })).resolves.toEqual({
        status: "saved",
        platform_version: "1.5.0+engine.abc",
        saved_by: "planner",
        saved_at: now,
      });
    });

    it("can have its plans added, changed, and taken out", async () => {
      await expect(
        check({
          collection: "version_set_members",
          event: "create",
          payload: { version_set_id: "draft", version_id: "x" },
        }),
      ).resolves.toBeDefined();
      for (const event of ["update", "delete"] as const) {
        await expect(
          check({ collection: "version_set_members", event, payload: { version_id: "y" }, keys: ["draft"] }),
        ).resolves.toBeDefined();
      }
    });

    it("fills in each added plan's plan from its copy", async () => {
      await expect(
        check({
          collection: "version_set_members",
          event: "create",
          payload: { version_set_id: "draft", version_id: "draft" },
        }),
      ).resolves.toEqual({ version_set_id: "draft", version_id: "draft", plan_id: "plan" });
    });

    it("can be deleted", async () => {
      await expect(
        check({ collection: "version_sets", event: "delete", payload: ["draft"], keys: ["draft"] }),
      ).resolves.toEqual(["draft"]);
    });
  });

  describe("archiving a Financial Plan", () => {
    it("takes a draft or a saved one, and brings it back", async () => {
      for (const key of ["draft", "saved"]) {
        for (const archived_at of [now, null]) {
          await expect(
            check({ collection: "version_sets", event: "update", payload: { archived_at }, keys: [key] }),
          ).resolves.toEqual({ archived_at });
        }
      }
    });

    it("leaves the plan in force, and dates, to the database's triggers", async () => {
      await expect(
        check({
          collection: "version_sets",
          event: "update",
          payload: { effective_from: "2026-09-01", archived_at: null },
          keys: ["archived"],
        }),
      ).resolves.toEqual({ effective_from: "2026-09-01", archived_at: null });
    });
  });

  describe("a saved Financial Plan", () => {
    it("can't be changed, apart from its name, its note, its date, and whether it's archived", async () => {
      for (const payload of [{ fiscal_year: 2028 }, { status: "draft" }, { message: "Adopted", fiscal_year: 2028 }]) {
        await expect(check({ collection: "version_sets", event: "update", payload, keys: ["saved"] })).rejects.toThrow(
          SET_STAYS,
        );
      }
      await expect(
        check({
          collection: "version_sets",
          event: "update",
          payload: { message: "Reviewed with the board" },
          keys: ["saved"],
        }),
      ).resolves.toEqual({ message: "Reviewed with the board" });
      await expect(
        check({ collection: "version_sets", event: "update", payload: { name: "Board budget" }, keys: ["saved"] }),
      ).resolves.toEqual({ name: "Board budget" });
      await expect(
        check({
          collection: "version_sets",
          event: "update",
          payload: { status: "saved", effective_from: "2026-09-01" },
          keys: ["saved"],
        }),
      ).resolves.toEqual({ status: "saved", effective_from: "2026-09-01" });
    });

    it("can't be deleted, but where dev's tests clean up", async () => {
      await expect(
        check({ collection: "version_sets", event: "delete", payload: ["saved"], keys: ["saved"] }),
      ).rejects.toThrow(SET_STAYS);
      await expect(
        check({ collection: "version_sets", event: "delete", payload: ["saved"], keys: ["saved"] }, true),
      ).resolves.toEqual(["saved"]);
    });

    it("can't have its plans changed", async () => {
      await expect(
        check({
          collection: "version_set_members",
          event: "create",
          payload: { version_set_id: "saved", version_id: "x" },
        }),
      ).rejects.toThrow(MEMBERS_FIXED);
      for (const event of ["update", "delete"] as const) {
        await expect(
          check({ collection: "version_set_members", event, payload: { version_id: "y" }, keys: ["saved"] }),
        ).rejects.toThrow(MEMBERS_FIXED);
      }
      await expect(
        check({
          collection: "version_set_members",
          event: "update",
          payload: { version_set_id: "saved" },
          keys: ["draft"],
        }),
      ).rejects.toThrow(MEMBERS_FIXED);
    });
  });

  describe("making a Financial Plan active from a date", () => {
    it("takes a draft or a saved one", async () => {
      for (const key of ["draft", "saved"]) {
        const payload = { effective_from: "2026-07-01" };
        await expect(check({ collection: "version_sets", event: "update", payload, keys: [key] })).resolves.toEqual(
          payload,
        );
      }
    });
  });

  describe("a saved plan copy", () => {
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

  describe("a saved plan copy's rows", () => {
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

  describe("a draft plan copy", () => {
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

    it("is saved only with its Financial Plan", async () => {
      await expect(
        check({ collection: "plan_versions", event: "update", payload: { status: "saved" }, keys: ["draft"] }),
      ).rejects.toThrow(SAVED_WITH_SET);
    });

    it("can't have its save stamps set by hand", async () => {
      await expect(
        check({ collection: "plan_versions", event: "update", payload: { saved_by: "someone" }, keys: ["draft"] }),
      ).resolves.toEqual({});
    });
  });

  describe("a new plan copy", () => {
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

  it("adds what the trigger found, such as which program area", () => {
    const error = Object.assign(raised(ONE_PER_AREA), { detail: "It already has Summer." });
    expect(databaseError(error)).toMatchObject({ status: 400, message: `${ONE_PER_AREA} It already has Summer.` });
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

describe("the queue of drafts to work out", () => {
  const queue = () => {
    const runs: string[] = [];
    let release = () => {};
    const run = async (id: string) => {
      runs.push(id);
      if (id === "slow") await new Promise<void>((resolve) => (release = resolve));
    };
    return { runs, release: () => release(), drafts: draftQueue(run, 1000, 10_000) };
  };

  it("works out a draft once writes to it stop, however many there were", async () => {
    vi.useFakeTimers();
    try {
      const { runs, drafts } = queue();
      for (let i = 0; i < 200; i++) {
        drafts.mark(["a"]);
        await vi.advanceTimersByTimeAsync(10);
      }
      drafts.mark(["b", "a"]);
      expect(runs).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs.sort()).toEqual(["a", "b"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("works out a draft that keeps changing after the longest wait, without holding back the others", async () => {
    vi.useFakeTimers();
    try {
      const { runs, drafts } = queue();
      drafts.mark(["quiet"]);
      for (let i = 0; i < 19; i++) {
        drafts.mark(["busy"]);
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(runs).toEqual(["quiet"]);
      drafts.mark(["busy"]);
      await vi.advanceTimersByTimeAsync(500);
      expect(runs).toEqual(["quiet", "busy"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("works one out once more if it changes while it's being worked out, and one at a time", async () => {
    vi.useFakeTimers();
    try {
      const { runs, drafts, release } = queue();
      drafts.mark(["slow"]);
      await vi.advanceTimersByTimeAsync(1000);
      drafts.mark(["slow", "other"]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toEqual(["slow"]);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toEqual(["slow", "slow"]);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toEqual(["slow", "slow", "other"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
