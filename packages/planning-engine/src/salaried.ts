import type { Context } from "./context.ts";
import { monthOverlaps, type Month } from "./dates.ts";
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
 * Charges each salaried position's monthly salary: its coaching and management hours at its hourly
 * equivalent go to what they served, and the rest, including its `ga_share` off the top, goes to its
 * remainder pool, else the org.
 */
export function bookSalaries(ctx: Context, coaching: SalariedCoaching[], booker: CostCenterBooker): void {
  const account = ctx.data.posting_accounts.salaries;
  const pools = new Map(ctx.data.plan_pools.map((p) => [p.id, p]));
  const known = new Set(ctx.data.plan_salaried_positions.map((p) => p.key));
  for (const c of coaching) {
    if (!known.has(c.position_key)) {
      ctx.warn("unknown_position", `A block rule names missing salaried position ${c.position_key}`, c.position_key);
    }
  }

  for (const position of ctx.data.plan_salaried_positions) {
    const months = ctx.fyMonths.filter((m) => monthOverlaps(m, position.effective_from, position.effective_to));
    const monthly = position.annual_salary_cents / 12;
    const rate =
      position.paid_hours_per_year != null && position.paid_hours_per_year > 0
        ? position.annual_salary_cents / position.paid_hours_per_year
        : null;

    const charges = new Map<Month, Charge[]>();
    const charge = (month: Month, c: Charge): void => {
      charges.set(month, [...(charges.get(month) ?? []), c]);
    };
    for (const c of coaching) {
      if (c.position_key !== position.key || !ctx.fyMonthSet.has(c.month)) continue;
      if (!months.includes(c.month)) {
        ctx.warn(
          "position_inactive",
          `${position.name} coaches in ${c.month}, outside its effective dates`,
          position.key,
        );
        continue;
      }
      charge(c.month, {
        cost_center_type: "offering",
        cost_center_key: c.offering_key,
        hours: c.hours,
        line: "coaching",
      });
    }
    for (const b of ctx.data.plan_salaried_bookings.filter((b) => b.position_id === position.id)) {
      const bookingMonths = months.filter((m) => monthOverlaps(m, b.starts_on, b.ends_on));
      for (const m of bookingMonths) {
        charge(m, {
          cost_center_type: "product",
          cost_center_key: b.product_id,
          hours: b.hours / bookingMonths.length,
          line: b.kind,
        });
      }
    }
    if (rate === null && charges.size > 0) {
      ctx.warn(
        "no_paid_hours",
        `${position.name} has hours booked but no paid_hours_per_year, so they cost nothing`,
        position.key,
      );
    }

    const remainderPool = position.remainder_pool_id == null ? undefined : pools.get(position.remainder_pool_id);
    for (const month of months) {
      const monthCharges = charges.get(month) ?? [];
      const available = monthly * (1 - (position.ga_share ?? 0));
      const demand = monthCharges.reduce((t, c) => t + c.hours * (rate ?? 0), 0);
      const scale = demand > available && demand > 0 ? available / demand : 1;
      if (scale < 1) {
        ctx.warn(
          "position_overbooked",
          `${position.name}'s hours in ${month} cost more than its salary less ga_share, so they're scaled down`,
          position.key,
        );
      }
      for (const c of monthCharges) {
        const amount = c.hours * (rate ?? 0) * scale;
        booker.add(
          {
            cost_center_type: c.cost_center_type,
            cost_center_key: c.cost_center_key,
            account_id: account,
            function: ctx.functionFor(account, null, "offering"),
            basis: "both",
            month,
            amount,
            line_key: `salary:${position.key}:${c.line}`,
            explanation: `${position.name}: ${c.line} hours at the salary's hourly equivalent`,
          },
          "by_mtdc",
          (key, s) => {
            if (key === null) return;
            ctx.addMetric(key, "wages", month, amount * s);
            ctx.addMetric(key, "paid_hours", month, c.hours * s);
          },
        );
      }
      const remainder = monthly - demand * scale;
      const toPool = remainderPool !== undefined;
      booker.add(
        {
          cost_center_type: toPool ? "pool" : "org",
          cost_center_key: toPool ? remainderPool.key : null,
          account_id: account,
          function: ctx.functionFor(account, null, "pool"),
          basis: "both",
          month,
          amount: remainder,
          line_key: `salary:${position.key}:remainder`,
          explanation: `${position.name}: salary not charged to coaching or bookings`,
        },
        "by_mtdc",
      );
    }
  }
}
