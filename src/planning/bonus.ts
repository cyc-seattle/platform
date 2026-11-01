import type { Context } from "./context.ts";
import { revenue } from "./measures.ts";
import type { Id, PlanBonusOwner } from "./types.ts";

interface Base {
  net: number;
  offeringKeys: Id[];
}

/**
 * Records each bonus owner's `bonus_rate` × its products' net for the year, above zero, after the
 * pools or before them. Every base is worked out before any bonus is booked, so one bonus never
 * counts in another's base. Each bonus is divided among the owned offerings by revenue, with the
 * year's payroll tax on it, and neither is counted in MTDC. Returns each position's bonus, by
 * position key.
 */
export function bookBonuses(ctx: Context): Map<Id, number> {
  const bonuses = ctx.data.plan_bonus_owners.map((owner) => ({ owner, base: baseOf(ctx, owner) }));
  const taxRate = ctx.rates?.payroll_tax_rate ?? 0;
  const taxAccount = taxRate > 0 && bonuses.length > 0 ? ctx.costAccount("payroll_tax") : undefined;
  const byPosition = new Map<Id, number>();

  for (const { owner, base } of bonuses) {
    const bonus = owner.bonus_rate * Math.max(0, base.net);
    if (bonus === 0) continue;
    const weights = new Map<Id, number>();
    for (const key of base.offeringKeys) {
      const r = revenue(ctx, key);
      if (r > 0) weights.set(key, r);
    }
    const total = [...weights.values()].reduce((t, w) => t + w, 0);
    if (total <= 0) continue;
    if (owner.position_key != null) {
      byPosition.set(owner.position_key, (byPosition.get(owner.position_key) ?? 0) + bonus);
    }
    for (const [key, w] of weights) {
      const amount = (bonus * w) / total;
      ctx.book({
        cost_center_type: "offering",
        cost_center_key: key,
        account_id: owner.account_id,
        function: ctx.functionFor(owner.account_id, null, "offering"),
        amount,
        line_key: `bonus:${owner.key}`,
        explanation: `${owner.role_name}: ${owner.bonus_rate} × net of its products`,
        stage: "bonus",
        mtdc_share: 0,
      });
      if (taxAccount === undefined) continue;
      ctx.book({
        cost_center_type: "offering",
        cost_center_key: key,
        account_id: taxAccount,
        function: ctx.functionFor(owner.account_id, null, "offering"),
        amount: amount * taxRate,
        line_key: `bonus_payroll_tax:${owner.key}`,
        explanation: `${taxRate} × ${owner.role_name}'s bonus`,
        stage: "bonus",
        mtdc_share: 0,
      });
    }
  }
  return byPosition;
}

/**
 * The owner's products' net for the year, and their offerings. An area plan's bonus counts only that
 * area's products, and warns about any other.
 */
function baseOf(ctx: Context, owner: PlanBonusOwner): Base {
  const plan = ctx.planOfVersion.get(owner.version_id);
  const products = new Set<Id>();
  for (const row of ctx.data.plan_bonus_owner_products) {
    if (row.bonus_owner_id !== owner.id) continue;
    const product = ctx.products.get(row.product_id);
    if (plan?.kind === "program_area" && product?.program_area_id !== plan.program_area_id) {
      ctx.warn(
        "bonus_outside_area",
        `${owner.role_name}'s bonus names ${product?.name ?? row.product_id}, which isn't in its plan's program area, so it's left out`,
        owner.key,
      );
      continue;
    }
    products.add(row.product_id);
  }

  const offeringKeys = new Set(
    ctx
      .fyOfferings()
      .filter((o) => products.has(o.product_id))
      .map((o) => o.key),
  );
  const afterPools = (owner.basis ?? "after_shared_costs") === "after_shared_costs";
  let net = 0;
  for (const e of ctx.entries) {
    if (e.stage === "bonus" || (!afterPools && e.stage === "pool") || e.cost_center_key == null) continue;
    const owned =
      (e.cost_center_type === "offering" && offeringKeys.has(e.cost_center_key)) ||
      (e.cost_center_type === "product" && products.has(e.cost_center_key));
    if (!owned) continue;
    const type = ctx.accountType(e.account_id);
    if (type === "revenue") net += e.amount;
    else if (type === "expense") net -= e.amount;
  }
  return { net, offeringKeys: [...offeringKeys] };
}
