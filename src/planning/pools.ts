import type { Context, Entry } from "./context.ts";
import { programFees } from "./measures.ts";
import type { Id, PlanData } from "./types.ts";

/** What the year's shared costs are, and how much of them the programs' indirect cost rates allocate. */
export interface IndirectCosts {
  /** Everything in every pool. */
  shared: number;
  /** What the rates charge the programs' offerings. */
  allocated: number;
  /** The one rate that would allocate every shared cost: shared ÷ the programs' fees. Null with no fees. */
  full_recovery_rate: number | null;
}

/** Whether an offering is a program's. Every other offering is non-program, such as a charter. */
function isProgram(ctx: Context, productId: Id): boolean {
  return ctx.products.get(productId)?.kind === "program";
}

/** Each program's indirect cost rate, from its `plan_programs` row. A program with none has no rate. */
export function indirectCostRates(data: PlanData): Map<Id, number> {
  const rates = new Map<Id, number>();
  for (const p of data.plan_programs) if (p.indirect_cost_rate != null) rates.set(p.product_id, p.indirect_cost_rate);
  return rates;
}

/**
 * Charges each program's offerings its indirect cost rate × their own program fees, fixed for the year,
 * so one program's year never changes another's charge (cyc-seattle/platform#296). The charge is split over the
 * pools' lines by their size, keeping each line's account and function. What it doesn't cover of each
 * line stays unallocated with the organization, or, when the rates allocate more, is a credit there. The
 * `unrecovered:` key predates the words Allocated and Unallocated, and stays so stored results keep it.
 */
export function allocateIndirectCosts(ctx: Context): IndirectCosts {
  const rates = indirectCostRates(ctx.data);
  const pooled: Entry[] = [];
  const kept: Entry[] = [];
  for (const e of ctx.entries) (e.cost_center_type === "pool" ? pooled : kept).push(e);
  const shared = pooled.reduce((t, e) => t + e.amount, 0);

  const charges = new Map<Id, number>();
  let fees = 0;
  for (const o of ctx.data.plan_offerings) {
    if (!isProgram(ctx, o.product_id)) continue;
    const base = programFees(ctx, o);
    fees += base;
    const rate = rates.get(o.product_id);
    if (rate === undefined && pooled.length > 0) {
      const name = ctx.products.get(o.product_id)?.name ?? o.product_id;
      ctx.warn("no_indirect_cost_rate", `${name} pays no shared costs.`, o.product_id, { plan_id: o.plan_id });
    }
    charges.set(o.key, (rate ?? 0) * base);
  }
  const full_recovery_rate = fees > 0 ? shared / fees : null;
  let allocated = [...charges.values()].reduce((t, c) => t + c, 0);
  if (shared === 0 && allocated > 0) {
    ctx.warn("no_shared_costs", "No program pays its indirect cost rate.");
    allocated = 0;
  }

  const pools = new Map(ctx.data.plan_pools.map((p) => [p.key, p]));
  ctx.entries.splice(0, ctx.entries.length, ...kept);
  for (const e of pooled) {
    const name = pools.get(e.cost_center_key ?? "")?.name ?? "Pool";
    const part = allocated === 0 ? 0 : e.amount / shared;
    const base = { account_id: e.account_id, function: e.function, stage: "pool" as const, mtdc_share: 0 };
    for (const [key, charge] of charges) {
      ctx.book({
        ...base,
        cost_center_type: "offering",
        cost_center_key: key,
        amount: charge * part,
        line_key: `pool:${e.cost_center_key}:${e.line_key}`,
        line_name: `${name} share: ${e.line_name}`,
        explanation: `${name}: ${e.explanation}, its part of the program's indirect cost rate × its fees`,
      });
    }
    const left = e.amount - allocated * part;
    ctx.book({
      ...base,
      cost_center_type: "org",
      cost_center_key: null,
      amount: left,
      line_key: `unrecovered:${e.cost_center_key}:${e.line_key}`,
      line_name: `${name} ${left >= 0 ? "unallocated" : "over-allocated"}: ${e.line_name}`,
      explanation: `${name}: ${e.explanation}, less what the indirect cost rates allocate`,
    });
  }
  return { shared, allocated, full_recovery_rate };
}
