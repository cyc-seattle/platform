import type { Context } from "./context.ts";
import type { ComputedActivity } from "./types.ts";

/** Counts each offering's days: the dates it has an activity other than travel. */
export function countDays(ctx: Context, activities: ComputedActivity[]): void {
  const dates = new Map<string, Set<string>>();
  for (const a of activities) {
    if (a.kind === "travel") continue;
    dates.set(a.offering_key, (dates.get(a.offering_key) ?? new Set()).add(a.date));
  }
  for (const [key, set] of dates) ctx.days.set(key, set.size);
}

/** Books each offering's revenue, price × enrollment, with its COGS and card fees. */
export function bookRevenue(ctx: Context): void {
  for (const offering of ctx.fyOfferings()) {
    const product = ctx.products.get(offering.product_id);
    if (product === undefined) {
      ctx.warn("unknown_product", `Offering ${offering.key} names a missing product`, offering.key);
      continue;
    }
    const enrollment = ctx.enrollment.get(offering.id) ?? 0;
    const price = offering.price_cents ?? 0;
    const total = price * enrollment;
    if (total === 0) continue;
    if (product.revenue_account_id == null) {
      ctx.warn("no_revenue_account", `Product ${product.name} has no revenue account`, product.id);
      continue;
    }
    const book = (account: string, amount: number, line: string, explanation: string): void =>
      ctx.book({
        cost_center_type: "offering",
        cost_center_key: offering.key,
        account_id: account,
        function: ctx.functionFor(account, null, "offering"),
        amount,
        line_key: `${line}:${offering.key}`,
        explanation,
      });

    book(product.revenue_account_id, total, "revenue", `${price}¢ × ${enrollment} enrolled`);
    if (offering.cogs_rate != null && offering.cogs_rate > 0) {
      const cogs = ctx.costAccount("cogs");
      if (cogs !== undefined) book(cogs, total * offering.cogs_rate, "cogs", `${offering.cogs_rate} × revenue`);
    }
    const cardFeeRate = ctx.rates?.card_fee_rate ?? 0;
    if (cardFeeRate > 0) {
      const fees = ctx.costAccount("card_fees");
      if (fees !== undefined) book(fees, total * cardFeeRate, "card_fees", `${cardFeeRate} × revenue`);
    }
  }
}
