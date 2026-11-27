import type { Context, Entry } from "./context.ts";
import type { Id } from "./types.ts";

function counts(entry: Entry): boolean {
  return entry.stage === "direct";
}

/** Sums the entries an offering's base counts, weighting each by `weigh`. */
function sumEntries(ctx: Context, offeringId: Id, weigh: (e: Entry) => number): number {
  let total = 0;
  for (const e of ctx.entries) {
    if (e.cost_center_type !== "offering" || e.cost_center_id !== offeringId || !counts(e)) continue;
    total += e.amount * weigh(e);
  }
  return total;
}

/** Modified total direct costs: an offering's direct expenses, less those excluded from MTDC. */
export function mtdc(ctx: Context, offeringId: Id): number {
  return sumEntries(ctx, offeringId, (e) => (ctx.accountType(e.account_id) === "expense" ? e.mtdc_share : 0));
}

export function revenue(ctx: Context, offeringId: Id): number {
  return sumEntries(ctx, offeringId, (e) => (ctx.accountType(e.account_id) === "revenue" ? 1 : 0));
}

/**
 * How an amount on a product or program area divides among its offerings, by MTDC. Null
 * when it has none.
 */
export function spreadWeights(ctx: Context, type: "product" | "program_area", key: Id): Map<Id, number> | null {
  const offerings = ctx.data.plan_offerings.filter((o) =>
    type === "product" ? o.product_id === key : ctx.products.get(o.product_id)?.program_area_id === key,
  );
  if (offerings.length === 0) return null;
  const weights = new Map(offerings.map((o) => [o.id, Math.max(0, mtdc(ctx, o.id))]));
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  if (total <= 0) return new Map(offerings.map((o) => [o.id, 1 / offerings.length]));
  return new Map([...weights].map(([k, w]) => [k, w / total]));
}
