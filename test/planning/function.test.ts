import { describe, expect, it } from "vitest";
import type { PlanData } from "../../src/planning/index.ts";
import { computePlan } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, laborLine, offering, pool, product, rates, staffLevel } from "./fixtures.ts";

function defaultTo(data: PlanData, accountId: string, fn: "program" | "management" | "fundraising"): void {
  const account = data.accounts.find((a) => a.id === accountId);
  if (account === undefined) throw new Error(`No account ${accountId}`);
  account.default_function = fn;
}

function oneOffering() {
  const p = product();
  const o = offering(p.id, { target_enrollment: 10, price_cents: 10_000 });
  return { o, data: emptyPlan({ products: [p], plan_offerings: [o] }) };
}

describe("function", () => {
  it("counts a coach wage charged to an offering as program, though its account defaults to management", () => {
    const { o, data } = oneOffering();
    defaultTo(data, A.coachWages, "management");
    defaultTo(data, A.payrollTax, "management");
    const level = staffLevel();
    data.plan_staff_levels = [level];
    data.plan_rates = [rates({ payroll_tax_rate: 0.1 })];
    data.plan_labor_lines = [
      laborLine(level.key, { cost_center_type: "offering", cost_center_key: o.key, hours: 100 }),
    ];
    const out = computePlan(data);
    const wage = out.lines.find((l) => l.line_key.startsWith("labor:"));
    const tax = out.lines.find((l) => l.line_key === "payroll_tax");
    expect(wage?.function).toBe("program");
    expect(tax?.function).toBe("program");
  });

  it("keeps a pool's management account as management in each offering's share", () => {
    const { o, data } = oneOffering();
    const ga = pool();
    data.plan_pools = [ga];
    data.plan_budget_lines = [
      budgetLine({ account_id: A.travel, cost_center_type: "offering", cost_center_key: o.key, amount_cents: 1000 }),
      budgetLine({ cost_center_type: "pool", cost_center_key: ga.key, amount_cents: 50_000 }),
    ];
    const shares = computePlan(data).lines.filter((l) => l.line_key.startsWith("pool:"));
    expect(shares.length).toBeGreaterThan(0);
    for (const s of shares) {
      expect(s.cost_center_type).toBe("offering");
      expect(s.function).toBe("management");
    }
  });

  it("gives a line on the organization its account's default, or management", () => {
    const data = emptyPlan({
      plan_budget_lines: [
        budgetLine({ account_id: A.coachWages, amount_cents: 1000 }),
        budgetLine({ account_id: A.rent, amount_cents: 1000 }),
      ],
    });
    const out = computePlan(data);
    expect(out.lines.find((l) => l.account_id === A.coachWages)?.function).toBe("program");
    expect(out.lines.find((l) => l.account_id === A.rent)?.function).toBe("management");
  });

  it("keeps revenue's account default on an offering", () => {
    const { data } = oneOffering();
    defaultTo(data, A.programRevenue, "fundraising");
    const revenue = computePlan(data).lines.find((l) => l.account_id === A.programRevenue);
    expect(revenue?.function).toBe("fundraising");
  });

  it("lets a line's own function win over its cost center", () => {
    const { o, data } = oneOffering();
    data.plan_budget_lines = [
      budgetLine({ cost_center_type: "offering", cost_center_key: o.key, function: "fundraising", amount_cents: 1000 }),
    ];
    const line = computePlan(data).lines.find((l) => l.line_key.startsWith("budget:"));
    expect(line?.function).toBe("fundraising");
  });
});
