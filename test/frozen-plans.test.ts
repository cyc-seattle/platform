import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_WRITER_TO_COPY,
  databaseError,
  draftQueue,
  guard,
  ONE_PER_AREA,
  PLAN_STAYS,
  PLANS_FIXED,
  REFUSED,
  RESULTS_BY_HOOK,
  SET_STAYS,
  type FinancialPlan,
  type Lookup,
  type Plan,
  type Write,
} from "../stacks/backend/frozen-plans.cjs";

// Each Financial Plan is named for its status.
const sets: Record<string, FinancialPlan> = {
  draft: { id: "draft", status: "draft" },
  frozen: { id: "frozen", status: "frozen" },
  archived: { id: "archived", status: "frozen", archived_at: "2027-01-01T00:00:00.000Z" },
};
// Each plan is named for its kind and the status of the Financial Plan it's in.
const plans: Record<string, Plan> = {
  area: { id: "area", financial_plan_id: "draft", kind: "program_area", program_area_id: "summer" },
  operations: { id: "operations", financial_plan_id: "draft", kind: "operations", program_area_id: null },
  draft: { id: "draft", financial_plan_id: "draft", kind: "operations", program_area_id: null },
  frozen: { id: "frozen", financial_plan_id: "frozen", kind: "operations", program_area_id: null },
};
const config = {
  rows: ["plan_offerings"],
  results: ["plan_result_lines"],
  links: {},
  deletable: false,
  platformVersion: "1.5.0+engine.abc",
  decimals: {},
};

// Each offering is named for the plan it belongs to.
function lookup(deletesFrozen = false, writesCatalog = false): Lookup {
  return {
    planIds: async (_, keys) => keys,
    plans: async (ids) => ids.map((id) => plans[id]!).filter(Boolean),
    sets: async (ids) => ids.map((id) => sets[id]!).filter(Boolean),
    deletesFrozen: async () => deletesFrozen,
    yearOf: async (id) => ({ frozen: 2026, draft: 2027 })[id],
    writesCatalog: async () => writesCatalog,
  };
}

const now = "2027-01-01T00:00:00.000Z";
const check = (write: Omit<Write, "now">, deletesFrozen = false) =>
  guard({ user: "planner", ...write, now }, config, lookup(deletesFrozen));

