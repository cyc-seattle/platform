import { describe, expect, it } from "vitest";
import { planInForce } from "../../src/planning/index.ts";

const budget = { name: "Budget", effective_from: "2026-07-01" };
const fall = { name: "Fall re-plan", effective_from: "2026-09-01" };
const draft = { name: "Draft", effective_from: null };

describe("planInForce", () => {
  it("is the plan with the latest date on or before the day", () => {
    expect(planInForce([fall, draft, budget], "2026-08-31")).toBe(budget);
    expect(planInForce([fall, draft, budget], "2026-09-01")).toBe(fall);
    expect(planInForce([fall, draft, budget], "2027-06-30")).toBe(fall);
  });

  it("is none before the first date, or with no plan active", () => {
    expect(planInForce([fall, budget], "2026-06-30")).toBeUndefined();
    expect(planInForce([draft], "2026-08-01")).toBeUndefined();
  });
});
