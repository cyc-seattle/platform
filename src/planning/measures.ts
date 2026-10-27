import type { Context, Entry } from "./context.ts";
import type { Id } from "./types.ts";

function counts(entry: Entry): boolean {
  return entry.stage === "direct";
}

/** Sums the entries an offering's base counts, weighting each by `weigh`. */
function sumEntries(ctx: Context, offeringKey: Id, weigh: (e: Entry) => number): number {
  let total = 0;
  for (const e of ctx.entries) {
    if (e.cost_center_type !== "offering" || e.cost_center_key !== offeringKey || !counts(e)) continue;
    total += e.amount * weigh(e);
  }
  return total;
}

/** Modified total direct costs: an offering's direct expenses, less those excluded from MTDC. */
export function mtdc(ctx: Context, offeringKey: Id): number {
  return sumEntries(ctx, offeringKey, (e) => (ctx.accountType(e.account_id) === "expense" ? e.mtdc_share : 0));
}

export function revenue(ctx: Context, offeringKey: Id): number {
  return sumEntries(ctx, offeringKey, (e) => (ctx.accountType(e.account_id) === "revenue" ? 1 : 0));
}

/** How a product-level amount divides among the product's plan-year offerings, by MTDC. Null when it has none. */
export function spreadWeights(ctx: Context, productId: Id): Map<Id, number> | null {
  const offerings = ctx.fyOfferings().filter((o) => o.product_id === productId);
  if (offerings.length === 0) return null;
  const weights = new Map(offerings.map((o) => [o.key, Math.max(0, mtdc(ctx, o.key))]));
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  if (total <= 0) return new Map(offerings.map((o) => [o.key, 1 / offerings.length]));
  return new Map([...weights].map(([k, w]) => [k, w / total]));
}
