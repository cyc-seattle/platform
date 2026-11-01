import type { Context, EntryInput } from "./context.ts";
import { spreadWeights } from "./measures.ts";
import type { CostCenterType, Id } from "./types.ts";

/**
 * Records amounts on their cost centers. Amounts on an offering, a pool or the organization are
 * recorded right away. Amounts on a product or program area wait until `flush`, then are divided
 * among its offerings by MTDC, so every offering's own costs are in first, whatever order the lines
 * come in.
 */
export class CostCenterBooker {
  private readonly ctx: Context;
  private readonly weights = new Map<Id, Map<Id, number> | null>();
  private readonly pending: EntryInput[] = [];

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private weightsFor(type: "product" | "program_area", key: Id): Map<Id, number> | null {
    const id = `${type}:${key}`;
    if (!this.weights.has(id)) this.weights.set(id, spreadWeights(this.ctx, type, key));
    return this.weights.get(id) ?? null;
  }

  add(entry: EntryInput): void {
    const spread = entry.cost_center_type === "product" || entry.cost_center_type === "program_area";
    if (spread && entry.cost_center_key != null) this.pending.push(entry);
    else this.ctx.book(entry);
  }

  flush(): void {
    const pending = this.pending.splice(0);
    const weights = pending.map((entry) =>
      this.weightsFor(entry.cost_center_type as "product" | "program_area", entry.cost_center_key as Id),
    );
    pending.forEach((entry, i) => {
      const w = weights[i] ?? null;
      if (w === null) {
        const what = entry.cost_center_type === "product" ? "Product" : "Program area";
        this.ctx.warn(
          `${entry.cost_center_type}_without_offerings`,
          `${what} ${entry.cost_center_key} has no offering in the plan year, so ${entry.line_key} stays there`,
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
    (type === "program_area" && key != null && ctx.areas.has(key)) ||
    (type === "pool" && key != null && ctx.data.plan_pools.some((p) => p.key === key));
  if (!known) ctx.warn("unknown_cost_center", `Line ${line} is on a missing ${type} ${key ?? ""}`, line);
  return known;
}

/**
 * Records the plan year's `plan_budget_lines`. Capital, a line on an asset account, is the
 * organization's: fundraising pays for it, so it never reaches a program area or an offering.
 */
export function bookBudgetLines(ctx: Context, booker: CostCenterBooker): void {
  for (const line of ctx.data.plan_budget_lines) {
    if (line.fiscal_year !== ctx.data.fiscal_year) continue;
    if (!checkCostCenter(ctx, line.cost_center_type, line.cost_center_key, line.key)) continue;
    const capital = ctx.accountType(line.account_id) === "asset";
    const onOrg = line.cost_center_type === "org" || capital;
    if (capital && line.cost_center_type !== "org") {
      ctx.warn(
        "capital_off_org",
        `Line ${line.name} is capital, which only the organization pays for, so it's moved there`,
        line.key,
      );
    }
    booker.add({
      cost_center_type: onOrg ? "org" : line.cost_center_type,
      cost_center_key: onOrg ? null : line.cost_center_key,
      account_id: line.account_id,
      function: ctx.functionFor(line.account_id, line.function, onOrg ? "org" : line.cost_center_type),
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
