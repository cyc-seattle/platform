import { describe, expect, it } from "vitest";
import {
  A,
  budgetLine,
  charge,
  emptyPlan,
  offering,
  pnlOf,
  pool,
  product,
  program,
  allocateAll,
  total,
  withRate,
  computePlan,
} from "./fixtures.ts";

/**
 * Two programs' offerings with 30,000 and 10,000 of costs, and fees that differ from them, and a
 * charter that has `charter` revenue and costs.
 */
function plan(charter: { revenue?: number; costs?: number } = {}) {
  const camp = product();
  const racing = product();
  const charters = product({ kind: "charter" });
  const big = offering(camp.id, { target_enrollment: 1, price_cents: 60_000 });
  const small = offering(racing.id, { target_enrollment: 1, price_cents: 5000 });
  const hire = offering(charters.id);
  const on = (key: string) => ({ cost_center_type: "offering" as const, cost_center_id: key });
  const data = emptyPlan({
    products: [camp, racing, charters],
    plan_offerings: [big, small, hire],
    plan_budget_lines: [
      budgetLine({ account_id: A.rent, amount_cents: 30_000, ...on(big.id) }),
      budgetLine({ account_id: A.rent, amount_cents: 10_000, ...on(small.id) }),
      budgetLine({ account_id: A.charterRevenue, amount_cents: charter.revenue ?? 0, ...on(hire.id) }),
      budgetLine({ account_id: A.rent, amount_cents: charter.costs ?? 0, ...on(hire.id) }),
    ],
  });
  return { big, small, hire, data };
}

function withPool(data: ReturnType<typeof plan>["data"], amount: number, name = "G&A") {
  const p = pool({ name });
  data.plan_pools.push(p);
  data.plan_budget_lines.push(budgetLine({ amount_cents: amount, cost_center_type: "pool", cost_center_id: p.id }));
  return p;
}

