import { randomUUID } from "node:crypto";
import { computePlan, type EngineOutput, type PlanData } from "../../src/planning/index.ts";
import type { DirectusSession } from "./directus.ts";
import { userFor } from "./steps/logins.ts";
import { admin, adminCreate, itemPath, key, PLAN_YEAR, runId, type Item, type Row } from "./steps/rows.ts";

// A small plan the P&L examples build in dev, as an app or agent would: rows entered in Directus,
// read back by a planner, and calculated with the engine. Every figure in them is made up.

/** Dollars as the features write them, such as $1,000 or -$20,000, in cents. */
export function cents(money: string): number {
  return Math.round(Number(money.replace(/[$,]/g, "")) * 100);
}

/** A share as the features write it, such as 2%. */
export function share(percent: string): number {
  return Number(percent.replace("%", "")) / 100;
}

// Directus returns decimals as strings.
const DECIMALS = new Set([
  "rate",
  "payroll_tax_rate",
  "share",
  "hours",
  "sailors_per_coach",
  "cogs_rate",
  "ga_share",
  "bonus_rate",
  "footprint_sq_ft",
]);

// Directus refuses an empty `_in`, so an empty list matches no row instead.
const anyOf = (ids: string[]) => ({ _in: ids.length > 0 ? ids : [randomUUID()] });

function numbers<T extends Row>(rows: T[]): T[] {
  return rows.map(
    (r) =>
      Object.fromEntries(
        Object.entries(r).map(([field, value]) => [
          field,
          DECIMALS.has(field) && typeof value === "string" ? Number(value) : value,
        ]),
      ) as T,
  );
}

const PLAN_ROWS = [
  "plan_programs",
  "plan_offerings",
  "plan_trips",
  "plan_activities",
  "plan_activity_blocks",
  "plan_block_staff",
  "plan_block_boats",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_capital_items",
  "plan_rates",
  "plan_revenue_charges",
  "plan_staff_levels",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_boat_rates",
  "plan_pools",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
  "plan_closed_dates",
  "plan_terms",
] as const;

/** The revenue and expense accounts the examples book to, by what they're for. */
type AccountName =
  | "programs"
  | "merchandise"
  | "costs"
  | "storage"
  | "scholarships"
  | "cardFees"
  | "cardFeesCollected"
  | "donations"
  | "salaries"
  | "office"
  | "coachBoats"
  | "coachWages"
  | "payrollTax"
  | "bonus"
  | "ribs"
  | "boatUpkeep"
  | "boatCharters";

const ACCOUNTS: Record<AccountName, { type: string; default_function?: string }> = {
  programs: { type: "revenue" },
  merchandise: { type: "revenue" },
  costs: { type: "expense" },
  storage: { type: "expense" },
  scholarships: { type: "expense" },
  cardFees: { type: "expense" },
  cardFeesCollected: { type: "revenue" },
  donations: { type: "revenue", default_function: "fundraising" },
  salaries: { type: "expense" },
  office: { type: "expense", default_function: "management" },
  coachBoats: { type: "asset" },
  coachWages: { type: "expense" },
  payrollTax: { type: "expense" },
  bonus: { type: "expense" },
  ribs: { type: "expense" },
  boatUpkeep: { type: "expense" },
  boatCharters: { type: "expense" },
};

/** The costs the engine works out, and the account each goes to. */
const COST_ACCOUNTS: Record<string, AccountName> = {
  salaries: "salaries",
  coach_wages: "coachWages",
  payroll_tax: "payrollTax",
  ribs: "ribs",
  boat_maintenance: "boatUpkeep",
  resources: "boatCharters",
};

/**
 * One example's plans: an organization's Operations Plan, and a plan for each program area, in one
 * draft Financial Plan.
 */
export class PnlPlan {
  private organizationId: string | undefined;
  private readonly accounts = {} as Record<AccountName, string>;
  private setId: string | undefined;
  /** Whether a step has named the Financial Plan, which a scenario does once. */
  private named = false;
  private operations: string | undefined;
  private readonly areaPlans = new Map<string, string>();
  readonly areas: string[] = [];
  readonly products: string[] = [];
  /** Each program's program area. */
  private readonly programAreas = new Map<string, string>();
  readonly offerings: Item[] = [];
  readonly lines: Record<string, Item> = {};
  readonly boatClasses: string[] = [];
  /** The organization's boats and equipment this scenario added to the asset list. */
  readonly assets: string[] = [];
  private poolId: string | undefined;
  output: EngineOutput | undefined;

  async account(name: AccountName): Promise<string> {
    await this.organization();
    return this.accounts[name];
  }

