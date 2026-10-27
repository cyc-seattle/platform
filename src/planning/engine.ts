import { scheduleActivities } from "./activities.ts";
import { bookBonuses } from "./bonus.ts";
import { Context } from "./context.ts";
import { bookBudgetLines, bookLaborLines, CostCenterBooker } from "./lines.ts";
import { mtdc } from "./measures.ts";
import { bookPayrollTax } from "./payroll.ts";
import { allocatePools } from "./pools.ts";
import { bookRevenue, countDays } from "./revenue.ts";
import { bookSalaries } from "./salaried.ts";
import { enrollmentOf, Staffing } from "./staffing.ts";
import type { CostLine, EngineOutput, Id, Pnl, PlanData, Totals } from "./types.ts";

/**
 * Calculates the plan year's P&L from a plan's rows. The steps run in the order
 * docs/planning-engine.md gives, each reading only what earlier steps recorded.
 */
export function computePlan(data: PlanData): EngineOutput {
  const ctx = new Context(data);
  for (const o of data.plan_offerings) ctx.enrollment.set(o.id, enrollmentOf(o));

  const { activities, coaching } = new Staffing(ctx).run(scheduleActivities(ctx));
  countDays(ctx, activities);
  bookRevenue(ctx);

  const booker = new CostCenterBooker(ctx);
  bookBudgetLines(ctx, booker);
  bookLaborLines(ctx, booker);
  bookSalaries(ctx, coaching, booker);
  booker.flush();
  bookPayrollTax(ctx);

  const mtdcByOffering = new Map(ctx.fyOfferings().map((o) => [o.key, mtdc(ctx, o.key)]));
  allocatePools(ctx);
  bookBonuses(ctx);

  const lines = sumLines(ctx);
  return { lines, pnl: summarize(ctx, lines, mtdcByOffering), activities, warnings: ctx.warnings };
}

/** Sums entries into lines by cost center, account, function and line key, in whole cents. */
function sumLines(ctx: Context): CostLine[] {
  const lines = new Map<string, CostLine & { exact: number }>();
  for (const e of ctx.entries) {
    const id = [e.cost_center_type, e.cost_center_key, e.account_id, e.function, e.line_key].join("|");
    const line = lines.get(id) ?? {
      cost_center_type: e.cost_center_type,
      cost_center_key: e.cost_center_key,
      account_id: e.account_id,
      function: e.function,
      amount_cents: 0,
      line_key: e.line_key,
      explanation: e.explanation,
      exact: 0,
    };
    line.exact += e.amount;
    lines.set(id, line);
  }
  // Rounding each line key's running total across cost centers keeps its total to the cent.
  const carried = new Map<string, number>();
  return [...lines.values()]
    .sort(
      (a, b) =>
        (a.cost_center_key ?? "").localeCompare(b.cost_center_key ?? "") ||
        a.line_key.localeCompare(b.line_key) ||
        a.account_id.localeCompare(b.account_id) ||
        a.cost_center_type.localeCompare(b.cost_center_type),
    )
    .map(({ exact, ...line }) => {
      const id = [line.account_id, line.function, line.line_key].join("|");
      const before = carried.get(id) ?? 0;
      carried.set(id, before + exact);
      return { ...line, amount_cents: Math.round(before + exact) - Math.round(before) };
    })
    .filter((l) => l.amount_cents !== 0);
}

/** Each plan-year offering's P&L, then each product's. */
function summarize(ctx: Context, lines: CostLine[], mtdcByOffering: Map<Id, number>): Pnl[] {
  const pnl = (
    level: Pnl["level"],
    key: Id,
    own: CostLine[],
    counts: Pick<Pnl, "mtdc_cents" | "enrollment" | "days" | "sailor_days">,
  ): Pnl => {
    const byAccount = new Map<Id, number>();
    let revenue = 0;
    let expense = 0;
    for (const l of own) {
      byAccount.set(l.account_id, (byAccount.get(l.account_id) ?? 0) + l.amount_cents);
      const type = ctx.accountType(l.account_id);
      if (type === "revenue") revenue += l.amount_cents;
      else if (type === "expense") expense += l.amount_cents;
    }
    return {
      level,
      key,
      revenue_cents: revenue,
      expense_cents: expense,
      net_cents: revenue - expense,
      by_account: [...byAccount]
        .filter(([, amount]) => amount !== 0)
        .map(([account_id, amount_cents]) => ({ account_id, amount_cents }))
        .sort((a, b) => a.account_id.localeCompare(b.account_id)),
      ...counts,
    };
  };

  const offerings = ctx.fyOfferings().sort((a, b) => a.key.localeCompare(b.key));
  const offeringPnl = offerings.map((o) => {
    const enrollment = ctx.enrollment.get(o.id) ?? 0;
    const days = ctx.days.get(o.key) ?? 0;
    return pnl(
      "offering",
      o.key,
      lines.filter((l) => l.cost_center_type === "offering" && l.cost_center_key === o.key),
      { mtdc_cents: Math.round(mtdcByOffering.get(o.key) ?? 0), enrollment, days, sailor_days: enrollment * days },
    );
  });

  const productIds = new Set(offerings.map((o) => o.product_id));
  for (const l of lines)
    if (l.cost_center_type === "product" && l.cost_center_key !== null) productIds.add(l.cost_center_key);
  const productPnl = [...productIds].sort().map((id) => {
    const own = offeringPnl.filter((s) => ctx.offeringsByKey.get(s.key)?.product_id === id);
    const keys = new Set(own.map((s) => s.key));
    const add = (field: "mtdc_cents" | "enrollment" | "days" | "sailor_days"): number =>
      own.reduce((t, s) => t + s[field], 0);
    return pnl(
      "product",
      id,
      lines.filter(
        (l) =>
          (l.cost_center_type === "offering" && l.cost_center_key !== null && keys.has(l.cost_center_key)) ||
          (l.cost_center_type === "product" && l.cost_center_key === id),
      ),
      {
        mtdc_cents: add("mtdc_cents"),
        enrollment: add("enrollment"),
        days: add("days"),
        sailor_days: add("sailor_days"),
      },
    );
  });
  return [...offeringPnl, ...productPnl];
}

function divide(totals: Totals, by: number): Totals | null {
  if (by <= 0) return null;
  return {
    revenue_cents: Math.round(totals.revenue_cents / by),
    expense_cents: Math.round(totals.expense_cents / by),
    net_cents: Math.round(totals.net_cents / by),
  };
}

/** An offering's or product's P&L for one day it runs. Null when it has no days. */
export function perDay(pnl: Pnl): Totals | null {
  return divide(pnl, pnl.days);
}

/** An offering's or product's P&L for one sailor on one day. Null when it has no sailor-days. */
export function perSailorDay(pnl: Pnl): Totals | null {
  return divide(pnl, pnl.sailor_days);
}
