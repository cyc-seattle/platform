import type { Context } from "./context.ts";
import type { CostCenterBooker } from "./lines.ts";
import type { SalariedCoaching } from "./staffing.ts";
import type { Id } from "./types.ts";

interface Charge {
  cost_center_type: "offering" | "product";
  cost_center_key: Id;
  hours: number;
  line: string;
}

/**
 * Charges each salaried position's salary: its coaching and management hours at its hourly
 * equivalent go to what they served, and the rest, including its `ga_share` off the top, goes to its
 * remainder pool, else the org.
 */
export function bookSalaries(ctx: Context, coaching: SalariedCoaching[], booker: CostCenterBooker): void {
  if (ctx.data.plan_salaried_positions.length === 0) return;
  const account = ctx.costAccount("salaries");
  if (account === undefined) return;
  const pools = new Map(ctx.data.plan_pools.map((p) => [p.id, p]));
  const known = new Set(ctx.data.plan_salaried_positions.map((p) => p.key));
  for (const c of coaching) {
    if (!known.has(c.position_key)) {
      ctx.warn("unknown_position", `A block rule names missing salaried position ${c.position_key}`, c.position_key);
    }
  }

  for (const position of ctx.data.plan_salaried_positions) {
    const salary = position.annual_salary_cents;
    const rate =
      position.paid_hours_per_year != null && position.paid_hours_per_year > 0
        ? salary / position.paid_hours_per_year
        : null;

    const charges: Charge[] = [
      ...coaching
        .filter((c) => c.position_key === position.key)
        .map((c) => ({
          cost_center_type: "offering" as const,
          cost_center_key: c.offering_key,
          hours: c.hours,
          line: "coaching",
        })),
      ...ctx.data.plan_salaried_bookings
        .filter((b) => b.position_id === position.id)
        .map((b) => ({
          cost_center_type: "product" as const,
          cost_center_key: b.product_id,
          hours: b.hours,
          line: b.kind,
        })),
    ];
    if (rate === null && charges.length > 0) {
      ctx.warn(
        "no_paid_hours",
        `${position.name} has hours booked but no paid_hours_per_year, so they cost nothing`,
        position.key,
      );
    }

    const available = salary * (1 - (position.ga_share ?? 0));
    const demand = charges.reduce((t, c) => t + c.hours * (rate ?? 0), 0);
    const scale = demand > available && demand > 0 ? available / demand : 1;
    if (scale < 1) {
      ctx.warn(
        "position_overbooked",
        `${position.name}'s hours cost more than its salary less ga_share, so they're scaled down`,
        position.key,
      );
    }
    for (const c of charges) {
      booker.add({
        cost_center_type: c.cost_center_type,
        cost_center_key: c.cost_center_key,
        account_id: account,
        function: ctx.functionFor(account, null, "offering"),
        amount: c.hours * (rate ?? 0) * scale,
        line_key: `salary:${position.key}:${c.line}`,
        explanation: `${position.name}: ${c.line} hours at the salary's hourly equivalent`,
        wages: true,
      });
    }

    const remainderPool = position.remainder_pool_id == null ? undefined : pools.get(position.remainder_pool_id);
    booker.add({
      cost_center_type: remainderPool === undefined ? "org" : "pool",
      cost_center_key: remainderPool?.key ?? null,
      account_id: account,
      function: ctx.functionFor(account, null, "pool"),
      amount: salary - demand * scale,
      line_key: `salary:${position.key}:remainder`,
      explanation: `${position.name}: salary not charged to coaching or bookings`,
      wages: true,
    });
  }
}
