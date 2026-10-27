import { fiscalYearDates, within } from "./dates.ts";
import type {
  Account,
  AccountFunction,
  CostCenterType,
  CostType,
  DateString,
  EngineWarning,
  Id,
  PlanData,
  PlanOffering,
  PlanRates,
  Product,
} from "./types.ts";

/** The step that recorded an entry. Only `direct` entries count toward MTDC. */
export type Stage = "direct" | "pool" | "bonus";

/** One amount, in fractional cents, before lines are rounded and summed. */
export interface Entry {
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  account_id: Id;
  function: AccountFunction | null;
  amount: number;
  line_key: string;
  explanation: string;
  stage: Stage;
  /** How much of the amount MTDC counts: 0 when excluded, a fraction for a mix of rented and owned RIBs. */
  mtdc_share: number;
  /** Whether it's wages, which payroll tax is charged on. */
  wages: boolean;
}

export type EntryInput = Omit<Entry, "stage" | "mtdc_share" | "wages"> &
  Partial<Pick<Entry, "stage" | "mtdc_share" | "wages">>;

/** Lookups over the input, and the entries recorded so far, shared by every step. */
export class Context {
  /** The plan year's first and last days. */
  readonly fy: { from: DateString; to: DateString };
  readonly entries: Entry[] = [];
  readonly warnings: EngineWarning[] = [];

  readonly accounts: Map<Id, Account>;
  readonly products: Map<Id, Product>;
  readonly offeringsById: Map<Id, PlanOffering>;
  readonly offeringsByKey: Map<Id, PlanOffering>;
  /** Enrollment per offering id. */
  readonly enrollment = new Map<Id, number>();
  /** Days per offering key: the dates it has an activity other than travel. */
  readonly days = new Map<Id, number>();
  readonly rates: PlanRates | undefined;
  private readonly costAccounts: Map<CostType, Id>;

  readonly data: PlanData;

  constructor(data: PlanData) {
    this.data = data;
    this.fy = fiscalYearDates(data.fiscal_year, data.organization.fiscal_year_start_month);
    this.accounts = new Map(data.accounts.map((a) => [a.id, a]));
    this.products = new Map(data.products.map((p) => [p.id, p]));
    this.offeringsById = new Map(data.plan_offerings.map((o) => [o.id, o]));
    this.offeringsByKey = new Map(data.plan_offerings.map((o) => [o.key, o]));
    this.rates = data.plan_rates[0];
    if (data.plan_rates.length > 1) this.warn("many_rates", "More than one plan_rates row, so the first is used");
    this.costAccounts = new Map(
      data.organization_cost_accounts
        .filter((c) => c.organization_id === data.organization.id)
        .map((c) => [c.cost_type, c.account_id]),
    );
  }

  /** The account the organization records a calculated cost type in. */
  costAccount(type: CostType): Id | undefined {
    const account = this.costAccounts.get(type);
    if (account === undefined) {
      this.warn("no_cost_account", `The organization has no account set for ${type}, so that cost is left out`, type);
    }
    return account;
  }

  warn(code: string, message: string, key?: string): void {
    if (this.warnings.some((w) => w.code === code && w.message === message)) return;
    this.warnings.push(key === undefined ? { code, message } : { code, message, key });
  }

  book(entry: EntryInput): void {
    if (entry.amount === 0 || !Number.isFinite(entry.amount)) return;
    this.entries.push({ stage: "direct", mtdc_share: 1, wages: false, ...entry });
  }

  /** An entry's function: the line's if set, otherwise its account's default, otherwise by cost center. */
  functionFor(
    accountId: Id,
    explicit: AccountFunction | null | undefined,
    costCenter: CostCenterType,
  ): AccountFunction | null {
    if (explicit != null) return explicit;
    const account = this.accounts.get(accountId);
    if (account?.default_function != null) return account.default_function;
    if (account?.type === "revenue") return null;
    return costCenter === "offering" || costCenter === "product" ? "program" : "management";
  }

  accountType(accountId: Id): Account["type"] | undefined {
    return this.accounts.get(accountId)?.type;
  }

  /** Whether `accountId` is `ancestorId` or under it. */
  accountUnder(accountId: Id, ancestorId: Id): boolean {
    const seen = new Set<Id>();
    for (let a = this.accounts.get(accountId); a !== undefined && !seen.has(a.id);) {
      if (a.id === ancestorId) return true;
      seen.add(a.id);
      a = a.parent_id == null ? undefined : this.accounts.get(a.parent_id);
    }
    return false;
  }

  /** Whether the offering counts in the plan year: it does, whole, in the year it starts. */
  inYear(offering: PlanOffering): boolean {
    return within(offering.starts_on, this.fy.from, this.fy.to);
  }

  /** The plan year's offerings. */
  fyOfferings(): PlanOffering[] {
    return this.data.plan_offerings.filter((o) => this.inYear(o));
  }
}
