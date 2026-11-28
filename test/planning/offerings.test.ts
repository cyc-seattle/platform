import { describe, expect, it } from "vitest";
import { computePlan as engine, type OfferingInPlan, type PlanOffering } from "../../src/planning/index.ts";
import { A, emptyPlan, offering, product, total } from "./fixtures.ts";

// A plan offering's product and name are its catalog offering's (cyc-seattle/platform#395).

/** The plan offering as the database holds it, without the product and name the fixture gives it. */
const asStored = (o: OfferingInPlan): PlanOffering =>
  Object.fromEntries(Object.entries(o).filter(([field]) => field !== "product_id" && field !== "name")) as PlanOffering;

describe("a plan offering's catalog offering", () => {
  it("gives the plan offering its product and its name", () => {
    const p = product({ name: "Guppies" });
    const planned = asStored(
      offering("another product", {
        offering_id: "guppies-week-3",
        target_enrollment: 10,
        price_cents: 50_000,
        capacity: 10,
      }),
    );
    const out = engine(
      emptyPlan({
        products: [p],
        offerings: [{ id: "guppies-week-3", product_id: p.id, name: "Week 3" }],
        plan_offerings: [planned],
      }),
    );
    expect(total(out, { line: "revenue", account_id: A.programRevenue })).toBe(500_000);
    expect(out.pnl.find((r) => r.level === "product")?.subject_id).toBe(p.id);
  });

  it("warns when two of a Financial Plan's offerings are the same catalog offering", () => {
    const p = product({ name: "Guppies" });
    const twice = [1, 2].map(() => {
      const planned = asStored(offering(p.id, { offering_id: "week-3" }));
      return planned;
    });
    const out = engine(
      emptyPlan({
        products: [p],
        offerings: [{ id: "week-3", product_id: p.id, name: "Week 3" }],
        plan_offerings: twice,
      }),
    );
    expect(out.warnings.filter((w) => w.code === "offering_planned_twice").map((w) => w.message)).toEqual([
      "Guppies Week 3 is planned 2 times. Plan it once.",
    ]);
  });

  it("warns about an offering whose catalog offering isn't there, as one with no product", () => {
    const planned = asStored(offering("x", { offering_id: "gone", target_enrollment: 1 }));
    const out = engine(emptyPlan({ plan_offerings: [planned] }));
    expect(out.warnings.map((w) => w.code)).toContain("unknown_product");
  });
});
