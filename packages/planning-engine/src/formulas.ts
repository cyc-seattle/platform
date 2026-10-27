import { EngineError, type Context, type EntryInput } from "./context.ts";
import { monthStart, type Month } from "./dates.ts";
import { evaluate, namesIn, parseFormula, type Expr } from "./formula.ts";
import { matchesFilter, measure, MEASURE_NAMES, spreadWeights } from "./measures.ts";
import type { Id, PlanFormula } from "./types.ts";

interface Compiled {
  formula: PlanFormula;
  expr: Expr;
  names: Set<string>;
}

/** Where one evaluation runs: an offering's or product's month, a month, or the whole year. */
interface Point {
  month?: Month;
  offeringKey?: Id;
  productId?: Id;
}

function pointKey(p: Point): string {
  return `${p.offeringKey ?? p.productId ?? ""}|${p.month ?? ""}`;
}

/**
 * Parses every formula and orders them so each follows what it reads. A formula reads assumptions,
 * measures, `none` formulas, and formulas of its own dimension.
 */
export class Formulas {
  private readonly ctx: Context;
  private readonly byName = new Map<string, Compiled>();
  readonly order: Compiled[] = [];
  private readonly values = new Map<string, Map<string, number>>();
  private lineScope: Map<string, number> | undefined;

  constructor(ctx: Context) {
    this.ctx = ctx;
    const assumptionNames = new Set(ctx.data.plan_assumptions.map((a) => a.name));
    for (const formula of ctx.data.plan_formulas) {
      if (this.byName.has(formula.name)) throw new EngineError(`Two formulas are named "${formula.name}"`);
      if (assumptionNames.has(formula.name) || MEASURE_NAMES.has(formula.name)) {
        throw new EngineError(`Formula "${formula.name}" shadows an assumption or measure`);
      }
      let expr: Expr;
      try {
        expr = parseFormula(formula.expression);
      } catch (e) {
        throw new EngineError(`Formula "${formula.name}": ${(e as Error).message}`);
      }
      this.byName.set(formula.name, { formula, expr, names: namesIn(expr) });
    }

    for (const c of this.byName.values()) {
      for (const name of c.names) {
        const dep = this.byName.get(name);
        if (dep !== undefined) {
          const ok = dep.formula.dimension === "none" || dep.formula.dimension === c.formula.dimension;
          if (!ok) {
            throw new EngineError(
              `Formula "${c.formula.name}" (${c.formula.dimension}) can't read "${name}" (${dep.formula.dimension})`,
            );
          }
        } else if (!assumptionNames.has(name) && !MEASURE_NAMES.has(name)) {
          throw new EngineError(`Formula "${c.formula.name}" reads unknown name "${name}"`);
        }
      }
      const declared = new Set(
        ctx.data.plan_formula_deps.filter((d) => d.formula_id === c.formula.id).map((d) => d.depends_on),
      );
      const missing = [...c.names].filter((n) => !declared.has(n));
      if (missing.length > 0) {
        ctx.warn(
          "undeclared_formula_deps",
          `Formula "${c.formula.name}" reads ${missing.join(", ")} without a plan_formula_deps row`,
          c.formula.key,
        );
      }
    }

    const state = new Map<string, "visiting" | "done">();
    const visit = (c: Compiled, path: string[]): void => {
      const s = state.get(c.formula.name);
      if (s === "done") return;
      if (s === "visiting") throw new EngineError(`Formulas form a cycle: ${[...path, c.formula.name].join(" → ")}`);
      state.set(c.formula.name, "visiting");
      for (const name of c.names) {
        const dep = this.byName.get(name);
        if (dep !== undefined) visit(dep, [...path, c.formula.name]);
      }
      state.set(c.formula.name, "done");
      this.order.push(c);
    };
    for (const c of [...this.byName.values()].sort((a, b) => a.formula.name.localeCompare(b.formula.name))) {
      visit(c, []);
    }
  }

  /** Whether a formula reads only assumptions and other such formulas, so a line's formula can use it. */
  private isPure(c: Compiled, seen = new Set<string>()): boolean {
    if (c.formula.dimension !== "none" || seen.has(c.formula.name)) return c.formula.dimension === "none";
    seen.add(c.formula.name);
    for (const name of c.names) {
      if (MEASURE_NAMES.has(name)) return false;
      const dep = this.byName.get(name);
      if (dep !== undefined && !this.isPure(dep, seen)) return false;
    }
    return true;
  }

  /**
   * Evaluates a budget line's `formula` or a labor line's `hours_formula`. It reads assumptions in
   * effect at the fiscal year's start, and `none` formulas that read no measure.
   */
  evaluateLine(source: string, what: string): number {
    if (this.lineScope === undefined) {
      const scope = this.ctx.assumptionsOn(monthStart(this.ctx.fyMonths[0] as Month));
      for (const c of this.order) {
        if (!this.isPure(c)) continue;
        scope.set(
          c.formula.name,
          evaluate(c.expr, (n) => scope.get(n)),
        );
      }
      this.lineScope = scope;
    }
    const scope = this.lineScope;
    try {
      return evaluate(parseFormula(source), (n) => scope.get(n));
    } catch (e) {
      throw new EngineError(`${what}: ${(e as Error).message}`);
    }
  }

