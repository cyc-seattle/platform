import { describe, expect, it } from "vitest";
import { computePlan, type Account, type PlanCapitalItem } from "../../src/planning/index.ts";
import { A, budgetLine, emptyPlan, nextId, total } from "./fixtures.ts";

const equipment: Account = {
  id: "acct-equipment-owned",
  number: "1500",
  name: "Equipment",
  type: "asset",
  form_990_part: null,
  form_990_line: null,
  default_function: null,
  parent_id: null,
  contra_account_id: null,
  retired: false,
};
const donations: Account = {
  ...equipment,
  id: "acct-donations",
  number: "4500",
  type: "revenue",
  default_function: "fundraising",
};

function item(overrides: Partial<PlanCapitalItem> = {}): PlanCapitalItem {
  return {
    id: nextId("capital"),
    key: nextId("capital-key"),
    version_id: "v-ops",
    name: "Coach boat",
    amount_cents: 0,
    account_id: equipment.id,
    sort: null,
    ...overrides,
  };
}

/** A plan whose only money is `raised` cents of donations, and the capital items given. */
function plan(raised: number, items: PlanCapitalItem[]) {
  const data = emptyPlan({ plan_capital_items: items });
  data.accounts = [...data.accounts, equipment, donations];
  data.plan_budget_lines = [budgetLine({ name: "Donations", account_id: donations.id, amount_cents: raised })];
  return data;
}

describe("capital items", () => {
  it("books each item as capital on the organization", () => {
    const out = computePlan(
      plan(0, [item({ amount_cents: 2_000_000 }), item({ name: "Sails", amount_cents: 300_000 })]),
    );
    expect(total(out, { cost_center_type: "org", account_id: equipment.id })).toBe(2_300_000);
    expect(out.organization.capital_cents).toBe(2_300_000);
  });

  it("ranks the items by their rank, then name, with a running total", () => {
    const out = computePlan(
      plan(0, [
        item({ name: "Sails", sort: 2, amount_cents: 300_000 }),
        item({ name: "Trailer", amount_cents: 100_000 }),
        item({ name: "Coach boat", sort: 1, amount_cents: 2_000_000 }),
      ]),
    );
    expect(out.capital.map((c) => [c.rank, c.name, c.running_cents])).toEqual([
      [1, "Coach boat", 2_000_000],
      [2, "Sails", 2_300_000],
      [3, "Trailer", 2_400_000],
    ]);
  });

  it("covers items in rank order while the operating and fundraising nets last", () => {
    const out = computePlan(
      plan(2_100_000, [
        item({ name: "Coach boat", sort: 1, amount_cents: 2_000_000 }),
        item({ name: "Sails", sort: 2, amount_cents: 300_000 }),
        item({ name: "Paint", sort: 3, amount_cents: 50_000 }),
      ]),
    );
    expect(out.capital.map((c) => [c.name, c.funded])).toEqual([
      ["Coach boat", true],
      ["Sails", false],
      ["Paint", false],
    ]);
  });

  it("leaves out an item that isn't on an asset account, with a warning", () => {
    const out = computePlan(plan(0, [item({ account_id: A.insurance, amount_cents: 5_000 })]));
    expect(out.lines.filter((l) => l.account_id === A.insurance)).toEqual([]);
    expect(out.capital).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toEqual(["capital_not_asset"]);
  });

  it("lists capital entered as a budget line after the ranked items, with a warning", () => {
    const data = plan(0, [item({ name: "Sails", sort: 1, amount_cents: 300_000 })]);
    const lump = budgetLine({ name: "Capital spend", account_id: equipment.id, amount_cents: 1_000_000 });
    data.plan_budget_lines.push(lump);
    const out = computePlan(data);
    expect(out.capital.map((c) => [c.rank, c.key, c.running_cents])).toEqual([
      [1, data.plan_capital_items![0]!.key, 300_000],
      [2, lump.key, 1_300_000],
    ]);
    expect(out.warnings.map((w) => w.code)).toEqual(["capital_unranked"]);
  });
});
