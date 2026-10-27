import { bookBonuses } from "./bonus.ts";
import { Context, type Entry } from "./context.ts";
import { monthStart } from "./dates.ts";
import { Formulas } from "./formulas.ts";
import { bookBudgetLines, bookLaborLines, CostCenterBooker } from "./lines.ts";
import { mtdc } from "./measures.ts";
import { allocatePools } from "./pools.ts";
import { bookRevenue, enrollmentMetrics } from "./revenue.ts";
import { bookSalaries } from "./salaried.ts";
import { scheduleActivities } from "./schedule.ts";
import { enrollmentOf, Staffing } from "./staffing.ts";
import type { Basis, EngineOutput, MetricName, PlanData, PlanMetric, PlanResult } from "./types.ts";

/**
 * Computes one version set's results and metrics for its fiscal year. The steps run in the order
 * the README gives, each reading only what earlier ones booked.
 */
export function computePlan(data: PlanData): EngineOutput {
  const ctx = new Context(data);
  for (const o of data.plan_offerings) ctx.enrollment.set(o.id, enrollmentOf(o));

  const { activities, coaching } = new Staffing(ctx).run(scheduleActivities(ctx));
  bookRevenue(ctx, activities);
  enrollmentMetrics(ctx);

  const formulas = new Formulas(ctx);
  const booker = new CostCenterBooker(ctx);
  bookBudgetLines(ctx, formulas, booker);
  bookLaborLines(ctx, formulas, booker);
  bookSalaries(ctx, coaching, booker);
  booker.flush();

  formulas.run();
  for (const o of ctx.fyOfferings()) {
    for (const month of ctx.fyMonths) ctx.addMetric(o.key, "mtdc", month, mtdc(ctx, o.key, month));
  }
  allocatePools(ctx);
  bookBonuses(ctx);

  return {
    plan_results: results(ctx.entries, ctx),
    plan_metrics: metrics(ctx),
    activities,
    warnings: ctx.warnings,
  };
}

/** Sums entries into result rows by cost center, account, function, basis, month and line, in whole cents. */
function results(entries: Entry[], ctx: Context): PlanResult[] {
  const rows = new Map<string, PlanResult & { exact: number }>();
  for (const e of entries) {
    if (!ctx.fyMonthSet.has(e.month)) continue;
    const bases: Basis[] = e.basis === "both" ? ["accrual", "cash"] : [e.basis];
    for (const basis of bases) {
      const id = [e.cost_center_type, e.cost_center_key, e.account_id, e.function, basis, e.month, e.line_key].join(
        "|",
      );
      const row = rows.get(id) ?? {
        version_set_key: ctx.data.version_set_key,
        cost_center_type: e.cost_center_type,
        cost_center_key: e.cost_center_key,
        account_id: e.account_id,
        function: e.function,
        basis,
        month: monthStart(e.month),
        amount_cents: 0,
        line_key: e.line_key,
        explanation: e.explanation,
        exact: 0,
      };
      row.exact += e.amount;
      rows.set(id, row);
    }
  }
  // Rounding each line's running total, across its months and cost centers, keeps its total to the cent.
  const carried = new Map<string, number>();
  const rounded = [...rows.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || (a.cost_center_key ?? "").localeCompare(b.cost_center_key ?? ""))
    .map(({ exact, ...row }) => {
      const line = [row.account_id, row.function, row.basis, row.line_key].join("|");
      const before = carried.get(line) ?? 0;
      carried.set(line, before + exact);
      return { ...row, amount_cents: Math.round(before + exact) - Math.round(before) };
    });
  return rounded
    .filter((r) => r.amount_cents !== 0)
    .sort(
      (a, b) =>
        a.basis.localeCompare(b.basis) ||
        a.month.localeCompare(b.month) ||
        (a.cost_center_key ?? "").localeCompare(b.cost_center_key ?? "") ||
        a.line_key.localeCompare(b.line_key) ||
        a.account_id.localeCompare(b.account_id),
    );
}

function metrics(ctx: Context): PlanMetric[] {
  const out: PlanMetric[] = [];
  for (const [key, byMetric] of ctx.metrics) {
    for (const [metric, byMonth] of byMetric) {
      for (const [month, value] of byMonth) {
        if (!ctx.fyMonthSet.has(month) || value === 0) continue;
        out.push({
          version_set_key: ctx.data.version_set_key,
          cost_center_key: key,
          metric: metric as MetricName,
          month: monthStart(month),
          value: Math.round(value * 1e6) / 1e6,
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.cost_center_key.localeCompare(b.cost_center_key) ||
      a.metric.localeCompare(b.metric) ||
      a.month.localeCompare(b.month),
  );
}
