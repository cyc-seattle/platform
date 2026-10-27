import type { Context, Entry } from "./context.ts";
import { monthOverlaps, type Month } from "./dates.ts";
import { accountsBase, matchesFilter, measure, spreadWeights } from "./measures.ts";
import type { CostCenterType, Id, PlanPool, PlanPoolShare } from "./types.ts";

interface Component {
  account_id: Id;
  function: Entry["function"];
  basis: Entry["basis"];
  line_key: string;
  explanation: string;
  months: Map<Month, number>;
}

type Target = { type: CostCenterType; key: Id | null };

function addTo(map: Map<Month, number>, month: Month, amount: number): void {
  map.set(month, (map.get(month) ?? 0) + amount);
}

function spreadEvenly(total: number, months: Month[]): Map<Month, number> {
  return new Map(months.map((m) => [m, total / months.length]));
}

/** Removes a pool's entries from the ledger, grouped by what they book. */
function takeComponents(ctx: Context, pool: PlanPool): Component[] {
  const components = new Map<string, Component>();
  const kept: Entry[] = [];
  for (const e of ctx.entries) {
    if (e.cost_center_type !== "pool" || e.cost_center_key !== pool.key) {
      kept.push(e);
      continue;
    }
    const id = [e.account_id, e.function, e.basis, e.line_key].join("|");
    const c = components.get(id) ?? { ...e, months: new Map<Month, number>() };
    addTo(c.months, e.month, e.amount);
    components.set(id, c);
  }
  ctx.entries.splice(0, ctx.entries.length, ...kept);
  return [...components.values()];
}

/**
 * Allocates each pool in `step_order`. A pool keeps the accounts and functions of what flows in, and
 * passes what its shares leave unclaimed to its remainder pool, else the org. Bases count only
 * direct costs and formulas, never another pool's allocation.
 */
export function allocatePools(ctx: Context): void {
  const pools = [...ctx.data.plan_pools].sort((a, b) => a.step_order - b.step_order || a.name.localeCompare(b.name));
  const byId = new Map(pools.map((p) => [p.id, p]));

  for (const pool of pools) {
    const components = takeComponents(ctx, pool);
    if (components.length === 0) continue;
    const allocator = new Allocator(ctx, pool);

    let remainder: Target = { type: "org", key: null };
    const next = pool.remainder_pool_id == null ? undefined : byId.get(pool.remainder_pool_id);
    if (next !== undefined && next.step_order > pool.step_order) remainder = { type: "pool", key: next.key };
    else if (next !== undefined) {
      ctx.warn(
        "remainder_pool_order",
        `Pool ${pool.name}'s remainder pool comes no later in step_order, so it goes to the org`,
        pool.key,
      );
    }

    for (const c of components) {
      const months = allocator.rephase(c.months);
      for (const [month, amount] of months) {
        const inflow = components.reduce((t, x) => t + (allocator.rephase(x.months).get(month) ?? 0), 0);
        const { shares, unclaimed } = allocator.shares(month, inflow);
        const book = (target: Target, value: number): void =>
          ctx.book({
            cost_center_type: target.type,
            cost_center_key: target.key,
            account_id: c.account_id,
            function: c.function,
            basis: c.basis,
            month,
            amount: value,
            line_key: `pool:${pool.key}:${c.line_key}`,
            explanation: `${pool.name} (${pool.method}): ${c.explanation}`,
            stage: "pool",
            in_mtdc: false,
            in_base: false,
          });
        for (const [target, share] of shares) book(target, amount * share);
        if (Math.abs(unclaimed) > 1e-12) book(remainder, amount * unclaimed);
      }
    }
  }
}

class Allocator {
  private readonly ctx: Context;
  private readonly pool: PlanPool;
  private readonly targets: Id[];
  private readonly base = new Map<Id, Map<Month, number>>();
  private readonly poolShares: PlanPoolShare[];
  private readonly rephased = new Map<Map<Month, number>, Map<Month, number>>();
  private warnedBase = false;

  constructor(ctx: Context, pool: PlanPool) {
    this.ctx = ctx;
    this.pool = pool;
    this.targets = ctx
      .fyOfferings()
      .filter((o) => matchesFilter(ctx, o.key, pool.targets_filter))
      .map((o) => o.key);
    this.poolShares = ctx.data.plan_pool_shares.filter((s) => s.pool_id === pool.id);
    if (pool.method === "base_share" || pool.phasing === "by_base") {
      for (const key of this.targets) {
        this.base.set(key, new Map(ctx.fyMonths.map((m) => [m, Math.max(0, this.baseOf(key, m))])));
      }
    }
  }