  async organization(): Promise<string> {
    if (this.organizationId === undefined) {
      this.organizationId = (
        await adminCreate("organizations", {
          id: randomUUID(),
          name: `P&L ${key("organization")}`,
          kind: "own",
          fiscal_year_start_month: 1,
        })
      ).id;
      for (const [name, fields] of Object.entries(ACCOUNTS)) {
        this.accounts[name as AccountName] = (
          await adminCreate("accounts", {
            id: randomUUID(),
            number: key("account"),
            name: `${name} ${runId}`,
            retired: false,
            ...fields,
          })
        ).id;
      }
      for (const [costType, account] of Object.entries(COST_ACCOUNTS)) {
        await adminCreate("organization_cost_accounts", {
          id: randomUUID(),
          organization_id: this.organizationId,
          cost_type: costType,
          account_id: this.accounts[account],
        });
      }
    }
    return this.organizationId;
  }

  /** The draft Financial Plan that holds the example's plans. */
  async financialPlan(): Promise<string> {
    this.setId ??= (
      await adminCreate("financial_plans", {
        id: randomUUID(),
        organization_id: await this.organization(),
        fiscal_year: PLAN_YEAR,
        name: `Financial Plan ${key("set")}`,
        status: "draft",
      })
    ).id;
    return this.setId;
  }

  private async plan(kind: "operations" | "program_area", areaId: string | null): Promise<string> {
    return (
      await adminCreate("plans", {
        id: randomUUID(),
        financial_plan_id: await this.financialPlan(),
        kind,
        program_area_id: areaId,
      })
    ).id;
  }

  async operationsPlan(): Promise<string> {
    this.operations ??= await this.plan("operations", null);
    return this.operations;
  }

  /** A new program area, with a plan for this year. Returns the area. */
  async area(): Promise<string> {
    await this.operationsPlan();
    const area = await adminCreate("program_areas", {
      id: randomUUID(),
      name: `Program area ${key("area")}`,
      revenue_account_id: await this.account("programs"),
    });
    this.areas.push(area.id);
    this.areaPlans.set(area.id, await this.plan("program_area", area.id));
    return area.id;
  }

  /** A program area's plan. */
  areaPlan(area: string): string {
    const plan = this.areaPlans.get(area);
    if (plan === undefined) throw new Error(`No plan for program area ${area}.`);
    return plan;
  }

  async product(kind: string, area: string | null): Promise<string> {
    const product = await adminCreate("products", {
      id: randomUUID(),
      name: `Product ${key("product")}`,
      kind,
      program_area_id: area,
      revenue_account_id:
        area === null ? await this.account(kind === "merchandise" ? "merchandise" : "programs") : null,
    });
    if (kind === "program") {
      await adminCreate("programs", { id: randomUUID(), name: `Program ${runId}`, product_id: product.id });
      if (area !== null) this.programAreas.set(product.id, area);
    }
    this.products.push(product.id);
    return product.id;
  }

  /** An offering of `product` in `plan`, with `costs` cents of its own direct costs. */
  async offering(
    plan: string,
    product: string,
    price: number,
    sailors: number,
    costs = 0,
    extra: Row = {},
  ): Promise<Item> {
    const offering = await adminCreate("plan_offerings", {
      id: randomUUID(),
      plan_id: plan,
      key: randomUUID(),
      product_id: product,
      name: `Offering ${key("offering")}`,
      starts_on: `${PLAN_YEAR}-06-01`,
      ends_on: `${PLAN_YEAR}-06-30`,
      target_enrollment: sailors,
      price_cents: price,
      ...extra,
    });
    this.offerings.push(offering);
    if (costs > 0) {
      await this.line(plan, "costs", { cost_center_type: "offering", cost_center_key: offering["key"] }, costs);
    }
    return offering;
  }

  /** A budget line. Directus refuses an empty `function`, so it's left out unless given. */
  async line(plan: string, account: AccountName, center: Row, amount: number, extra: Row = {}): Promise<Item> {
    const line = await adminCreate("plan_budget_lines", {
      id: randomUUID(),
      plan_id: plan,
      key: randomUUID(),
      name: `${account} ${key("line")}`,
      account_id: await this.account(account),
      amount_cents: amount,
      fiscal_year: PLAN_YEAR,
      in_mtdc: true,
      ...center,
      ...extra,
    });
    this.lines[account] = line;
    return line;
  }

  async pool(): Promise<string> {
    this.poolId ??= (
      await adminCreate("plan_pools", {
        id: randomUUID(),
        plan_id: await this.operationsPlan(),
        key: randomUUID(),
        name: "Office",
      })
    )["key"] as string;
    return this.poolId;
  }

