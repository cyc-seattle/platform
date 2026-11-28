import type { Context } from "./context.ts";
import type { CostCenterBooker } from "./lines.ts";
import type { SalariedCoaching } from "./staffing.ts";
import type { Id } from "./types.ts";

interface Charge {
  cost_center_type: "offering" | "product" | "program_area";
  cost_center_id: Id;
  hours: number;
  line: string;
}

/** What a position's hours charged to programs, by position id, for its summary. */
export interface PositionCharges {
  coaching_hours: number;
  coaching_cents: number;
  booking_hours: number;
  booking_cents: number;
}

/**
 * Charges each salaried position's salary: its coaching and management hours at its hourly
 * equivalent go to what they served, and the rest, including its `ga_share` off the top, goes to its
 * remainder pool, or the organization if it has none.
 */
export function bookSalaries(
  ctx: Context,
  coaching: SalariedCoaching[],
  booker: CostCenterBooker,
): Map<Id, PositionCharges> {
  const charged = new Map<Id, PositionCharges>();
  if (ctx.data.plan_salaried_positions.length === 0) return charged;
  const account = ctx.costAccount("salaries");
  if (account === undefined) return charged;
  const pools = new Map(ctx.data.plan_pools.map((p) => [p.id, p]));

  for (const position of ctx.data.plan_salaried_positions) {
    const salary = position.annual_salary_cents;
    const rate =
      position.paid_hours_per_year != null && position.paid_hours_per_year > 0
        ? salary / position.paid_hours_per_year
        : null;

    const charges: Charge[] = [
      ...coaching
        .filter((c) => c.position_id === position.id && c.pay === "salary")
        .map((c) => ({
          cost_center_type: "offering" as const,
          cost_center_id: c.offering_id,
          hours: c.hours,
          line: "coaching",
        })),
      ...ctx.data.plan_salaried_bookings
        .filter((b) => b.position_id === position.id)
        .flatMap((b) => {
          if ((b.product_id == null) === (b.program_area_id == null)) {
            ctx.warn(
              "booking_cost_center",
              `Booking ${b.id} needs a product or an area, not both. It's left out.`,
              b.id,
            );
            return [];
          }
          return [
            b.product_id != null
              ? {
                  cost_center_type: "product" as const,
                  cost_center_id: b.product_id,
                  hours: b.hours,
                  line: "management",
                }
              : {
                  cost_center_type: "program_area" as const,
                  cost_center_id: b.program_area_id as Id,
                  hours: b.hours,
                  line: "management",
                },
          ];
        }),
    ];
    if (rate === null && charges.length > 0) {
      ctx.warn(
        "no_paid_hours",
        `${position.name} has no paid hours a year, so its hours on programs cost nothing.`,
        position.id,
      );
    }

    const available = salary * (1 - (position.ga_share ?? 0));
    const demand = charges.reduce((t, c) => t + c.hours * (rate ?? 0), 0);
    const scale = demand > available && demand > 0 ? available / demand : 1;
    if (scale < 1) {
      ctx.warn(
        "position_overbooked",
        `${position.name}'s hours on programs cost more than its salary allows, so they're cut to fit.`,
        position.id,
      );
    }
    const sums: PositionCharges = { coaching_hours: 0, coaching_cents: 0, booking_hours: 0, booking_cents: 0 };
    for (const c of charges) {
      const amount = c.hours * (rate ?? 0) * scale;
      if (c.line === "coaching") {
        sums.coaching_hours += c.hours;
        sums.coaching_cents += amount;
      } else {
        sums.booking_hours += c.hours;
        sums.booking_cents += amount;
      }
    }
    charged.set(position.id, sums);
    for (const c of charges) {
      booker.add({
        cost_center_type: c.cost_center_type,
        cost_center_id: c.cost_center_id,
        account_id: account,
        function: ctx.functionFor(account, null, "offering"),
        amount: c.hours * (rate ?? 0) * scale,
        line_key: `salary:${position.id}:${c.line}`,
        line_name: `${position.name}: ${c.line}`,
        explanation: `${position.name}: ${c.line} hours at the salary's hourly equivalent`,
        wages: true,
        paid_hours: c.hours * scale,
      });
    }

    const remainderPool = position.remainder_pool_id == null ? undefined : pools.get(position.remainder_pool_id);
    booker.add({
      cost_center_type: remainderPool === undefined ? "org" : "pool",
      cost_center_id: remainderPool?.id ?? null,
      account_id: account,
      function: ctx.functionFor(account, null, "pool"),
      amount: salary - demand * scale,
      line_key: `salary:${position.id}:remainder`,
      line_name: `${position.name}: rest of salary`,
      explanation: `${position.name}: salary not charged to coaching or bookings`,
      wages: true,
      paid_hours: rate === null ? 0 : (salary - demand * scale) / rate,
    });
  }
  return charged;
}
