import { describe, expect, it } from "vitest";
import { computePlan } from "../src/index.ts";
import { A, budgetLine, emptyPlan, offering, pool, poolShare, product, total } from "./fixtures.ts";

function twoOfferings() {
  const p = product();
  const big = offering(p.id, { starts_on: "2027-01-01", ends_on: "2027-12-31" });
  const small = offering(p.id, { starts_on: "2027-06-01", ends_on: "2027-08-31" });
  const data = emptyPlan({
    products: [p],
    plan_offerings: [big, small],
    plan_budget_lines: [
      budgetLine({ account_id: A.rent, amount_cents: 30_000, cost_center_type: "offering", cost_center_key: big.key }),
      budgetLine({
        account_id: A.rent,
        amount_cents: 10_000,
        cost_center_type: "offering",
        cost_center_key: small.key,
        phasing: { "2027-06": 1 / 3, "2027-07": 1 / 3, "2027-08": 1 / 3 },
      }),
    ],
  });
  return { p, big, small, data };
}

describe("pools", () => {
  it("allocates by base share month by month, keeping the pool's accounts", () => {
    const { big, small, data } = twoOfferings();
    const ga = pool({ method: "base_share", base: "mtdc" });
    data.plan_pools = [ga];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 12_000, cost_center_type: "pool", cost_center_key: ga.key }),
    );
    const out = computePlan(data);
    // January: only big has MTDC. June: big 2500, small 3333.
    expect(total(out, { account_id: A.insurance, cost_center_key: big.key, month: "2027-01-01" })).toBe(1000);
    expect(total(out, { account_id: A.insurance, cost_center_key: small.key, month: "2027-06-01" })).toBe(571);
    expect(total(out, { account_id: A.insurance })).toBe(12_000);
    expect(total(out, { cost_center_type: "pool" })).toBe(0);
  });

  it("reaches only the offerings its filter names", () => {
    const { big, small, data } = twoOfferings();
    const ga = pool({ targets_filter: { offering_keys: [small.key] } });
    data.plan_pools = [ga];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 6000, cost_center_type: "pool", cost_center_key: ga.key, phasing: { "2027-07": 1 } }),
    );
    const out = computePlan(data);
    expect(total(out, { account_id: A.insurance, cost_center_key: small.key })).toBe(6000);
    expect(total(out, { account_id: A.insurance, cost_center_key: big.key })).toBe(0);
  });

  it("falls back to the year's base in a month with none", () => {
    const { small, data } = twoOfferings();
    const ga = pool({ targets_filter: { offering_keys: [small.key] } });
    data.plan_pools = [ga];
    data.plan_budget_lines.push(budgetLine({ amount_cents: 1200, cost_center_type: "pool", cost_center_key: ga.key }));
    expect(total(computePlan(data), { cost_center_key: small.key, account_id: A.insurance })).toBe(1200);
  });

  it("splits by dated fixed shares, passing the unclaimed part down the remainder chain", () => {
    const { big, small, data } = twoOfferings();
    const ga = pool({ name: "G&A", step_order: 2, method: "base_share" });
    const storage = pool({ name: "Storage", step_order: 1, method: "fixed_shares", remainder_pool_id: ga.id });
    data.plan_pools = [ga, storage];
    data.plan_pool_shares = [
      // Summer takes it all in June to August; big takes a quarter the rest of the year.
      poolShare(storage.id, small.key, { share: 1, starts_on: "2027-06-01", ends_on: "2027-08-31" }),
      poolShare(storage.id, big.key, { share: 0.25, starts_on: "2027-01-01", ends_on: "2027-05-31" }),
      poolShare(storage.id, big.key, { share: 0.25, starts_on: "2027-09-01", ends_on: "2027-12-31" }),
    ];
    data.plan_budget_lines.push(
      budgetLine({ account_id: A.rent, amount_cents: 12_000, cost_center_type: "pool", cost_center_key: storage.key }),
    );
    const out = computePlan(data);
    expect(total(out, { line: `pool:${storage.key}`, cost_center_key: small.key, month: "2027-07-01" })).toBe(1000);
    expect(total(out, { line: `pool:${storage.key}`, cost_center_key: big.key, month: "2027-02-01" })).toBe(250);
    // The other 750 of February goes to G&A, and from there all to big, the only offering with a base then.
    expect(total(out, { line: `pool:${ga.key}`, cost_center_key: big.key, month: "2027-02-01" })).toBe(750);
    expect(total(out, { line: "pool", account_id: A.rent })).toBe(12_000);
  });

  it("sends what a pool leaves unclaimed to the org without a remainder pool", () => {
    const { big, data } = twoOfferings();
    const storage = pool({ method: "fixed_shares" });
    data.plan_pools = [storage];
    data.plan_pool_shares = [poolShare(storage.id, big.key, { share: 0.4 })];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 1000, cost_center_type: "pool", cost_center_key: storage.key }),
    );
    const out = computePlan(data);
    expect(total(out, { line: `pool:${storage.key}`, cost_center_key: big.key })).toBe(400);
    expect(total(out, { line: `pool:${storage.key}`, cost_center_type: "org" })).toBe(600);
  });

  it("splits by area, leaving the unrented area unclaimed", () => {
    const { big, small, data } = twoOfferings();
    const yard = pool({ method: "area", denominator_quantity: 1000, unit: "sq_ft" });
    data.plan_pools = [yard];
    data.plan_pool_shares = [
      poolShare(yard.id, big.key, { quantity: 600 }),
      poolShare(yard.id, small.key, { quantity: 200 }),
    ];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 10_000, cost_center_type: "pool", cost_center_key: yard.key }),
    );
    const out = computePlan(data);
    expect(total(out, { line: `pool:${yard.key}`, cost_center_key: big.key })).toBe(6000);
    expect(total(out, { line: `pool:${yard.key}`, cost_center_key: small.key })).toBe(2000);
    expect(total(out, { line: `pool:${yard.key}`, cost_center_type: "org" })).toBe(2000);
  });

  it("spreads a product target's share to its offerings by MTDC", () => {
    const { p, big, data } = twoOfferings();
    const storage = pool({ method: "fixed_shares" });
    data.plan_pools = [storage];
    data.plan_pool_shares = [poolShare(storage.id, p.id, { target_type: "product", share: 1 })];
    data.plan_budget_lines.push(
      budgetLine({
        amount_cents: 1000,
        cost_center_type: "pool",
        cost_center_key: storage.key,
        phasing: { "2027-01": 1 },
      }),
    );
    expect(total(computePlan(data), { line: `pool:${storage.key}`, cost_center_key: big.key })).toBe(1000);
  });

  it("claims fixed amounts with the formula method", () => {
    const { big, data } = twoOfferings();
    const fees = pool({ method: "formula" });
    data.plan_pools = [fees];
    data.plan_pool_shares = [poolShare(fees.id, big.key, { amount_cents: 2400 })];
    data.plan_budget_lines.push(
      budgetLine({ amount_cents: 6000, cost_center_type: "pool", cost_center_key: fees.key }),
    );
    const out = computePlan(data);
    expect(total(out, { line: `pool:${fees.key}`, cost_center_key: big.key })).toBe(2400);
    expect(total(out, { line: `pool:${fees.key}`, cost_center_type: "org" })).toBe(3600);
  });

  it("rephases the pool evenly before allocating", () => {
    const { big, data } = twoOfferings();
    const ga = pool({ phasing: "even", targets_filter: { offering_keys: [big.key] } });
    data.plan_pools = [ga];
    data.plan_budget_lines.push(
      budgetLine({
        amount_cents: 12_000,
        cost_center_type: "pool",
        cost_center_key: ga.key,
        phasing: { "2027-01": 1 },
      }),
    );
    expect(total(computePlan(data), { line: `pool:${ga.key}`, month: "2027-05-01" })).toBe(1000);
  });

  it("counts no allocation in a later pool's base", () => {
    const { big, small, data } = twoOfferings();
    const first = pool({ name: "First", step_order: 1, method: "fixed_shares" });
    const second = pool({ name: "Second", step_order: 2, base: "mtdc" });
    data.plan_pools = [first, second];
    data.plan_pool_shares = [poolShare(first.id, small.key, { share: 1 })];
    data.plan_budget_lines.push(
      budgetLine({
        amount_cents: 1_000_000,
        cost_center_type: "pool",
        cost_center_key: first.key,
        phasing: { "2027-01": 1 },
      }),
      budgetLine({
        amount_cents: 1000,
        cost_center_type: "pool",
        cost_center_key: second.key,
        phasing: { "2027-01": 1 },
      }),
    );
    // In January only big has direct costs, so all of Second goes to it despite First's allocation to small.
    expect(total(computePlan(data), { line: `pool:${second.key}`, cost_center_key: big.key })).toBe(1000);
  });
});