  async charge(name: string, rate: number, account: AccountName, kinds: string[], excluded: boolean): Promise<void> {
    await adminCreate("plan_revenue_charges", {
      id: randomUUID(),
      plan_id: await this.operationsPlan(),
      key: randomUUID(),
      name,
      rate,
      product_kinds: kinds,
      account_id: await this.account(account),
      in_mtdc: !excluded,
    });
  }

  /** A row in the Operations Plan, such as a salaried position. Returns its key. */
  async operationsRow(collection: string, fields: Row): Promise<string> {
    const row = await adminCreate(collection, {
      id: randomUUID(),
      plan_id: await this.operationsPlan(),
      key: randomUUID(),
      ...fields,
    });
    return row["key"] as string;
  }

  /** A bonus owner in `plan` with `rate` of its products' net, owning `products`. Returns its id. */
  async bonus(plan: string, rate: number, products: string[], extra: Row = {}): Promise<string> {
    const owner = await adminCreate("plan_bonus_owners", {
      id: randomUUID(),
      plan_id: plan,
      key: randomUUID(),
      role_name: "Director",
      bonus_rate: rate,
      account_id: await this.account("bonus"),
      ...extra,
    });
    for (const product of products) await this.owns(owner.id, plan, product);
    return owner.id;
  }

  async owns(owner: string, plan: string, product: string): Promise<void> {
    await adminCreate("plan_bonus_owner_products", {
      id: randomUUID(),
      plan_id: plan,
      key: randomUUID(),
      bonus_owner_id: owner,
      product_id: product,
    });
  }

  /** Activities of `offering` on `dates`, from `start` to `end` (`HH:MM`), with `extra`'s fields. */
  async activities(offering: Item, dates: string[], start: string, end: string, extra: Row = {}): Promise<Item[]> {
    const made: Item[] = [];
    for (const date of dates) {
      made.push(
        await adminCreate("plan_activities", {
          id: randomUUID(),
          plan_id: offering["plan_id"],
          key: randomUUID(),
          offering_id: offering.id,
          date,
          start_time: start,
          end_time: end,
          kind: "practice",
          uses_boats: false,
          ...extra,
        }),
      );
    }
    return made;
  }

  /** A program's settings in its area's Program Plan. Returns their id. */
  async programSettings(area: string, product: string, fields: Row): Promise<string> {
    const settings = await adminCreate("plan_programs", {
      id: randomUUID(),
      plan_id: this.areaPlan(area),
      key: randomUUID(),
      product_id: product,
      ...fields,
    });
    return settings.id;
  }

  /** Gives every program so far `rate` as its indirect cost rate, in its area's Program Plan. */
  async indirectCostRate(rate: number): Promise<void> {
    for (const [product, area] of this.programAreas) {
      await this.programSettings(area, product, { indirect_cost_rate: rate });
    }
  }

  /** A block in `plan` on `date`. Returns its id. */
  async block(plan: string, date: string, name = "A block", fields: Row = {}): Promise<string> {
    return (
      await adminCreate("plan_activity_blocks", {
        id: randomUUID(),
        plan_id: plan,
        key: randomUUID(),
        date,
        name,
        ...fields,
      })
    ).id;
  }

  /** A row of what block `block` in `plan` is given: its staff, resources, or boats. */
  async given(
    collection: "plan_block_staff" | "plan_block_boats",
    plan: string,
    block: string,
    fields: Row,
  ): Promise<void> {
    await adminCreate(collection, {
      id: randomUUID(),
      plan_id: plan,
      key: randomUUID(),
      block_id: block,
      ...fields,
    });
  }

  /**
   * A boat class in the catalog, whose boats take at most `sailors` sailors, with `fields` such as
   * its upkeep account. Returns its id.
   */
  async boatClass(name: string, sailors: number | null, fields: Row = {}): Promise<string> {
    const boat = await adminCreate("boat_classes", {
      id: randomUUID(),
      name: `${name} ${key("boat")}`,
      max_capacity: sailors,
      ...fields,
    });
    this.boatClasses.push(boat.id);
    return boat.id;
  }

  /**
   * Adds `count` boats of a class to the asset list, sailboats or powerboats, with `dates` such as
   * `acquired_on`.
   */
  async boats(boatClass: string, count: number, kind: "sailboat" | "powerboat", dates: Row = {}): Promise<void> {
    for (let i = 0; i < count; i++) {
      const asset = await adminCreate("assets", { id: randomUUID(), kind, name: `Boat ${key("boat")}`, ...dates });
      this.assets.push(asset.id);
      await adminCreate("boats", { id: randomUUID(), asset_id: asset.id, boat_class_id: boatClass });
    }
  }

