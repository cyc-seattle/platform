import { scheduleActivities } from "./activities.ts";
import { bookBonuses } from "./bonus.ts";
import { Context } from "./context.ts";
import { bookBudgetLines, bookLaborLines, CostCenterBooker } from "./lines.ts";
import { mtdc } from "./measures.ts";
import { bookPayrollTax } from "./payroll.ts";
import { allocatePools } from "./pools.ts";
import { bookRevenue, countDays } from "./revenue.ts";
import { bookSalaries, type PositionCharges } from "./salaried.ts";
import { enrollmentOf, Staffing, type SalariedCoaching } from "./staffing.ts";
import type {
  CostLine,
  EngineOutput,
  Id,
  OrganizationTotals,
  Pnl,
  PlanData,
  PositionSummary,
  Totals,
} from "./types.ts";

/**
 * Calculates the plan year's P&L from a plan's rows. The steps run in the order
 * docs/planning-engine.md gives, each reading only what earlier steps recorded.
 */
export function computePlan(data: PlanData): EngineOutput {
  const ctx = new Context(data);
  for (const o of data.plan_offerings) ctx.enrollment.set(o.id, enrollmentOf(o));
  checkAreas(ctx);

  const { activities, coaching } = new Staffing(ctx).run(scheduleActivities(ctx));
  countDays(ctx, activities);
  bookRevenue(ctx);

  const booker = new CostCenterBooker(ctx);
  bookBudgetLines(ctx, booker);
  bookLaborLines(ctx, booker);
  const charged = bookSalaries(ctx, coaching, booker);
  booker.flush();
  bookPayrollTax(ctx);

  const mtdcByOffering = new Map(ctx.fyOfferings().map((o) => [o.key, mtdc(ctx, o.key)]));
  allocatePools(ctx);
  const bonuses = bookBonuses(ctx);

  const lines = sumLines(ctx);
  return {
    lines,
    pnl: summarize(ctx, lines, mtdcByOffering),
    organization: organizationTotals(ctx, lines),
    activities,
    positions: summarizePositions(ctx, coaching, charged, bonuses),
    warnings: ctx.warnings,
  };
}

/**
 * Warns about a program with no program area, an area on another kind of product, and an offering
 * in the wrong plan: a program area's plan holds only its own programs, and the Operations Plan only
 * products in no area. The catalog stays live, so the database can't check these.
 */
function checkAreas(ctx: Context): void {
  for (const offering of ctx.fyOfferings()) {
    const product = ctx.products.get(offering.product_id);
    if (product === undefined) continue;
    if (product.kind === "program" && product.program_area_id == null) {
      ctx.warn("program_without_area", `Program ${product.name} has no program area`, product.id);
    } else if (product.kind !== "program" && product.program_area_id != null) {
      ctx.warn("area_on_non_program", `Product ${product.name} isn't a program, but has a program area`, product.id);
    }
    const plan = ctx.planOfVersion.get(offering.version_id);
    if (plan === undefined) continue;
    const wrong =
      plan.kind === "operations"
        ? product.program_area_id != null
        : product.program_area_id != null && product.program_area_id !== plan.program_area_id;
    if (wrong) {
      const where = plan.kind === "operations" ? "the Operations Plan" : "another program area's plan";
      ctx.warn("offering_in_wrong_plan", `Offering ${offering.name} of ${product.name} is in ${where}`, offering.key);
    }
  }
}

