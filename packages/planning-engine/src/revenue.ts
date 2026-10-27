import type { Context } from "./context.ts";
import type { Month } from "./dates.ts";
import type { ComputedActivity, PlanOffering } from "./types.ts";

/** `price_cents`, blended with any price tiers by their shares. Tiers' shares short of 1 pay list price. */
export function effectivePrice(ctx: Context, offering: PlanOffering): number {
  const tiers = ctx.data.plan_offering_prices.filter((p) => p.offering_id === offering.id);
  const tierShare = tiers.reduce((t, p) => t + p.share, 0);
  if (tierShare > 1 + 1e-9) {
    ctx.warn(
      "price_shares_over_one",
      `Offering ${offering.key}'s price tiers' shares add to more than 1`,
      offering.key,
    );
  }
  const tiered = tiers.reduce((t, p) => t + p.price_cents * p.share, 0);
  return tiered + Math.max(0, 1 - tierShare) * (offering.price_cents ?? 0);
}

/** A month's share of a total, from weights; even across `fallback` when the weights are all zero. */
export function proportions(weights: Map<Month, number>, fallback: Month[]): Map<Month, number> {
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  if (total > 0) return new Map([...weights].map(([m, w]) => [m, w / total]));
  return new Map(fallback.map((m) => [m, 1 / fallback.length]));
}

/**
 * Books each offering's revenue and COGS. Accrual follows the service: by sessions per month, else
 * evenly over the offering's months. Cash follows `registration_curve`, else matches accrual.
 */
export function bookRevenue(ctx: Context, activities: ComputedActivity[]): void {
  const sessions = new Map<string, Map<Month, number>>();
  for (const a of activities) {
    if (a.kind === "travel") continue;
    const byMonth = sessions.get(a.offering_id) ?? new Map<Month, number>();
    const month = a.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    sessions.set(a.offering_id, byMonth);
  }

  for (const offering of ctx.data.plan_offerings) {
    const product = ctx.products.get(offering.product_id);
    if (product === undefined) {
      ctx.warn("unknown_product", `Offering ${offering.key} names a missing product`, offering.key);
      continue;
    }
    const enrollment = ctx.enrollment.get(offering.id) ?? 0;
    const months = ctx.offeringMonths(offering);
    const bySession = sessions.get(offering.id) ?? new Map<Month, number>();
    const sessionCount = [...bySession.values()].reduce((t, n) => t + n, 0);
    const price = effectivePrice(ctx, offering);
    const basis = offering.price_basis ?? "per_enrollment";
    let quantity: number;
    let accrual: Map<Month, number>;
    switch (basis) {
      case "per_session":
        quantity = enrollment * sessionCount;
        accrual = proportions(bySession, months);
        break;
      case "per_month":
        quantity = enrollment * months.length;
        accrual = proportions(new Map(), months);
        break;
      case "per_unit":
        quantity = offering.units ?? 0;
        accrual = proportions(bySession, months);
        break;
      default:
        quantity = enrollment;
        accrual = proportions(bySession, months);
    }
    const total = price * quantity;
    if (total === 0) continue;
    if (product.revenue_account_id == null) {
      ctx.warn("no_revenue_account", `Product ${product.name} has no revenue account`, product.id);
      continue;
    }
    const curve = offering.registration_curve;
    const cash = curve != null && Object.keys(curve).length > 0 ? new Map(Object.entries(curve)) : null;
    const explanation = `${price.toFixed(0)}¢ × ${+quantity.toFixed(2)} (${basis})`;

    const bookBoth = (account: string, amount: number, line: string, note: string): void => {
      const base = {
        cost_center_type: "offering" as const,
        cost_center_key: offering.key,
        account_id: account,
        function: ctx.functionFor(account, null, "offering"),
        line_key: `${line}:${offering.key}`,
        explanation: note,
      };
      for (const [month, share] of accrual) {
        ctx.book({ ...base, basis: cash === null ? "both" : "accrual", month, amount: amount * share });
      }
      if (cash !== null) {
        for (const [month, share] of cash) ctx.book({ ...base, basis: "cash", month, amount: amount * share });
      }
    };

    bookBoth(product.revenue_account_id, total, "revenue", explanation);
    if (offering.cogs_rate != null && offering.cogs_rate > 0) {
      bookBoth(ctx.data.posting_accounts.cogs, total * offering.cogs_rate, "cogs", `${offering.cogs_rate} × revenue`);
    }
  }
}

/** Books each offering's enrollment metric in its registration months, else its first month. */
export function enrollmentMetrics(ctx: Context): void {
  for (const offering of ctx.data.plan_offerings) {
    const enrollment = ctx.enrollment.get(offering.id) ?? 0;
    const curve = offering.registration_curve;
    if (curve != null && Object.keys(curve).length > 0) {
      for (const [month, share] of Object.entries(curve)) {
        ctx.addMetric(offering.key, "enrollment", month, enrollment * share);
      }
    } else ctx.addMetric(offering.key, "enrollment", offering.starts_on.slice(0, 7), enrollment);
  }
}