  private points(c: Compiled): Point[] {
    const { ctx } = this;
    const filter = c.formula.applies_to_filter;
    switch (c.formula.dimension) {
      case "none":
        return [{}];
      case "month":
        return ctx.fyMonths.map((month) => ({ month }));
      case "offering":
        return ctx
          .fyOfferings()
          .filter((o) => matchesFilter(ctx, o.key, filter))
          .flatMap((o) =>
            ctx
              .offeringMonths(o)
              .filter((m) => ctx.fyMonthSet.has(m))
              .map((month) => ({ month, offeringKey: o.key })),
          );
      case "product": {
        const points = new Map<string, Point>();
        for (const o of ctx.fyOfferings().filter((o) => matchesFilter(ctx, o.key, filter))) {
          for (const month of ctx.offeringMonths(o).filter((m) => ctx.fyMonthSet.has(m))) {
            points.set(`${o.product_id}|${month}`, { month, productId: o.product_id });
          }
        }
        return [...points.values()];
      }
    }
  }

  private read(name: string, at: Point): number | undefined {
    const { ctx } = this;
    const dep = this.byName.get(name);
    if (dep !== undefined) {
      const values = this.values.get(name);
      return dep.formula.dimension === "none" ? (values?.get(pointKey({})) ?? 0) : (values?.get(pointKey(at)) ?? 0);
    }
    if (MEASURE_NAMES.has(name)) {
      const offerings =
        at.offeringKey !== undefined
          ? [at.offeringKey]
          : ctx
              .fyOfferings()
              .filter((o) => at.productId === undefined || o.product_id === at.productId)
              .map((o) => o.key);
      return offerings.reduce((t, key) => t + (measure(ctx, name, key, at.month) ?? 0), 0);
    }
    return ctx.assumptionsOn(monthStart(at.month ?? (ctx.fyMonths[0] as Month))).get(name);
  }

  /**
   * Evaluates every formula and books those with an account. Every formula reads the measures as
   * the direct costs left them, so none sees another's bookings.
   */
  run(): void {
    const { ctx } = this;
    const bookings: EntryInput[] = [];
    for (const c of this.order) {
      const values = new Map<string, number>();
      this.values.set(c.formula.name, values);
      for (const at of this.points(c)) {
        let value: number;
        try {
          value = evaluate(c.expr, (n) => this.read(n, at));
        } catch (e) {
          throw new EngineError(`Formula "${c.formula.name}": ${(e as Error).message}`);
        }
        values.set(pointKey(at), value);
      }
      const { formula } = c;
      if (formula.account_id == null) continue;
      const natural = { none: "org", month: "org", offering: "offering", product: "offering" }[formula.dimension];
      if (
        formula.cost_center_type != null &&
        formula.cost_center_type !== natural &&
        formula.cost_center_type !== "product"
      ) {
        ctx.warn(
          "formula_cost_center",
          `Formula "${formula.name}" books by its dimension, ${formula.dimension}, not to its ${formula.cost_center_type} cost center`,
          formula.key,
        );
      }
      const base = {
        account_id: formula.account_id,
        basis: "both" as const,
        line_key: `formula:${formula.key}`,
        explanation: `${formula.name} = ${formula.expression}`,
        stage: "formula" as const,
        in_mtdc: !formula.excluded_from_base,
        in_base: !formula.excluded_from_base,
      };
      for (const at of this.points(c)) {
        const amount = values.get(pointKey(at)) ?? 0;
        if (formula.dimension === "none") {
          for (const month of ctx.fyMonths) {
            bookings.push({
              ...base,
              cost_center_type: "org",
              cost_center_key: null,
              function: ctx.functionFor(formula.account_id, formula.function, "org"),
              month,
              amount: amount / ctx.fyMonths.length,
            });
          }
        } else if (formula.dimension === "month") {
          bookings.push({
            ...base,
            cost_center_type: "org",
            cost_center_key: null,
            function: ctx.functionFor(formula.account_id, formula.function, "org"),
            month: at.month as Month,
            amount,
          });
        } else if (at.offeringKey !== undefined) {
          bookings.push({
            ...base,
            cost_center_type: "offering",
            cost_center_key: at.offeringKey,
            function: ctx.functionFor(formula.account_id, formula.function, "offering"),
            month: at.month as Month,
            amount,
          });
        } else if (at.productId !== undefined) {
          const weights = spreadWeights(ctx, at.productId, "by_mtdc", at.month);
          for (const [key, share] of weights ?? new Map([[at.productId, 1]])) {
            bookings.push({
              ...base,
              cost_center_type: weights === null ? "product" : "offering",
              cost_center_key: key,
              function: ctx.functionFor(formula.account_id, formula.function, "offering"),
              month: at.month as Month,
              amount: amount * share,
            });
          }
        }
      }
    }
    for (const b of bookings) ctx.book(b);
  }
}