describe("indirect costs", () => {
  it("charges each program's offerings its rate × their own MTDC, over the pools' lines, keeping their accounts", () => {
    const { big, small, hire, data } = plan();
    const ga = withPool(data, 12_000);
    const out = computePlan(withRate(data, 0.3));
    expect(total(out, { account_id: A.insurance, cost_center_id: big.id })).toBe(9000);
    expect(total(out, { account_id: A.insurance, cost_center_id: small.id })).toBe(3000);
    expect(total(out, { account_id: A.insurance, cost_center_id: hire.id })).toBe(0);
    expect(total(out, { line: `pool:${ga.id}:budget` })).toBe(12_000);
    expect(total(out, { cost_center_type: "pool" })).toBe(0);
    expect(out.organization.indirect).toEqual({
      shared_cents: 12_000,
      recovered_cents: 12_000,
      unrecovered_cents: 0,
      full_recovery_rate: 0.3,
    });
  });

  it("gives each program its own rate", () => {
    const { big, small, data } = plan();
    withPool(data, 12_000);
    data.plan_programs.push(
      program(big.product_id, { indirect_cost_rate: 0.2 }),
      program(small.product_id, { indirect_cost_rate: 0.5 }),
    );
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_id: big.id })).toBe(6000);
    expect(total(out, { account_id: A.insurance, cost_center_id: small.id })).toBe(5000);
  });

  it("leaves what the rates don't allocate on the organization, unallocated", () => {
    const { big, data } = plan();
    const ga = withPool(data, 12_000);
    const out = computePlan(withRate(data, 0.1));
    expect(total(out, { account_id: A.insurance, cost_center_id: big.id })).toBe(3000);
    const left = out.lines.filter((l) => l.line_key.startsWith(`unrecovered:${ga.id}:budget`));
    expect(left.map((l) => [l.cost_center_type, l.amount_cents, l.line_name])).toEqual([
      ["org", 8000, "G&A unallocated: A line"],
    ]);
    expect(out.organization.indirect.unrecovered_cents).toBe(8000);
  });

  it("credits the organization with what the rates over-allocate", () => {
    const { data } = plan();
    const ga = withPool(data, 12_000);
    const out = computePlan(withRate(data, 0.4));
    const left = out.lines.filter((l) => l.line_key.startsWith(`unrecovered:${ga.id}:budget`));
    expect(left.map((l) => [l.amount_cents, l.line_name])).toEqual([[-4000, "G&A over-allocated: A line"]]);
    expect(out.organization.indirect.unrecovered_cents).toBe(-4000);
  });

  it("doesn't change one program's charge when another program's year changes", () => {
    const { big, small, data } = plan();
    withPool(data, 12_000);
    withRate(data, 0.3);
    const before = total(computePlan(data), { cost_center_id: big.id, account_id: A.insurance });
    data.plan_budget_lines.push(
      budgetLine({
        account_id: A.rent,
        amount_cents: 50_000,
        cost_center_type: "offering",
        cost_center_id: small.id,
      }),
    );
    expect(total(computePlan(data), { cost_center_id: big.id, account_id: A.insurance })).toBe(before);
  });

  it("leaves non-program's net with non-program, and takes it off no program's charge", () => {
    const { big, hire, data } = plan({ revenue: 5000, costs: 1000 });
    withPool(data, 12_000);
    const out = computePlan(withRate(data, 0.3));
    expect(total(out, { account_id: A.insurance, cost_center_id: big.id })).toBe(9000);
    expect(pnlOf(out, hire.id).net_cents).toBe(4000);
  });

  it("leaves the organization's net as it is, whatever the rates", () => {
    const { data } = plan({ revenue: 5000 });
    withPool(data, 12_000);
    const net = (rate: number) => computePlan(withRate(data, rate)).organization.operating.net_cents;
    expect(net(0.5)).toBe(net(0));
  });

  it("splits a rate over every pool by its size", () => {
    const { big, data } = plan();
    const ga = withPool(data, 9000);
    const admin = withPool(data, 3000, "Program admin");
    const out = computePlan(withRate(data, 0.2));
    expect(total(out, { line: `pool:${ga.id}`, cost_center_id: big.id })).toBe(4500);
    expect(total(out, { line: `pool:${admin.id}`, cost_center_id: big.id })).toBe(1500);
  });

  it("counts no pool's split in another pool's base", () => {
    const { big, data } = plan();
    withPool(data, 1_000_000, "First");
    const second = withPool(data, 1000, "Second");
    expect(total(computePlan(allocateAll(data)), { line: `pool:${second.id}`, cost_center_id: big.id })).toBe(750);
  });

  it("warns about a program with no rate, and charges it none", () => {
    const { big, data } = plan();
    withPool(data, 12_000);
    const out = computePlan(data);
    expect(total(out, { cost_center_id: big.id, account_id: A.insurance })).toBe(0);
    expect(total(out, { cost_center_type: "org", account_id: A.insurance })).toBe(12_000);
    expect(out.warnings.map((w) => w.code)).toContain("no_indirect_cost_rate");
  });

  it("charges nothing, with a warning, when there are no shared costs", () => {
    const { big, data } = plan();
    const out = computePlan(withRate(data, 0.3));
    expect(pnlOf(out, big.id).expense_cents).toBe(30_000);
    expect(out.warnings.map((w) => w.code)).toContain("no_shared_costs");
  });

  it("charges nothing on a cost left out of MTDC", () => {
    const { big, data } = plan();
    withPool(data, 12_000);
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 50_000, in_mtdc: false, cost_center_type: "offering", cost_center_id: big.id }),
    );
    const out = computePlan(withRate(data, 0.3));
    expect(total(out, { account_id: A.insurance, cost_center_id: big.id, line: "pool:" })).toBe(9000);
    expect(out.organization.indirect.full_recovery_rate).toBe(0.3);
  });

  it("counts the card fees an offering pays in its MTDC", () => {
    const { big, data } = plan();
    withPool(data, 12_000);
    data.plan_revenue_charges.push(charge({ name: "Card fees", rate: 0.05 }));
    const out = computePlan(withRate(data, 0.3));
    // 0.3 × (30,000 of rent + 3000 of card fees on its 60,000 of fees).
    expect(total(out, { line: "pool:", cost_center_id: big.id })).toBe(9900);
  });

  it("gives no rate that allocates every shared cost when no program's offering has MTDC", () => {
    const ga = pool();
    const data = emptyPlan({
      plan_pools: [ga],
      plan_budget_lines: [budgetLine({ amount_cents: 500, cost_center_type: "pool", cost_center_id: ga.id })],
    });
    const out = computePlan(data);
    expect(total(out, { cost_center_type: "org" })).toBe(500);
    expect(out.organization.indirect.full_recovery_rate).toBeNull();
  });
});