describe("the frozen-plans hook", () => {
  describe("a Financial Plan's results", () => {
    it("can't be written through the API", async () => {
      for (const event of ["create", "update", "delete"] as const) {
        await expect(
          check({ collection: "plan_result_lines", event, payload: { financial_plan_id: "frozen" }, keys: ["frozen"] }),
        ).rejects.toThrow(RESULTS_BY_HOOK);
      }
    });

    it("can be deleted only where the CI stack's tests clean up", async () => {
      await expect(
        check({ collection: "plan_result_lines", event: "delete", payload: ["frozen"], keys: ["frozen"] }, true),
      ).resolves.toEqual(["frozen"]);
    });
  });

  describe("a new Financial Plan", () => {
    it("starts as a draft, and can't be stamped by hand", async () => {
      await expect(
        check({ collection: "financial_plans", event: "create", payload: { name: "Budget", frozen_by: "someone" } }),
      ).resolves.toEqual({ name: "Budget" });
      await expect(
        check({ collection: "financial_plans", event: "create", payload: { name: "Budget", status: "frozen" } }),
      ).rejects.toThrow(/starts as a draft/);
    });

    it("starts from another year's only for a Catalog Writer or an admin, since it makes that year's offerings", async () => {
      const nextYear = {
        collection: "financial_plans",
        event: "create",
        payload: { fiscal_year: 2027, parent_id: "frozen" },
      } as const;
      await expect(check(nextYear)).rejects.toThrow(CATALOG_WRITER_TO_COPY);
      await expect(guard({ user: "planner", ...nextYear, now }, config, lookup(false, true))).resolves.toEqual(
        nextYear.payload,
      );
      await expect(guard({ user: "admin", admin: true, ...nextYear, now }, config, lookup())).resolves.toEqual(
        nextYear.payload,
      );
      const sameYear = { ...nextYear, payload: { fiscal_year: 2027, parent_id: "draft" } };
      await expect(check(sameYear)).resolves.toEqual(sameYear.payload);
    });
  });

  describe("a draft Financial Plan", () => {
    it("is frozen, stamped with who froze it and when", async () => {
      const payload = { status: "frozen", frozen_by: "someone-else" };
      await expect(
        check({ collection: "financial_plans", event: "update", payload, keys: ["draft"] }),
      ).resolves.toEqual({
        status: "frozen",
        frozen_by: "planner",
        frozen_at: now,
      });
    });

    it("can have its plans added, changed, and taken out", async () => {
      await expect(
        check({ collection: "plans", event: "create", payload: { financial_plan_id: "draft", kind: "operations" } }),
      ).resolves.toBeDefined();
      await expect(
        check({ collection: "plans", event: "update", payload: { notes: ["Mondays"] }, keys: ["area"] }),
      ).resolves.toEqual({ notes: ["Mondays"] });
      await expect(check({ collection: "plans", event: "delete", payload: ["area"], keys: ["area"] })).resolves.toEqual(
        ["area"],
      );
    });

    it("can be deleted", async () => {
      await expect(
        check({ collection: "financial_plans", event: "delete", payload: ["draft"], keys: ["draft"] }),
      ).resolves.toEqual(["draft"]);
    });
  });

  describe("archiving a Financial Plan", () => {
    it("takes a draft or a frozen one, and brings it back", async () => {
      for (const key of ["draft", "frozen"]) {
        for (const archived_at of [now, null]) {
          await expect(
            check({ collection: "financial_plans", event: "update", payload: { archived_at }, keys: [key] }),
          ).resolves.toEqual({ archived_at });
        }
      }
    });

    it("leaves the plan in force, and dates, to the database's triggers", async () => {
      await expect(
        check({
          collection: "financial_plans",
          event: "update",
          payload: { effective_from: "2026-09-01", archived_at: null },
          keys: ["archived"],
        }),
      ).resolves.toEqual({ effective_from: "2026-09-01", archived_at: null });
    });
  });

  describe("a frozen Financial Plan", () => {
    it("can't be changed, apart from its name, its note, its date, and whether it's archived", async () => {
      for (const payload of [{ fiscal_year: 2028 }, { status: "draft" }, { note: "Adopted", fiscal_year: 2028 }]) {
        await expect(
          check({ collection: "financial_plans", event: "update", payload, keys: ["frozen"] }),
        ).rejects.toThrow(SET_STAYS);
      }
      for (const payload of [
        { note: "Reviewed with the board" },
        { name: "Board budget" },
        { status: "frozen", effective_from: "2026-09-01" },
      ]) {
        await expect(
          check({ collection: "financial_plans", event: "update", payload, keys: ["frozen"] }),
        ).resolves.toEqual(payload);
      }
    });

    it("can't be deleted, but where the CI stack's tests clean up", async () => {
      await expect(
        check({ collection: "financial_plans", event: "delete", payload: ["frozen"], keys: ["frozen"] }),
      ).rejects.toThrow(SET_STAYS);
      await expect(
        check({ collection: "financial_plans", event: "delete", payload: ["frozen"], keys: ["frozen"] }, true),
      ).resolves.toEqual(["frozen"]);
    });

    it("can't have its plans added, changed, or taken out", async () => {
      await expect(
        check({ collection: "plans", event: "create", payload: { financial_plan_id: "frozen", kind: "operations" } }),
      ).rejects.toThrow(PLANS_FIXED);
      await expect(
        check({ collection: "plans", event: "update", payload: { notes: [] }, keys: ["frozen"] }),
      ).rejects.toThrow(PLANS_FIXED);
      await expect(
        check({ collection: "plans", event: "delete", payload: ["frozen"], keys: ["frozen"] }),
      ).rejects.toThrow(PLANS_FIXED);
      await expect(
        check({ collection: "plans", event: "delete", payload: ["frozen"], keys: ["frozen"] }, true),
      ).resolves.toEqual(["frozen"]);
    });

    it("refuses with a 403 the Data Studio shows as it is", async () => {
      const error = await check({ collection: "plans", event: "update", payload: {}, keys: ["frozen"] }).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ name: "DirectusError", code: "FORBIDDEN", status: 403 });
    });
  });

  describe("making a Financial Plan active from a date", () => {
    it("takes a draft or a frozen one", async () => {
      for (const key of ["draft", "frozen"]) {
        const payload = { effective_from: "2026-07-01" };
        await expect(check({ collection: "financial_plans", event: "update", payload, keys: [key] })).resolves.toEqual(
          payload,
        );
      }
    });
  });

  describe("a frozen plan's rows", () => {
    it("can't be added, changed, or deleted", async () => {
      const writes: Omit<Write, "now">[] = [
        { collection: "plan_offerings", event: "create", payload: { plan_id: "frozen", name: "Copied" } },
        { collection: "plan_offerings", event: "create", payload: { plan_id: { id: "frozen" } } },
        { collection: "plan_offerings", event: "update", payload: { name: "Changed" }, keys: ["frozen"] },
        { collection: "plan_offerings", event: "delete", payload: ["frozen"], keys: ["frozen"] },
      ];
      for (const write of writes) {
        await expect(check(write), `${write.event}`).rejects.toThrow(REFUSED);
      }
    });

    it("can be deleted only by the user the CI stack lets clean up", async () => {
      await expect(
        check({ collection: "plan_offerings", event: "delete", payload: ["frozen"], keys: ["frozen"] }, true),
      ).resolves.toEqual(["frozen"]);
    });

    it("can't take a draft's row moved into them", async () => {
      await expect(
        check({ collection: "plan_offerings", event: "update", payload: { plan_id: "frozen" }, keys: ["draft"] }),
      ).rejects.toThrow(REFUSED);
    });
  });

  describe("a draft plan's rows", () => {
    it("can be added, changed, and deleted", async () => {
      for (const event of ["update", "delete"] as const) {
        await expect(
          check({ collection: "plan_offerings", event, payload: { name: "Changed" }, keys: ["draft"] }),
        ).resolves.toBeDefined();
      }
      await expect(
        check({ collection: "plan_offerings", event: "create", payload: { plan_id: "draft" } }),
      ).resolves.toEqual({ plan_id: "draft" });
    });
  });

  describe("a plan", () => {
    const message = "A program area's plan names its program area, and an Operations Plan names none.";
    const create = (payload: Record<string, unknown>) =>
      check({ collection: "plans", event: "create", payload: { financial_plan_id: "draft", ...payload } });

    it("for a program area names it, and an Operations Plan names none", async () => {
      for (const payload of [{ kind: "program_area" }, { kind: "program_area", program_area_id: null }]) {
        await expect(create(payload)).rejects.toThrow(message);
      }
      await expect(create({ kind: "operations", program_area_id: "summer" })).rejects.toThrow(message);
      for (const payload of [{ kind: "program_area", program_area_id: "summer" }, { kind: "operations" }]) {
        await expect(create(payload)).resolves.toEqual({ financial_plan_id: "draft", ...payload });
      }
    });

    it("keeps that rule when it changes", async () => {
      const update = (payload: Record<string, unknown>, keys: string[]) =>
        check({ collection: "plans", event: "update", payload, keys });
      await expect(update({ program_area_id: null }, ["area"])).rejects.toThrow(message);
      await expect(update({ kind: "operations" }, ["area"])).rejects.toThrow(message);
      await expect(update({ program_area_id: "summer" }, ["operations"])).rejects.toThrow(message);
      await expect(update({ kind: "operations", program_area_id: null }, ["area"])).resolves.toBeDefined();
      await expect(update({ notes: null }, ["area", "operations"])).resolves.toEqual({ notes: null });
    });

    it("can't move to another Financial Plan", async () => {
      await expect(
        check({ collection: "plans", event: "update", payload: { financial_plan_id: "archived" }, keys: ["area"] }),
      ).rejects.toThrow(PLAN_STAYS);
      await expect(
        check({ collection: "plans", event: "update", payload: { financial_plan_id: "draft" }, keys: ["area"] }),
      ).resolves.toBeDefined();
    });
  });

  it("leaves other collections alone", async () => {
    await expect(
      check({ collection: "people", event: "delete", payload: ["frozen"], keys: ["frozen"] }),
    ).resolves.toEqual(["frozen"]);
  });
});

describe("a database error", () => {
  // knex puts the statement ahead of the trigger's message.
  const raised = (message: string) =>
    Object.assign(new Error(`update "plans" set "notes" = $1 - ${message}`), { code: "CY001" });

  it("from a trigger's refusal, reads as the hook's own refusal", () => {
    expect(databaseError(raised(REFUSED))).toMatchObject({ name: "DirectusError", status: 403, message: REFUSED });
    expect(databaseError(raised("A plan row can only link to rows in its own Financial Plan."))).toMatchObject({
      status: 400,
      message: "A plan row can only link to rows in its own Financial Plan.",
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
