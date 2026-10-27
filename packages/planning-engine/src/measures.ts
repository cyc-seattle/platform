import type { Context, Entry } from "./context.ts";
import { monthOverlaps, type Month } from "./dates.ts";
import type { Id, MetricName, Spread, TargetsFilter } from "./types.ts";

function counts(entry: Entry): boolean {
  return entry.basis !== "cash" && (entry.stage === "direct" || entry.stage === "formula");
}

/** Sums the accrual entries an offering's base counts, for one month or the fiscal year. */
function sumEntries(ctx: Context, offeringKey: Id, month: Month | undefined, test: (e: Entry) => boolean): number {
  let total = 0;
  for (const e of ctx.entries) {
    if (e.cost_center_type !== "offering" || e.cost_center_key !== offeringKey || !counts(e)) continue;
    if (month === undefined ? !ctx.fyMonthSet.has(e.month) : e.month !== month) continue;
    if (test(e)) total += e.amount;
  }
  return total;
}

/** Modified total direct costs: an offering's direct expenses, less participant support, capital and excluded lines. */
export function mtdc(ctx: Context, offeringKey: Id, month?: Month): number {
  return sumEntries(ctx, offeringKey, month, (e) => e.in_mtdc && ctx.accountType(e.account_id) === "expense");
}

export function revenue(ctx: Context, offeringKey: Id, month?: Month): number {
  return sumEntries(ctx, offeringKey, month, (e) => ctx.accountType(e.account_id) === "revenue");
}

/** The expenses booked to any of `accountIds` or their children. */
export function accountsBase(ctx: Context, offeringKey: Id, accountIds: Id[], month?: Month): number {
  return sumEntries(
    ctx,
    offeringKey,
    month,
    (e) => e.in_base && accountIds.some((a) => ctx.accountUnder(e.account_id, a)),
  );
}

const METRICS = new Set<string>(["coach_hours", "paid_hours", "rib_hours", "boat_hours", "enrollment", "wages"]);

/** A measure a pool base or a formula can read: a metric, `mtdc`, or `revenue`. */
export function measure(ctx: Context, name: string, offeringKey: Id, month?: Month): number | undefined {
  if (name === "mtdc") return mtdc(ctx, offeringKey, month);
  if (name === "revenue") return revenue(ctx, offeringKey, month);
  if (METRICS.has(name)) return ctx.metric(offeringKey, name as MetricName, month);
  return undefined;
}

export const MEASURE_NAMES = new Set([...METRICS, "mtdc", "revenue"]);

export function matchesFilter(ctx: Context, offeringKey: Id, filter: TargetsFilter | null): boolean {
  if (filter == null) return true;
  const offering = ctx.offeringsByKey.get(offeringKey);
  if (offering === undefined) return false;
  const product = ctx.products.get(offering.product_id);
  if (filter.offering_keys !== undefined && !filter.offering_keys.includes(offeringKey)) return false;
  if (filter.product_ids !== undefined && !filter.product_ids.includes(offering.product_id)) return false;
  if (filter.product_kinds !== undefined && (product === undefined || !filter.product_kinds.includes(product.kind))) {
    return false;
  }
  if (filter.exclude_offering_keys?.includes(offeringKey)) return false;
  if (filter.exclude_product_ids?.includes(offering.product_id)) return false;
  return true;
}

/**
 * How a product-level amount divides among the product's offerings in the fiscal year, or in one
 * month when `month` is given. Null when the product has no offering there.
 */
export function spreadWeights(ctx: Context, productId: Id, spread: Spread, month?: Month): Map<Id, number> | null {
  const offerings = ctx
    .fyOfferings()
    .filter((o) => o.product_id === productId)
    .filter((o) => month === undefined || monthOverlaps(month, o.starts_on, o.ends_on));
  if (offerings.length === 0) return null;
  const weight = (key: Id): number => {
    const offering = ctx.offeringsByKey.get(key);
    switch (spread) {
      case "by_mtdc":
        return mtdc(ctx, key, month);
      case "by_revenue":
        return revenue(ctx, key, month);
      case "by_months":
        return offering === undefined ? 0 : ctx.offeringMonths(offering).filter((m) => ctx.fyMonthSet.has(m)).length;
      case "even":
        return 1;
    }
  };
  const weights = new Map(offerings.map((o) => [o.key, Math.max(0, weight(o.key))]));
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  if (total <= 0) return new Map(offerings.map((o) => [o.key, 1 / offerings.length]));
  return new Map([...weights].map(([k, w]) => [k, w / total]));
}
