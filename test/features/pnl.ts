import { randomUUID } from "node:crypto";
import { computePlan, type EngineOutput, type PlanData } from "../../src/planning/index.ts";
import { userFor } from "./steps/logins.ts";
import { adminCreate, key, PLAN_YEAR, runId, type Item, type Row } from "./steps/rows.ts";

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
  "quantity",
  "fill_rate",
  "sailors_per_coach",
  "ribs_per_coach",
  "byob_share",
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

const VERSION_ROWS = [
  "plan_offerings",
  "plan_offering_boat_classes",
  "plan_trips",
  "plan_activities",
  "plan_activity_resources",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_rates",
  "plan_revenue_charges",
  "plan_staff_levels",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_resources",
  "plan_boat_rates",
  "plan_activity_block_rules",
  "plan_pools",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
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
  | "coachBoats";

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
};

/** One example's plans: an organization's Operations Plan, and a plan for each program area. */
export class PnlPlan {
  private organizationId: string | undefined;
  private readonly accounts = {} as Record<AccountName, string>;
  private operations: { plan: string; version: string } | undefined;
  private readonly areaPlans = new Map<string, { plan: string; version: string }>();
  readonly areas: string[] = [];
  readonly products: string[] = [];
  readonly offerings: Item[] = [];
  readonly lines: Record<string, Item> = {};
  private poolId: string | undefined;
  output: EngineOutput | undefined;

  async account(name: AccountName): Promise<string> {
    await this.organization();
    return this.accounts[name];
  }

  private async organization(): Promise<string> {
    if (this.organizationId === undefined) {
      this.organizationId = (
        await adminCreate("organizations", {
          id: randomUUID(),
          name: `P&L ${key("organization")}`,
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
      await adminCreate("organization_cost_accounts", {
        id: randomUUID(),
        organization_id: this.organizationId,
        cost_type: "salaries",
        account_id: this.accounts.salaries,
      });
    }
    return this.organizationId;
  }

  private async plan(kind: "operations" | "program_area", areaId: string | null) {
    const plan = await adminCreate("plans", {
      id: randomUUID(),
      kind,
      program_area_id: areaId,
      organization_id: await this.organization(),
      fiscal_year: PLAN_YEAR,
      name: `Plan ${key("plan")}`,
    });
    const version = await adminCreate("plan_versions", { id: randomUUID(), plan_id: plan.id, status: "draft" });
    return { plan: plan.id, version: version.id };
  }

  async operationsVersion(): Promise<string> {
    this.operations ??= await this.plan("operations", null);
    return this.operations.version;
  }

  /** A new program area, with a plan for this year. Returns the area. */
  async area(): Promise<string> {
    const area = await adminCreate("program_areas", {
      id: randomUUID(),
      name: `Program area ${key("area")}`,
      revenue_account_id: await this.account("programs"),
    });
    this.areas.push(area.id);
    this.areaPlans.set(area.id, await this.plan("program_area", area.id));
    return area.id;
  }

  areaVersion(area: string): string {
    const plan = this.areaPlans.get(area);
    if (plan === undefined) throw new Error(`No plan for program area ${area}.`);
    return plan.version;
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
    }
    this.products.push(product.id);
    return product.id;
  }

  /** An offering of `product` in `version`, with `costs` cents of its own direct costs. */
  async offering(version: string, product: string, price: number, sailors: number, costs = 0): Promise<Item> {
    const offering = await adminCreate("plan_offerings", {
      id: randomUUID(),
      version_id: version,
      key: randomUUID(),
      product_id: product,
      name: `Offering ${key("offering")}`,
      starts_on: `${PLAN_YEAR}-06-01`,
      ends_on: `${PLAN_YEAR}-06-30`,
      target_enrollment: sailors,
      price_cents: price,
    });
    this.offerings.push(offering);
    if (costs > 0) {
      await this.line(version, "costs", { cost_center_type: "offering", cost_center_key: offering["key"] }, costs);
    }
    return offering;
  }

  /** A budget line. Directus refuses an empty `function`, so it's left out unless given. */
  async line(version: string, account: AccountName, center: Row, amount: number, extra: Row = {}): Promise<Item> {
    const line = await adminCreate("plan_budget_lines", {
      id: randomUUID(),
      version_id: version,
      key: randomUUID(),
      name: `${account} ${key("line")}`,
      account_id: await this.account(account),
      amount_cents: amount,
      fiscal_year: PLAN_YEAR,
      excluded_from_mtdc: false,
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
        version_id: await this.operationsVersion(),
        key: randomUUID(),
        name: "Office",
      })
    )["key"] as string;
    return this.poolId;
  }

  async charge(name: string, rate: number, account: AccountName, kinds: string[], excluded: boolean): Promise<void> {
    await adminCreate("plan_revenue_charges", {
      id: randomUUID(),
      version_id: await this.operationsVersion(),
      key: randomUUID(),
      name,
      rate,
      product_kinds: kinds,
      account_id: await this.account(account),
      excluded_from_mtdc: excluded,
    });
  }

  /** Reads every row back as a Plan Reader, and calculates the P&L with the engine. */
  async calculate(): Promise<EngineOutput> {
    const versions = [await this.operationsVersion(), ...[...this.areaPlans.values()].map((p) => p.version)];
    const plans = [this.operations!.plan, ...[...this.areaPlans.values()].map((p) => p.plan)];
    const planner = (await userFor({ policies: ["Plan Reader"] })).session;
    const read = async (collection: string, filter: object): Promise<Row[]> =>
      numbers(
        await planner.ok("GET", `/items/${collection}?limit=-1&filter=${encodeURIComponent(JSON.stringify(filter))}`),
      );
    const inVersions = { version_id: { _in: versions } };
    const rows = Object.fromEntries(
      await Promise.all(VERSION_ROWS.map(async (c) => [c, await read(c, inVersions)] as const)),
    );
    const organization = (await read("organizations", { id: { _eq: this.organizationId } }))[0];
    const data = {
      fiscal_year: PLAN_YEAR,
      organization,
      organization_cost_accounts: await read("organization_cost_accounts", {
        organization_id: { _eq: this.organizationId },
      }),
      rib_resource_kind_id: null,
      products: await read("products", { id: anyOf(this.products) }),
      program_areas: await read("program_areas", { id: anyOf(this.areas) }),
      accounts: await read("accounts", { id: { _in: Object.values(this.accounts) } }),
      qualifications: [],
      qualification_covers: [],
      boat_classes: [],
      resource_kinds: [],
      plans: await read("plans", { id: { _in: plans } }),
      plan_versions: await read("plan_versions", { id: { _in: versions } }),
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
