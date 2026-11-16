import type { Context } from "./context.ts";
import type { Id, PlanTerm } from "./types.ts";

/** Each offering's term, by offering key, in no particular order. Null for an offering in none. */
export type OfferingTerms = Map<Id, PlanTerm | null>;

/**
 * Finds each offering's term in the plan's terms. An offering whose term isn't there, such as one deleted
 * from the Operations Plan, is in none, with a warning.
 */
export function offeringTerms(ctx: Context): OfferingTerms {
  const terms = new Map((ctx.data.plan_terms ?? []).map((t) => [t.key, t]));
  const byOffering: OfferingTerms = new Map();
  for (const o of ctx.data.plan_offerings) {
    const term = o.term_key == null ? null : (terms.get(o.term_key) ?? null);
    if (o.term_key != null && term === null) {
      ctx.warn("unknown_term", `${o.name}'s term isn't in the Operations Plan, so it's in no term.`, o.key);
    }
    byOffering.set(o.key, term);
  }
  return byOffering;
}

/** Orders terms by their first days, then names, with no term (null) last. */
export function compareTerms(a: PlanTerm | null, b: PlanTerm | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
}