  /**
   * The draft Financial Plan holding every plan made so far, named `name`. `operations: false` takes
   * the Operations Plan out.
   */
  async draftSet(name?: string, { operations = true } = {}): Promise<string> {
    if (this.named) throw new Error("The scenario's plans are in one Financial Plan, which is already named.");
    this.named = true;
    const set = await this.financialPlan();
    if (name !== undefined) await (await admin()).ok("PATCH", itemPath("financial_plans", set), { name });
    if (!operations && this.operations !== undefined) {
      await (await admin()).ok("DELETE", itemPath("plans", this.operations));
      this.operations = undefined;
    }
    return set;
  }

  /** Freezes a draft Financial Plan, as `session` or the admin. */
  async freeze(set: string, session?: DirectusSession): Promise<void> {
    await (session ?? (await admin())).ok("PATCH", itemPath("financial_plans", set), {
      status: "frozen",
      note: "Frozen by a test.",
    });
  }

  /** A frozen Financial Plan holding every plan made so far, named `name`. */
  async frozenSet(name?: string): Promise<string> {
    const set = await this.draftSet(name);
    await this.freeze(set);
    return set;
  }

  /** Reads every row back as a Plan Reader, and calculates the P&L with the engine. */
  async calculate(): Promise<EngineOutput> {
    const plans = [await this.operationsPlan(), ...this.areaPlans.values()];
    const planner = (await userFor({ policies: ["Plan Reader"] })).session;
    const read = async (collection: string, filter: object): Promise<Row[]> =>
      numbers(
        await planner.ok("GET", `/items/${collection}?limit=-1&filter=${encodeURIComponent(JSON.stringify(filter))}`),
      );
    const inPlans = { plan_id: { _in: plans } };
    const rows = Object.fromEntries(
      await Promise.all(PLAN_ROWS.map(async (c) => [c, await read(c, inPlans)] as const)),
    );
    const organization = (await read("organizations", { id: { _eq: this.organizationId } }))[0];
    const data = {
      fiscal_year: PLAN_YEAR,
      organization,
      organization_cost_accounts: await read("organization_cost_accounts", {
        organization_id: { _eq: this.organizationId },
      }),
      products: await read("products", { id: anyOf(this.products) }),
      program_areas: await read("program_areas", { id: anyOf(this.areas) }),
      accounts: await read("accounts", { id: { _in: Object.values(this.accounts) } }),
      // The engine doesn't read qualifications (#208).
      qualifications: [],
      qualification_covers: [],
      boat_classes: await read("boat_classes", { id: anyOf(this.boatClasses) }),
      assets: await read("assets", { id: anyOf(this.assets) }),
      boats: await read("boats", { asset_id: anyOf(this.assets) }),
      plans: await read("plans", { id: { _in: plans } }),
      ...rows,
    } as unknown as PlanData;
    this.output = computePlan(data);
    return this.output;
  }

  get out(): EngineOutput {
    if (this.output === undefined) throw new Error("No P&L has been calculated.");
    return this.output;
  }

  /** The total of the calculated lines that match. */
  total(match: (line: EngineOutput["lines"][number]) => boolean): number {
    return this.out.lines.filter(match).reduce((t, l) => t + l.amount_cents, 0);
  }

  warned(code: string): boolean {
    return this.out.warnings.some((w) => w.code === code);
  }
}

/** Results, read as a Plan Reader. The hook writes them just after a change answers, so this waits for them. */
async function resultsWhere(
  filter: Row,
  what: string,
): Promise<{ lines: Row[]; pnl: Row[]; bonuses: Row[]; totals: Row }> {
  const planner = (await userFor({ policies: ["Plan Reader"] })).session;
  const read = (collection: string) =>
    planner.ok("GET", `/items/${collection}?limit=-1&filter=${encodeURIComponent(JSON.stringify(filter))}`) as Promise<
      Row[]
    >;
  for (let tries = 0; tries < 60; tries++) {
    const [totals] = await read("plan_results");
    if (totals !== undefined) {
      return {
        totals,
        lines: await read("plan_result_lines"),
        pnl: await read("plan_result_pnl"),
        bonuses: await read("plan_result_bonuses"),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${what} has no results after a minute.`);
}

/** A Financial Plan's results. */
export const financialPlanResults = (set: string) =>
  resultsWhere({ financial_plan_id: { _eq: set } }, `Financial Plan ${set}`);
