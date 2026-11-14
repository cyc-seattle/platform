import type { Context } from "./context.ts";
import { revenue } from "./measures.ts";
import { SEASONS, seasonOf, type Season } from "./seasons.ts";
import type { BonusSummary, Id, PlanBonusOwner } from "./types.ts";

interface Base {
  net: number;
  offeringKeys: Id[];
}

/**
 * Records each bonus owner's `bonus_rate` × its products' net in each season, above zero, after the
 * pools or before them. A season's loss doesn't lower another season's bonus. Offerings in no season,
 * and anything not on an offering, make one more base, for the year. Every base is worked out before
 * any bonus is booked, so one bonus never counts in another's base. Each bonus is divided among that
 * base's offerings by revenue, with the year's payroll tax on it, and neither is counted in MTDC.
 * Returns each bonus, by owner and season.
 */
export function bookBonuses(ctx: Context): BonusSummary[] {
  const bonuses = ctx.data.plan_bonus_owners.map((owner) => ({ owner, bases: basesOf(ctx, owner) }));
  const taxRate = ctx.rates?.payroll_tax_rate ?? 0;
  const taxAccount = taxRate > 0 && bonuses.length > 0 ? ctx.costAccount("payroll_tax") : undefined;
  const summaries: BonusSummary[] = [];

  for (const { owner, bases } of bonuses) {
    const area = areaOf(ctx, owner);
    for (const [season, base] of bases) {
      const bonus = owner.bonus_rate * Math.max(0, base.net);
      const booked = bonus === 0 ? 0 : bookBonus(ctx, owner, season, base, bonus, taxRate, taxAccount);
      summaries.push({
        bonus_owner_key: owner.key,
        role_name: owner.role_name,
        position_key: owner.position_key ?? null,
        program_area_id: area,
        season,
        bonus_rate: owner.bonus_rate,
        net_cents: Math.round(base.net),
        bonus_cents: Math.round(booked),
      });
    }
  }
  return summaries;
}

/** Books one season's bonus on its offerings, by revenue. Returns what it booked. */
function bookBonus(
  ctx: Context,
  owner: PlanBonusOwner,
  season: Season | null,
  base: Base,
  bonus: number,
  taxRate: number,
  taxAccount: Id | undefined,
): number {
  const weights = new Map<Id, number>();
  for (const key of base.offeringKeys) {
    const r = revenue(ctx, key);
    if (r > 0) weights.set(key, r);
  }
  if (weights.size === 0) {
    if (base.offeringKeys.length === 0) {
      ctx.warn(
        "bonus_without_offerings",
        `${owner.role_name}'s bonus has no offerings this year to charge it to, so it's left out`,
        owner.key,
      );
      return 0;
    }
    // Its net came from elsewhere, such as revenue booked on a product, so its offerings share it evenly.
    ctx.warn(
      "bonus_without_revenue",
      `${owner.role_name}'s offerings have no revenue of their own, so its bonus is split evenly among them`,
      owner.key,
    );
    for (const key of base.offeringKeys) weights.set(key, 1);
  }
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  for (const [key, w] of weights) {
    const amount = (bonus * w) / total;
    ctx.book({
      cost_center_type: "offering",
      cost_center_key: key,
      account_id: owner.account_id,
      function: ctx.functionFor(owner.account_id, null, "offering"),
      amount,
      line_key: `bonus:${owner.key}`,
      line_name: `Bonus: ${owner.role_name}`,
      explanation: `${owner.role_name}: ${owner.bonus_rate} × net of its products ${season === null ? "in no season" : `in the ${season}`}`,
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
      line_name: `Payroll tax on bonus: ${owner.role_name}`,
      explanation: `${taxRate} × ${owner.role_name}'s bonus`,
      stage: "bonus",
      mtdc_share: 0,
    });
  }
  return bonus;
}

/** The program area of all the owner's products, or null when they're in more than one or none. */
function areaOf(ctx: Context, owner: PlanBonusOwner): Id | null {
  const areas = new Set(
    ctx.data.plan_bonus_owner_products
      .filter((row) => row.bonus_owner_id === owner.id)
      .map((row) => ctx.products.get(row.product_id)?.program_area_id ?? null),
  );
  return areas.size === 1 ? ([...areas][0] ?? null) : null;
}

/**
 * The owner's products' net in each season they run in, with their offerings, in `SEASONS` order and
 * then no season. An area plan's bonus counts only that area's products, and warns about any other.
 */
function basesOf(ctx: Context, owner: PlanBonusOwner): Map<Season | null, Base> {
  const plan = ctx.planOfVersion.get(owner.version_id);
  const products = new Set<Id>();
  for (const row of ctx.data.plan_bonus_owner_products) {
    if (row.bonus_owner_id !== owner.id) continue;
    const product = ctx.products.get(row.product_id);
    if (plan?.kind === "program_area" && product?.program_area_id !== plan.program_area_id) {
      ctx.warn(
        "bonus_outside_area",
        `${owner.role_name}'s bonus names ${product?.name ?? row.product_id}, which isn't in this plan's program area, so it's left out`,
        owner.key,
      );
      continue;
    }
    products.add(row.product_id);
  }

  const bases = new Map<Season | null, Base>();
  const baseFor = (season: Season | null): Base => {
    const base = bases.get(season) ?? { net: 0, offeringKeys: [] };
    bases.set(season, base);
    return base;
  };
  const seasons = new Map<Id, Season | null>();
  for (const o of ctx.fyOfferings()) {
    if (!products.has(o.product_id)) continue;
    seasons.set(o.key, seasonOf(o));
    baseFor(seasonOf(o)).offeringKeys.push(o.key);
  }
  const afterPools = (owner.basis ?? "after_shared_costs") === "after_shared_costs";
  for (const e of ctx.entries) {
    if (e.stage === "bonus" || (!afterPools && e.stage === "pool") || e.cost_center_key == null) continue;
    let season: Season | null;
    if (e.cost_center_type === "offering" && seasons.has(e.cost_center_key)) {
      season = seasons.get(e.cost_center_key) ?? null;
    } else if (e.cost_center_type === "product" && products.has(e.cost_center_key)) {
      season = null;
    } else continue;
    const type = ctx.accountType(e.account_id);
    if (type === "revenue") baseFor(season).net += e.amount;
    else if (type === "expense") baseFor(season).net -= e.amount;
  }
  const order = [...SEASONS, null];
  return new Map([...bases].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)));
}
