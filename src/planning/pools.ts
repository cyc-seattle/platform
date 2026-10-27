import type { Context, Entry } from "./context.ts";
import { mtdc } from "./measures.ts";

/**
 * Splits everything booked to each pool over every offering in the plan year by MTDC, keeping each
 * amount's account and function. MTDC counts direct costs only, so one pool's split never shifts
 * another's.
 */
export function allocatePools(ctx: Context): void {
  const weights = new Map(ctx.fyOfferings().map((o) => [o.key, Math.max(0, mtdc(ctx, o.key))]));
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  const pools = new Map(ctx.data.plan_pools.map((p) => [p.key, p]));

  const pooled: Entry[] = [];
  const kept: Entry[] = [];
  for (const e of ctx.entries) (e.cost_center_type === "pool" ? pooled : kept).push(e);
  if (pooled.length === 0) return;
  ctx.entries.splice(0, ctx.entries.length, ...kept);

  if (total <= 0) {
    ctx.warn("no_mtdc", "No offering in the plan year has MTDC, so the pools stay with the organization");
  }
  for (const e of pooled) {
    const pool = pools.get(e.cost_center_key ?? "");
    const base = {
      account_id: e.account_id,
      function: e.function,
      line_key: `pool:${e.cost_center_key}:${e.line_key}`,
      explanation: `${pool?.name ?? "Pool"}: ${e.explanation}`,
      stage: "pool" as const,
      mtdc_share: 0,
    };
    if (total <= 0) {
      ctx.book({ ...base, cost_center_type: "org", cost_center_key: null, amount: e.amount });
      continue;
    }
    for (const [key, w] of weights) {
      ctx.book({ ...base, cost_center_type: "offering", cost_center_key: key, amount: (e.amount * w) / total });
    }
  }
}
