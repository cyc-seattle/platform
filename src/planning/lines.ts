import type { Context, EntryInput } from "./context.ts";
import { spreadWeights } from "./measures.ts";
import type { CostCenterType, Id } from "./types.ts";

/**
 * Records amounts on their cost centers. Amounts on an offering, a pool or the organization are
 * recorded right away. Amounts on a product wait until `flush`, then are divided among its offerings
 * by MTDC, so every offering's own costs are in first, whatever order the lines come in.
 */
export class CostCenterBooker {
  private readonly ctx: Context;
  private readonly weights = new Map<Id, Map<Id, number> | null>();
  private readonly pending: EntryInput[] = [];

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private weightsFor(productId: Id): Map<Id, number> | null {
    if (!this.weights.has(productId)) this.weights.set(productId, spreadWeights(this.ctx, productId));
    return this.weights.get(productId) ?? null;
  }

  add(entry: EntryInput): void {
    if (entry.cost_center_type === "product" && entry.cost_center_key != null) this.pending.push(entry);
    else this.ctx.book(entry);
  }

  flush(): void {
    const pending = this.pending.splice(0);
    const weights = pending.map((entry) => this.weightsFor(entry.cost_center_key as Id));
    pending.forEach((entry, i) => {
      const w = weights[i] ?? null;
      if (w === null) {
        this.ctx.warn(
          "product_without_offerings",
          `Product ${entry.cost_center_key} has no offering in the plan year, so ${entry.line_key} stays at the product`,
          entry.cost_center_key ?? undefined,
        );
        this.ctx.book(entry);
        return;
      }
      for (const [key, share] of w) {
        this.ctx.book({ ...entry, cost_center_type: "offering", cost_center_key: key, amount: entry.amount * share });
      }
    });
  }
}

function checkCostCenter(ctx: Context, type: CostCenterType, key: Id | null, line: string): boolean {
  const known =
    type === "org" ||
    (type === "offering" && key != null && ctx.offeringsByKey.has(key)) ||
    (type === "product" && key != null && ctx.products.has(key)) ||
    (type === "pool" && key != null && ctx.data.plan_pools.some((p) => p.key === key));
  if (!known) ctx.warn("unknown_cost_center", `Line ${line} is on a missing ${type} ${key ?? ""}`, line);
  return known;
}

/** Records the plan year's `plan_budget_lines`. */
export function bookBudgetLines(ctx: Context, booker: CostCenterBooker): void {
  for (const line of ctx.data.plan_budget_lines) {
    if (line.fiscal_year !== ctx.data.fiscal_year) continue;
    if (!checkCostCenter(ctx, line.cost_center_type, line.cost_center_key, line.key)) continue;
    booker.add({
      cost_center_type: line.cost_center_type,
      cost_center_key: line.cost_center_type === "org" ? null : line.cost_center_key,
      account_id: line.account_id,
      function: ctx.functionFor(line.account_id, line.function, line.cost_center_type),
      amount: line.amount_cents,
      line_key: `budget:${line.key}`,
      explanation: line.name,
      mtdc_share: line.excluded_from_mtdc ? 0 : 1,
    });
  }
}

/** Records `plan_labor_lines`: hours × the staff level's rate, as wages. */
export function bookLaborLines(ctx: Context, booker: CostCenterBooker): void {
  const levels = new Map(ctx.data.plan_staff_levels.map((l) => [l.key, l]));
  for (const line of ctx.data.plan_labor_lines) {
    if (!checkCostCenter(ctx, line.cost_center_type, line.cost_center_key, line.key)) continue;
    const level = levels.get(line.staff_level_key);
    if (level === undefined) {
      ctx.warn("unknown_staff_level", `Labor line ${line.key} names a missing staff level`, line.key);
      continue;
    }
    booker.add({
      cost_center_type: line.cost_center_type,
      cost_center_key: line.cost_center_type === "org" ? null : line.cost_center_key,
      account_id: line.account_id,
      function: ctx.functionFor(line.account_id, line.function, line.cost_center_type),
      amount: level.pay_type === "volunteer" ? 0 : line.hours * (level.hourly_rate_cents ?? 0),
      line_key: `labor:${line.key}`,
      explanation: `${line.name}: hours × ${level.name}'s rate`,
      wages: true,
    });
  }
}