/** Each salaried position's year: its salary, where its hours went, and its hourly wages and bonus. */
function summarizePositions(
  ctx: Context,
  coaching: SalariedCoaching[],
  charged: Map<Id, PositionCharges>,
  bonuses: Map<Id, number>,
): PositionSummary[] {
  const taxRate = ctx.rates?.payroll_tax_rate ?? 0;
  const known = new Set(ctx.data.plan_salaried_positions.map((p) => p.key));
  const named = [
    ...coaching.map((c) => c.position_key),
    ...ctx.data.plan_bonus_owners.flatMap((o) => (o.position_key == null ? [] : [o.position_key])),
  ];
  for (const key of new Set(named)) {
    if (!known.has(key)) {
      ctx.warn("unknown_position", `A block, offering or bonus names missing salaried position ${key}`, key);
    }
  }
  return ctx.data.plan_salaried_positions.map((position) => {
    const hourly = coaching.filter((c) => c.position_key === position.key && c.pay === "hourly");
    const charges = charged.get(position.key);
    const hourlyCents = hourly.reduce((t, c) => t + c.wages, 0);
    const bonus = bonuses.get(position.key) ?? 0;
    const total = position.annual_salary_cents + hourlyCents + bonus;
    return {
      position_key: position.key,
      name: position.name,
      salary_cents: position.annual_salary_cents,
      salaried_coaching_hours: charges?.coaching_hours ?? 0,
      salaried_coaching_cents: Math.round(charges?.coaching_cents ?? 0),
      hourly_coaching_hours: hourly.reduce((t, c) => t + c.hours, 0),
      hourly_coaching_cents: Math.round(hourlyCents),
      booking_hours: charges?.booking_hours ?? 0,
      booking_cents: Math.round(charges?.booking_cents ?? 0),
      bonus_cents: Math.round(bonus),
      total_pay_cents: Math.round(total),
      payroll_tax_cents: Math.round(total * taxRate),
    };
  });
}

/**
 * The organization's year from every line. Capital is any line on an asset account; fundraising is
 * revenue and expense whose function is `fundraising`; everything else is operating.
 */
function organizationTotals(ctx: Context, lines: CostLine[]): OrganizationTotals {
  const operating = { revenue_cents: 0, expense_cents: 0, net_cents: 0 };
  const fundraising = { revenue_cents: 0, expense_cents: 0, net_cents: 0 };
  let capital = 0;
  for (const l of lines) {
    const type = ctx.accountType(l.account_id);
    if (type === "asset") {
      capital += l.amount_cents;
      continue;
    }
    const totals = l.function === "fundraising" ? fundraising : operating;
    if (type === "revenue") totals.revenue_cents += l.amount_cents;
    else if (type === "expense") totals.expense_cents += l.amount_cents;
  }
  for (const t of [operating, fundraising]) t.net_cents = t.revenue_cents - t.expense_cents;
  return {
    operating,
    fundraising,
    capital_cents: capital,
    total_cents: operating.net_cents + fundraising.net_cents - capital,
  };
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

/** Each plan-year offering's P&L, then each product's, then each program area's. */
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
  const areaIds = new Set<Id>();
  for (const o of offerings) {
    const area = ctx.products.get(o.product_id)?.program_area_id;
    if (area != null) areaIds.add(area);
  }
  for (const l of lines)
    if (l.cost_center_type === "program_area" && l.cost_center_key !== null) areaIds.add(l.cost_center_key);
  const areaPnl = [...areaIds].sort().map((id) => {
    const own = offeringPnl.filter((s) => {
      const product = ctx.offeringsByKey.get(s.key)?.product_id;
      return product !== undefined && ctx.products.get(product)?.program_area_id === id;
    });
    const keys = new Set(own.map((s) => s.key));
    const products = new Set(own.map((s) => ctx.offeringsByKey.get(s.key)?.product_id));
    const add = (field: "mtdc_cents" | "enrollment" | "days" | "sailor_days"): number =>
      own.reduce((t, s) => t + s[field], 0);
    return pnl(
      "program_area",
      id,
      lines.filter(
        (l) =>
          (l.cost_center_type === "offering" && l.cost_center_key !== null && keys.has(l.cost_center_key)) ||
          (l.cost_center_type === "product" && products.has(l.cost_center_key ?? undefined)) ||
          (l.cost_center_type === "program_area" && l.cost_center_key === id),
      ),
      {
        mtdc_cents: add("mtdc_cents"),
        enrollment: add("enrollment"),
        days: add("days"),
        sailor_days: add("sailor_days"),
      },
    );
  });
  return [...offeringPnl, ...productPnl, ...areaPnl];
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
