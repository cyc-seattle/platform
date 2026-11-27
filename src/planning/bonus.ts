import type { Context } from "./context.ts";
import { revenue } from "./measures.ts";
import { payrollTaxBasis } from "./payroll.ts";
import { compareTerms, type OfferingTerms } from "./terms.ts";
import type { BonusSummary, Id, PlanBonusOwner, PlanPayrollTax, PlanTerm } from "./types.ts";

interface Base {
  term: PlanTerm | null;
  net: number;
  offeringIds: Id[];
}

/**
 * Records each bonus owner's `bonus_rate` × its products' net in each term, above zero, after the
 * pools or before them. A term's loss doesn't lower another term's bonus. Offerings in no term, and
 * anything not on an offering, make one more base, for the year. Every base is worked out before any
 * bonus is booked, so one bonus never counts in another's base. Each bonus is divided among that
 * base's offerings by revenue, with each payroll tax on wages on it, and neither is counted in MTDC.
 * A bonus pays for no hours, so no tax by the hour is charged on it.
 * Returns each bonus, by owner and term.
 */
export function bookBonuses(ctx: Context, terms: OfferingTerms): BonusSummary[] {
  const bonuses = ctx.data.plan_bonus_owners.map((owner) => ({ owner, bases: basesOf(ctx, owner, terms) }));
  const taxes = ctx.payrollTaxes.filter((t) => t.wage_share != null);
  const taxAccount = taxes.length > 0 && bonuses.length > 0 ? ctx.costAccount("payroll_tax") : undefined;
  const summaries: BonusSummary[] = [];

  for (const { owner, bases } of bonuses) {
    const area = areaOf(ctx, owner);
    for (const base of bases) {
      const bonus = owner.bonus_rate * Math.max(0, base.net);
      const booked = bonus === 0 ? 0 : bookBonus(ctx, owner, base, bonus, taxes, taxAccount);
      summaries.push({
        bonus_owner_id: owner.id,
        role_name: owner.role_name,
        position_id: owner.position_id ?? null,
        program_area_id: area,
        term_id: base.term?.id ?? null,
        bonus_rate: owner.bonus_rate,
        net_cents: Math.round(base.net),
        bonus_cents: Math.round(booked),
      });
    }
  }
  return summaries;
}

/** Books one term's bonus on its offerings, by revenue. Returns what it booked. */
function bookBonus(
  ctx: Context,
  owner: PlanBonusOwner,
  base: Base,
  bonus: number,
  taxes: PlanPayrollTax[],
  taxAccount: Id | undefined,
): number {
  const weights = new Map<Id, number>();
  for (const key of base.offeringIds) {
    const r = revenue(ctx, key);
    if (r > 0) weights.set(key, r);
  }
  if (weights.size === 0) {
    if (base.offeringIds.length === 0) {
      ctx.warn(
        "bonus_without_offerings",
        `${owner.role_name}'s bonus has no offerings this year. It's left out.`,
        owner.id,
      );
      return 0;
    }
    // Its net came from elsewhere, such as revenue booked on a product, so its offerings share it evenly.
    ctx.warn(
      "bonus_without_revenue",
      `${owner.role_name}'s offerings have no revenue, so its bonus is split evenly.`,
      owner.id,
    );
    for (const key of base.offeringIds) weights.set(key, 1);
  }
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  for (const [key, w] of weights) {
    const amount = (bonus * w) / total;
    ctx.book({
      cost_center_type: "offering",
      cost_center_id: key,
      account_id: owner.account_id,
      function: ctx.functionFor(owner.account_id, null, "offering"),
      amount,
      line_key: `bonus:${owner.id}`,
      line_name: `Bonus: ${owner.role_name}`,
      explanation: `${owner.role_name}: ${owner.bonus_rate} × net of its products ${base.term === null ? "in no term" : `in ${base.term.name}`}`,
      stage: "bonus",
      mtdc_share: 0,
    });
    if (taxAccount === undefined) continue;
    for (const tax of taxes) {
      ctx.book({
        cost_center_type: "offering",
        cost_center_id: key,
        account_id: taxAccount,
        function: ctx.functionFor(owner.account_id, null, "offering"),
        amount: amount * (tax.wage_share ?? 0),
        line_key: `bonus_payroll_tax:${owner.id}:${tax.id}`,
        line_name: `${tax.name} on bonus: ${owner.role_name}`,
        explanation: `${payrollTaxBasis(tax)} on ${owner.role_name}'s bonus`,
        stage: "bonus",
        mtdc_share: 0,
      });
    }
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
 * The owner's products' net in each term they have an offering in, with those offerings, in term
 * order and then no term. An owner with a `term_id` has only that term's. An area plan's bonus
 * counts only that area's products, and warns about any other.
 */
function basesOf(ctx: Context, owner: PlanBonusOwner, terms: OfferingTerms): Base[] {
  const plan = ctx.planOf.get(owner.plan_id);
  const products = new Set<Id>();
  for (const row of ctx.data.plan_bonus_owner_products) {
    if (row.bonus_owner_id !== owner.id) continue;
    const product = ctx.products.get(row.product_id);
    if (plan?.kind === "program_area" && product?.program_area_id !== plan.program_area_id) {
      ctx.warn(
        "bonus_outside_area",
        `${owner.role_name}'s bonus names ${product?.name ?? row.product_id}, from another area. It's left out.`,
        owner.id,
      );
      continue;
    }
    products.add(row.product_id);
  }

  const bases = new Map<Id | null, Base>();
  const baseFor = (term: PlanTerm | null): Base => {
    const base = bases.get(term?.id ?? null) ?? { term, net: 0, offeringIds: [] };
    bases.set(term?.id ?? null, base);
    return base;
  };
  const owned = new Set<Id>();
  for (const o of ctx.data.plan_offerings) {
    if (!products.has(o.product_id)) continue;
    owned.add(o.id);
    baseFor(terms.get(o.id) ?? null).offeringIds.push(o.id);
  }
  const afterPools = (owner.basis ?? "after_shared_costs") === "after_shared_costs";
  for (const e of ctx.entries) {
    if (e.stage === "bonus" || (!afterPools && e.stage === "pool") || e.cost_center_id == null) continue;
    let term: PlanTerm | null;
    if (e.cost_center_type === "offering" && owned.has(e.cost_center_id)) {
      term = terms.get(e.cost_center_id) ?? null;
    } else if (e.cost_center_type === "product" && products.has(e.cost_center_id)) {
      term = null;
    } else continue;
    const type = ctx.accountType(e.account_id);
    if (type === "revenue") baseFor(term).net += e.amount;
    else if (type === "expense") baseFor(term).net -= e.amount;
  }
  if (owner.term_id == null) return [...bases.values()].sort((a, b) => compareTerms(a.term, b.term));
  const term = (ctx.data.plan_terms ?? []).find((t) => t.id === owner.term_id);
  if (term === undefined) {
    ctx.warn("unknown_bonus_term", `${owner.role_name}'s bonus term isn't in the plan, so it isn't paid.`, owner.id);
    return [];
  }
  return [baseFor(term)];
}
