import type { Context, EntryInput } from "./context.ts";
import { monthStart, type Month } from "./dates.ts";
import type { Formulas } from "./formulas.ts";
import { spreadWeights } from "./measures.ts";
import type { CostCenterType, Id, Spread } from "./types.ts";

/** Phasing as `{"YYYY-MM": share}`, else even over the fiscal year. Months outside it are dropped. */
function phase(ctx: Context, phasing: Record<string, number> | null, key: string): Map<Month, number> {
  if (phasing == null || Object.keys(phasing).length === 0) {
    return new Map(ctx.fyMonths.map((m) => [m, 1 / ctx.fyMonths.length]));
  }
  const outside = Object.keys(phasing).filter((m) => !ctx.fyMonthSet.has(m));
  if (outside.length > 0) {
    ctx.warn("phasing_outside_year", `Line ${key} phases into ${outside.join(", ")}, outside the fiscal year`, key);
  }
  return new Map(Object.entries(phasing).filter(([m]) => ctx.fyMonthSet.has(m)));
}

type OnShare = (offeringKey: Id | null, share: number) => void;

/**
 * Books amounts to their cost centers, pushing a product's down to its offerings. Offering, pool and
 * org amounts book at once; a product's wait for `flush`, so its weights see every offering's lines
 * whatever order the lines come in.
 */
export class CostCenterBooker {
  private readonly ctx: Context;
  private readonly weights = new Map<string, Map<Id, number> | null>();
  private readonly pending: { entry: EntryInput; spread: Spread; onShare: OnShare | undefined }[] = [];

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private weightsFor(productId: Id, spread: Spread): Map<Id, number> | null {
    const id = `${productId}|${spread}`;
    if (!this.weights.has(id)) this.weights.set(id, spreadWeights(this.ctx, productId, spread));
    return this.weights.get(id) ?? null;
  }

  /** `onShare` hears each offering's share of the amount, or null for one that stays put. */
  add(entry: EntryInput, spread: Spread, onShare?: OnShare): void {
    if (entry.cost_center_type === "product" && entry.cost_center_key != null) {
      this.pending.push({ entry, spread, onShare });
      return;
    }
    this.ctx.book(entry);
    onShare?.(entry.cost_center_type === "offering" ? entry.cost_center_key : null, 1);
  }

  flush(): void {
    const pending = this.pending.splice(0);
    const weights = pending.map(({ entry, spread }) => this.weightsFor(entry.cost_center_key as Id, spread));
    pending.forEach(({ entry, onShare }, i) => {
      const w = weights[i] ?? null;
      if (w === null) {
        this.ctx.warn(
          "product_without_offerings",
          `Product ${entry.cost_center_key} has no offering in the fiscal year, so ${entry.line_key} stays at the product`,
          entry.cost_center_key ?? undefined,
        );
        this.ctx.book(entry);
        onShare?.(null, 1);
        return;
      }
      for (const [key, share] of w) {
        this.ctx.book({ ...entry, cost_center_type: "offering", cost_center_key: key, amount: entry.amount * share });
        onShare?.(key, share);
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
  if (!known) ctx.warn("unknown_cost_center", `Line ${line} books to a missing ${type} ${key ?? ""}`, line);
  return known;
}

/** Books `plan_budget_lines` for the fiscal year. */
export function bookBudgetLines(ctx: Context, formulas: Formulas, booker: CostCenterBooker): void {
  for (const line of ctx.data.plan_budget_lines) {
    if (line.fiscal_year !== ctx.data.fiscal_year) continue;
    if (!checkCostCenter(ctx, line.cost_center_type, line.cost_center_key, line.key)) continue;
    if (line.is_capital && line.is_non_cash) {
      ctx.warn("capital_and_non_cash", `Line ${line.key} is both capital and non-cash, so it books nothing`, line.key);
      continue;
    }
    let amounts: Map<Month, number>;
    if (line.phasing_mode === "monthly_rate") {
      amounts =
        line.phasing == null
          ? new Map(ctx.fyMonths.map((m) => [m, line.amount_cents ?? 0]))
          : phase(ctx, line.phasing, line.key);
    } else {
      const total =
        line.amount_cents ??
        (line.formula == null ? 0 : formulas.evaluateLine(line.formula, `Budget line ${line.key}`));
      amounts = new Map([...phase(ctx, line.phasing, line.key)].map(([m, share]) => [m, total * share]));
    }
    const basis = line.is_non_cash ? "accrual" : line.is_capital ? "cash" : "both";
    for (const [month, amount] of amounts) {
      booker.add(
        {
          cost_center_type: line.cost_center_type,
          cost_center_key: line.cost_center_type === "org" ? null : line.cost_center_key,
          account_id: line.account_id,
          function: ctx.functionFor(line.account_id, line.function, line.cost_center_type),
          basis,
          month,
          amount,
          line_key: `budget:${line.key}`,
          explanation: line.name,
          in_mtdc: !(line.is_participant_support || line.is_capital || line.excluded_from_base),
          in_base: !line.excluded_from_base,
        },
        line.spread ?? "by_mtdc",
      );
    }
  }
}

/** Books `plan_labor_lines`: hours × the staff level's rate in each month, counted as wages. */
export function bookLaborLines(ctx: Context, formulas: Formulas, booker: CostCenterBooker): void {
  for (const line of ctx.data.plan_labor_lines) {
    if (!checkCostCenter(ctx, line.cost_center_type, line.cost_center_key, line.key)) continue;
    const hours =
      line.hours ??
      (line.hours_formula == null ? 0 : formulas.evaluateLine(line.hours_formula, `Labor line ${line.key}`));
    for (const [month, share] of phase(ctx, line.phasing, line.key)) {
      const level = ctx.effectiveByKey(ctx.data.plan_staff_levels, line.staff_level_key, monthStart(month));
      if (level === undefined) {
        ctx.warn("unknown_staff_level", `Labor line ${line.key} names a missing staff level`, line.key);
        break;
      }
      const volunteer = level.pay_type === "volunteer";
      const monthHours = hours * share;
      const amount = volunteer ? 0 : monthHours * (level.hourly_rate_cents ?? 0);
      booker.add(
        {
          cost_center_type: line.cost_center_type,
          cost_center_key: line.cost_center_type === "org" ? null : line.cost_center_key,
          account_id: line.account_id,
          function: ctx.functionFor(line.account_id, line.function, line.cost_center_type),
          basis: "both",
          month,
          amount,
          line_key: `labor:${line.key}`,
          explanation: `${line.name}: hours × ${level.name}'s rate`,
        },
        "by_mtdc",
        (key, s) => {
          if (key === null) return;
          ctx.addMetric(key, "wages", month, amount * s);
          if (!volunteer) ctx.addMetric(key, "paid_hours", month, monthHours * s);
        },
      );
    }
  }
}
