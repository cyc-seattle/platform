import type { Context } from "./context.ts";
import type { CostCenterBooker } from "./lines.ts";
import type { CapitalRank, CostLine, OrganizationTotals, PlanCapitalItem } from "./types.ts";

const byRank = (a: PlanCapitalItem, b: PlanCapitalItem) =>
  (a.sort ?? Number.POSITIVE_INFINITY) - (b.sort ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name);

/** The capital items on an asset account, most needed first. The rest are left out, with a warning. */
function rankedItems(ctx: Context): PlanCapitalItem[] {
  return (ctx.data.plan_capital_items ?? [])
    .filter((item) => {
      if (ctx.accountType(item.account_id) === "asset") return true;
      ctx.warn("capital_not_asset", `${item.name} isn't on an asset account, so it's left out of capital`, item.key);
      return false;
    })
    .sort(byRank);
}

/** Records each planned purchase as capital on the organization, which pays for all capital. */
export function bookCapitalItems(ctx: Context, booker: CostCenterBooker): void {
  for (const item of rankedItems(ctx)) {
    booker.add({
      cost_center_type: "org",
      cost_center_key: null,
      account_id: item.account_id,
      function: ctx.functionFor(item.account_id, null, "org"),
      amount: item.amount_cents,
      line_key: `capital:${item.key}`,
      line_name: item.name,
      explanation: item.name,
      mtdc_share: 0,
    });
  }
}

/**
 * The capital purchases in rank order, each with the running total and whether the year's operating
 * and fundraising nets cover it. Capital entered as a budget line comes after the ranked items, with
 * a warning, since it has no rank.
 */
export function rankCapital(ctx: Context, lines: CostLine[], organization: OrganizationTotals): CapitalRank[] {
  const budget = lines
    .filter((l) => l.line_key.startsWith("budget:") && ctx.accountType(l.account_id) === "asset")
    .sort((a, b) => a.line_name.localeCompare(b.line_name));
  for (const l of budget) {
    ctx.warn(
      "capital_unranked",
      `${l.line_name} is capital entered as a budget line, so it comes after the ranked capital list`,
      l.line_key.slice("budget:".length),
    );
  }
  const available = organization.operating.net_cents + organization.fundraising.net_cents;
  let running = 0;
  return [
    ...rankedItems(ctx).map((i) => ({
      key: i.key,
      name: i.name,
      account_id: i.account_id,
      amount_cents: i.amount_cents,
    })),
    ...budget.map((l) => ({
      key: l.line_key.slice("budget:".length),
      name: l.line_name,
      account_id: l.account_id,
      amount_cents: l.amount_cents,
    })),
  ].map((item, i) => {
    running += item.amount_cents;
    return { rank: i + 1, ...item, running_cents: running, funded: running <= available };
  });
}
