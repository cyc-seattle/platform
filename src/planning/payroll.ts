import type { Context, Entry } from "./context.ts";
import type { PlanPayrollTax } from "./types.ts";

/** What a payroll tax charges on wages of `amount` cents behind `hours` paid hours. */
export function payrollTax(tax: PlanPayrollTax, amount: number, hours: number): number {
  return tax.wage_share != null ? amount * tax.wage_share : hours * (tax.hourly_cents ?? 0);
}

/** How a payroll tax is worked out, in words. */
export function payrollTaxBasis(tax: PlanPayrollTax): string {
  return tax.wage_share != null ? `${tax.wage_share} × wages` : `${tax.hourly_cents}¢ × paid hours`;
}

/**
 * Records each payroll tax on every wage so far, wherever the wage is: a share of wages, or an
 * amount for each paid hour.
 */
export function bookPayrollTax(ctx: Context): void {
  const taxes = ctx.payrollTaxes;
  if (taxes.length === 0) return;
  warnUnpaidHours(ctx, taxes);
  const wages = new Map<
    string,
    Pick<Entry, "cost_center_type" | "cost_center_key" | "function"> & { amount: number; hours: number }
  >();
  for (const e of ctx.entries) {
    if (!e.wages) continue;
    const id = [e.cost_center_type, e.cost_center_key, e.function].join("|");
    const sum = wages.get(id) ?? { ...e, amount: 0, hours: 0 };
    sum.amount += e.amount;
    sum.hours += e.paid_hours;
    wages.set(id, sum);
  }
  if (wages.size === 0) return;
  const account = ctx.costAccount("payroll_tax");
  if (account === undefined) return;
  for (const w of wages.values()) {
    for (const tax of taxes) {
      ctx.book({
        cost_center_type: w.cost_center_type,
        cost_center_key: w.cost_center_key,
        account_id: account,
        function: w.function,
        amount: payrollTax(tax, w.amount, w.hours),
        line_key: `payroll_tax:${tax.key}`,
        line_name: tax.name,
        explanation: payrollTaxBasis(tax),
      });
    }
  }
}

/** A salary with no paid hours has none for a tax by the hour to be charged on. */
function warnUnpaidHours(ctx: Context, taxes: PlanPayrollTax[]): void {
  const hourly = taxes.find((t) => t.hourly_cents != null);
  if (hourly === undefined) return;
  for (const position of ctx.data.plan_salaried_positions) {
    if (position.annual_salary_cents <= 0 || (position.paid_hours_per_year ?? 0) > 0) continue;
    ctx.warn(
      "no_paid_hours_for_tax",
      `${position.name} has no paid hours a year, so no ${hourly.name} on its salary.`,
      position.key,
    );
  }
}