  private baseOf(key: Id, month: Month): number {
    const { ctx, pool } = this;
    if (pool.base === "accounts") return accountsBase(ctx, key, pool.base_categories ?? [], month);
    const value = measure(ctx, pool.base ?? "mtdc", key, month);
    if (value !== undefined) return value;
    if (!this.warnedBase) {
      ctx.warn(
        "unknown_pool_base",
        `Pool ${pool.name}'s base "${pool.base}" isn't a measure, so it uses mtdc`,
        pool.key,
      );
      this.warnedBase = true;
    }
    return measure(ctx, "mtdc", key, month) ?? 0;
  }

  /** The pool's monthly profile under its `phasing`; null keeps the months it was booked in. */
  rephase(months: Map<Month, number>): Map<Month, number> {
    const cached = this.rephased.get(months);
    if (cached !== undefined) return cached;
    const { ctx, pool } = this;
    const total = [...months.values()].reduce((t, v) => t + v, 0);
    let result = months;
    if (pool.phasing === "even") result = spreadEvenly(total, ctx.fyMonths);
    else if (pool.phasing === "target_months") {
      const active = ctx.fyMonths.filter((m) =>
        this.targets.some((key) => {
          const o = ctx.offeringsByKey.get(key);
          return o !== undefined && monthOverlaps(m, o.starts_on, o.ends_on);
        }),
      );
      result = spreadEvenly(total, active.length > 0 ? active : ctx.fyMonths);
    } else if (pool.phasing === "by_base") {
      const perMonth = ctx.fyMonths.map((m) => [m, this.totalBase(m)] as const);
      const sum = perMonth.reduce((t, [, v]) => t + v, 0);
      result = sum > 0 ? new Map(perMonth.map(([m, v]) => [m, (total * v) / sum])) : spreadEvenly(total, ctx.fyMonths);
    }
    this.rephased.set(months, result);
    return result;
  }

  private totalBase(month?: Month): number {
    let total = 0;
    for (const byMonth of this.base.values()) {
      for (const [m, v] of byMonth) if (month === undefined || m === month) total += v;
    }
    return total;
  }

  /** Each target's share of the month's amount, and the share left unclaimed. */
  shares(month: Month, inflow: number): { shares: Map<Target, number>; unclaimed: number } {
    const { ctx, pool } = this;
    const out = new Map<Target, number>();
    if (pool.method === "base_share") {
      const monthTotal = this.totalBase(month);
      const annual = monthTotal > 0 ? null : this.totalBase();
      const denominator = monthTotal > 0 ? monthTotal : (annual ?? 0);
      if (denominator <= 0) {
        ctx.warn("empty_pool_base", `Pool ${pool.name} has no base in ${month}, so it goes to its remainder`, pool.key);
        return { shares: out, unclaimed: 1 };
      }
      for (const key of this.targets) {
        const byMonth = this.base.get(key) ?? new Map<Month, number>();
        const b = monthTotal > 0 ? (byMonth.get(month) ?? 0) : [...byMonth.values()].reduce((t, v) => t + v, 0);
        if (b > 0) out.set({ type: "offering", key }, b / denominator);
      }
      return { shares: out, unclaimed: 0 };
    }

    const active = this.poolShares.filter((s) => monthOverlaps(month, s.starts_on, s.ends_on));
    let fractions: [PlanPoolShare, number][];
    if (pool.method === "fixed_shares") fractions = active.map((s) => [s, s.share ?? 0]);
    else if (pool.method === "area") {
      const denominator = pool.denominator_quantity ?? active.reduce((t, s) => t + (s.quantity ?? 0), 0);
      fractions = denominator > 0 ? active.map((s) => [s, (s.quantity ?? 0) / denominator]) : [];
    } else {
      // `formula`: each share claims a fixed annual amount, spread over its months in the year.
      if (inflow === 0) return { shares: out, unclaimed: 1 };
      fractions = active.map((s) => {
        const months = ctx.fyMonths.filter((m) => monthOverlaps(m, s.starts_on, s.ends_on)).length;
        return [s, (s.amount_cents ?? 0) / months / inflow];
      });
    }
    let claimed = fractions.reduce((t, [, f]) => t + f, 0);
    if (claimed > 1 + 1e-9 && pool.method !== "formula") {
      ctx.warn(
        "pool_shares_over_one",
        `Pool ${pool.name}'s shares claim more than all of ${month}, so they're scaled`,
        pool.key,
      );
      fractions = fractions.map(([s, f]) => [s, f / claimed]);
      claimed = 1;
    }
    if (claimed > 1 + 1e-9) {
      ctx.warn("pool_overclaimed", `Pool ${pool.name}'s amounts exceed its inflow in ${month}`, pool.key);
    }

    for (const [share, fraction] of fractions) {
      if (share.target_type === "offering") {
        out.set({ type: "offering", key: share.target_key }, fraction);
        continue;
      }
      const weights = spreadWeights(ctx, share.target_key, "by_mtdc", month);
      if (weights === null) out.set({ type: "product", key: share.target_key }, fraction);
      else for (const [key, w] of weights) out.set({ type: "offering", key }, fraction * w);
    }
    return { shares: out, unclaimed: 1 - claimed };
  }
}
