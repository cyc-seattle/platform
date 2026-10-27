import type { Context } from "./context.ts";
import { monthOverlaps } from "./dates.ts";
import { revenue } from "./measures.ts";
import type { Id } from "./types.ts";

/**
 * Books each bonus owner's `bonus_rate × max(0, combined net)` over its window in the fiscal year,
 * after every pool. It goes to the owned products' offerings by revenue, evenly over the window's
 * months, and counts in no base.
 */
export function bookBonuses(ctx: Context): void {
  for (const owner of ctx.data.plan_bonus_owners) {
    const products = new Set(
      ctx.data.plan_bonus_owner_products.filter((p) => p.bonus_owner_id === owner.id).map((p) => p.product_id),
    );
    const months = ctx.fyMonths.filter((m) => monthOverlaps(m, owner.starts_on, owner.ends_on));
    const monthSet = new Set(months);
    const offeringKeys = new Set(ctx.data.plan_offerings.filter((o) => products.has(o.product_id)).map((o) => o.key));

    let net = 0;
    for (const e of ctx.entries) {
      if (e.basis === "cash" || !monthSet.has(e.month)) continue;
      const owned =
        (e.cost_center_type === "offering" && e.cost_center_key != null && offeringKeys.has(e.cost_center_key)) ||
        (e.cost_center_type === "product" && e.cost_center_key != null && products.has(e.cost_center_key));
      if (!owned) continue;
      const type = ctx.accountType(e.account_id);
      if (type === "revenue") net += e.amount;
      else if (type === "expense") net -= e.amount;
    }
    const bonus = owner.bonus_rate * Math.max(0, net);
    if (bonus === 0 || months.length === 0) continue;

    const weights = new Map<Id, number>();
    for (const key of offeringKeys) {
      const r = months.reduce((t, m) => t + revenue(ctx, key, m), 0);
      if (r > 0) weights.set(key, r);
    }
    const total = [...weights.values()].reduce((t, w) => t + w, 0);
    for (const [key, w] of weights) {
      for (const month of months) {
        ctx.book({
          cost_center_type: "offering",
          cost_center_key: key,
          account_id: owner.account_id,
          function: ctx.functionFor(owner.account_id, null, "offering"),
          basis: "both",
          month,
          amount: (bonus * w) / total / months.length,
          line_key: `bonus:${owner.key}`,
          explanation: `${owner.role_name}: ${owner.bonus_rate} × combined net of its products`,
          stage: "bonus",
          in_mtdc: false,
          in_base: false,
        });
      }
    }
  }
}
