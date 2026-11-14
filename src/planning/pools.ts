import type { Context, Entry } from "./context.ts";
import { mtdc } from "./measures.ts";
import type { Id } from "./types.ts";

/** Whether an offering is a program's. Every other offering is non-program, such as a charter. */
function isProgram(ctx: Context, productId: Id): boolean {
  return ctx.products.get(productId)?.kind === "program";
}

/** Non-program's net before the pools: its offerings' revenue less their own costs. */
function nonProgramNet(ctx: Context): number {
  const keys = new Set(ctx.data.plan_offerings.filter((o) => !isProgram(ctx, o.product_id)).map((o) => o.key));
  let net = 0;
  for (const e of ctx.entries) {
    if (e.cost_center_type !== "offering" || !keys.has(e.cost_center_key ?? "")) continue;
    const type = ctx.accountType(e.account_id);
    if (type === "revenue") net += e.amount;
    else if (type === "expense") net -= e.amount;
  }
  return net;
}

/**
 * Divides everything in each pool among the plan's programs' offerings by MTDC, keeping each
 * amount's account and function. Non-program's net offsets the pools first (cyc-seattle/platform#242):
 * that part of each pooled amount stays with the organization, so a gain shrinks every program's
 * share and a loss grows it. Shared costs never count toward MTDC, so one pool's split never shifts
 * another's.
 */
export function allocatePools(ctx: Context): void {
  const weights = new Map(
    ctx.data.plan_offerings
      .filter((o) => isProgram(ctx, o.product_id))
      .map((o) => [o.key, Math.max(0, mtdc(ctx, o.key))]),
  );
  const total = [...weights.values()].reduce((t, w) => t + w, 0);
  const pools = new Map(ctx.data.plan_pools.map((p) => [p.key, p]));

  const pooled: Entry[] = [];
  const kept: Entry[] = [];
  for (const e of ctx.entries) (e.cost_center_type === "pool" ? pooled : kept).push(e);
  if (pooled.length === 0) return;

  const net = nonProgramNet(ctx);
  ctx.entries.splice(0, ctx.entries.length, ...kept);
  const overhead = pooled.reduce((t, e) => t + e.amount, 0);
  // Each pooled amount gives up the same fraction, so the offset falls on each pool in proportion to its size.
  let offset = overhead > 0 ? net / overhead : 0;
  if (offset > 1) {
    ctx.warn(
      "non_program_exceeds_pools",
      `Non-program makes more than all the shared costs, so ${ctx.data.organization.name} keeps all of them`,
    );
    offset = 1;
  }

  if (total <= 0) {
    ctx.warn(
      "no_mtdc",
      `No program's offering this year has costs that count toward MTDC, so ${ctx.data.organization.name} keeps all the shared costs`,
    );
  }
  for (const e of pooled) {
    const name = pools.get(e.cost_center_key ?? "")?.name ?? "Pool";
    const base = {
      account_id: e.account_id,
      function: e.function,
      stage: "pool" as const,
      mtdc_share: 0,
    };
    const share = {
      ...base,
      line_key: `pool:${e.cost_center_key}:${e.line_key}`,
      line_name: `${name} share: ${e.line_name}`,
      explanation: `${name}: ${e.explanation}`,
    };
    if (total <= 0) {
      ctx.book({ ...share, cost_center_type: "org", cost_center_key: null, amount: e.amount });
      continue;
    }
    ctx.book({
      ...base,
      cost_center_type: "org",
      cost_center_key: null,
      amount: e.amount * offset,
      line_key: `offset:${e.cost_center_key}:${e.line_key}`,
      line_name: `${name} covered by non-program: ${e.line_name}`,
      explanation: `${name}: ${e.explanation}, the part non-program's net covers`,
    });
    for (const [key, w] of weights) {
      ctx.book({
        ...share,
        cost_center_type: "offering",
        cost_center_key: key,
        amount: (e.amount * (1 - offset) * w) / total,
      });
    }
  }
}
