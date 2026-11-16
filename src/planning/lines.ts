import type { Context, EntryInput } from "./context.ts";
import { spreadWeights } from "./measures.ts";
import type { CostCenterType, Id, PlanBudgetLine } from "./types.ts";

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
        const key = entry.cost_center_key ?? "";
        const name =
          entry.cost_center_type === "product"
            ? (this.ctx.products.get(key)?.name ?? key)
            : (this.ctx.areas.get(key)?.name ?? key);
        this.ctx.warn(
          `${entry.cost_center_type}_without_offerings`,
          `${name} has no offerings this year, so ${entry.line_name} stays on it.`,
          entry.cost_center_key ?? undefined,
        );
        this.ctx.book(entry);
        return;
      }
      for (const [key, share] of w) {
        this.ctx.book({
          ...entry,
          cost_center_type: "offering",
          cost_center_key: key,
          amount: entry.amount * share,
          paid_hours: (entry.paid_hours ?? 0) * share,
        });
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
  if (!known)
    ctx.warn("unknown_cost_center", `Line ${line}'s ${type.replace("_", " ")} ${key ?? ""} isn't in the plan.`, line);
  return known;
}

/**
 * Warns about a Program Plan line that moves a cost off its area's programs, for a Plan Admin to
 * look over before making the plan active (cyc-seattle/platform#251). Only a Plan Admin changes the
 * Operations Plan, so its lines never get these. Capital charged anywhere but the
 * organization already has its own warning, `capital_off_org`.
 */
function warnCostShift(
  ctx: Context,
  line: Pick<PlanBudgetLine, "plan_id" | "key" | "name" | "cost_center_type" | "account_id"> & {
    in_mtdc?: boolean;
  },
): void {
  if (ctx.planOf.get(line.plan_id)?.kind !== "program_area") return;
  const warn = (message: string) => ctx.warn("cost_off_programs", message, line.key, { plan_id: line.plan_id });
  const org = ctx.data.organization.name;
  const capital = ctx.accountType(line.account_id) === "asset";
  if (capital && line.cost_center_type === "org") {
    warn(`${line.name} is capital, so ${org} pays for it.`);
  } else if (line.cost_center_type === "org") warn(`${line.name} is charged to ${org}.`);
  else if (line.cost_center_type === "pool") warn(`${line.name} is charged to shared costs.`);
  if (line.in_mtdc === false) {
    warn(`${line.name} is left out of the shared-cost split, so other areas pay more.`);
  }
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
    warnCostShift(ctx, line);
    if (capital && line.cost_center_type !== "org") {
      ctx.warn("capital_off_org", `${line.name} is capital, so ${ctx.data.organization.name} pays for it.`, line.key);
    }
    booker.add({
      cost_center_type: onOrg ? "org" : line.cost_center_type,
      cost_center_key: onOrg ? null : line.cost_center_key,
      account_id: line.account_id,
      function: ctx.functionFor(line.account_id, line.function, onOrg ? "org" : line.cost_center_type),
      amount: line.amount_cents,
      line_key: `budget:${line.key}`,
      line_name: line.name,
      explanation: line.name,
      mtdc_share: line.in_mtdc ? 1 : 0,
    });
  }
}

/** Records `plan_labor_lines`: hours × the staff level's rate, as wages. */
export function bookLaborLines(ctx: Context, booker: CostCenterBooker): void {
  const rates = new Map(ctx.data.plan_staff_levels.map((l) => [l.staff_level_id, l.hourly_rate_cents]));
  const names = new Map(ctx.data.staff_levels.map((l) => [l.id, l.name]));
  for (const line of ctx.data.plan_labor_lines) {
    if (!checkCostCenter(ctx, line.cost_center_type, line.cost_center_key, line.key)) continue;
    warnCostShift(ctx, line);
    const level = line.staff_level_id;
    const rate = level == null ? undefined : rates.get(level);
    if (level == null || rate === undefined) {
      ctx.warn("unknown_staff_level", `Labor line ${line.key}'s staff level has no rate. It's left out.`, line.key);
      continue;
    }
    booker.add({
      cost_center_type: line.cost_center_type,
      cost_center_key: line.cost_center_type === "org" ? null : line.cost_center_key,
      account_id: line.account_id,
      function: ctx.functionFor(line.account_id, line.function, line.cost_center_type),
      amount: line.hours * rate,
      line_key: `labor:${line.key}`,
      line_name: line.name,
      explanation: `${line.name}: hours × ${names.get(level) ?? "the staff level"}'s rate`,
      wages: true,
      paid_hours: rate > 0 ? line.hours : 0,
    });
  }
}
