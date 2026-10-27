import type { Context, Entry } from "./context.ts";

/** Books payroll tax on every wage booked so far, at the year's rate, to the same place as the wage. */
export function bookPayrollTax(ctx: Context): void {
  const rate = ctx.rates?.payroll_tax_rate ?? 0;
  if (rate <= 0) return;
  const wages = new Map<
    string,
    Pick<Entry, "cost_center_type" | "cost_center_key" | "function"> & { amount: number }
  >();
  for (const e of ctx.entries) {
    if (!e.wages) continue;
    const id = [e.cost_center_type, e.cost_center_key, e.function].join("|");
    const sum = wages.get(id) ?? { ...e, amount: 0 };
    sum.amount += e.amount;
    wages.set(id, sum);
  }
  if (wages.size === 0) return;
  const account = ctx.costAccount("payroll_tax");
  if (account === undefined) return;
  for (const w of wages.values()) {
    ctx.book({
      cost_center_type: w.cost_center_type,
      cost_center_key: w.cost_center_key,
      account_id: account,
      function: w.function,
      amount: w.amount * rate,
      line_key: "payroll_tax",
      explanation: `${rate} × wages`,
    });
  }
}
