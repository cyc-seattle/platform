import { effectiveOn, eachMonth, fiscalYearMonths, monthOf, type Month } from "./dates.ts";
import type {
  Account,
  AccountFunction,
  CostCenterType,
  DateString,
  EngineWarning,
  Id,
  MetricName,
  PlanData,
  PlanOffering,
  Product,
} from "./types.ts";

export class EngineError extends Error {
  override name = "EngineError";
}

/** Which bases a ledger entry counts in. */
export type EntryBasis = "accrual" | "cash" | "both";

/** The stage that booked an entry. Only `direct` and `formula` entries form a base. */
export type Stage = "direct" | "formula" | "pool" | "bonus";

/** One amount, in fractional cents, before results are rounded and summed. */
export interface Entry {
  cost_center_type: CostCenterType;
  cost_center_key: Id | null;
  account_id: Id;
  function: AccountFunction | null;
  basis: EntryBasis;
  month: Month;
  amount: number;
  line_key: string;
  explanation: string;
  stage: Stage;
  /** False for participant support, capital, and anything excluded from base. */
  in_mtdc: boolean;
  /** False when the line is `excluded_from_base`. */
  in_base: boolean;
}

export type EntryInput = Omit<Entry, "stage" | "in_mtdc" | "in_base"> &
  Partial<Pick<Entry, "stage" | "in_mtdc" | "in_base">>;

/** Indexes over the input, the ledger, and the metrics, shared by every rule. */
export class Context {
  readonly fyMonths: Month[];
  readonly fyMonthSet: Set<Month>;
  readonly entries: Entry[] = [];
  readonly warnings: EngineWarning[] = [];
  /** offering key → metric → month → value. */
  readonly metrics = new Map<Id, Map<MetricName, Map<Month, number>>>();

  readonly accounts: Map<Id, Account>;
  readonly products: Map<Id, Product>;
  readonly offeringsById: Map<Id, PlanOffering>;
  readonly offeringsByKey: Map<Id, PlanOffering>;
  /** Enrollment per offering id. */
  readonly enrollment = new Map<Id, number>();

  readonly data: PlanData;

  constructor(data: PlanData) {
    this.data = data;
    this.fyMonths = fiscalYearMonths(data.fiscal_year, data.fiscal_year_start_month);
    this.fyMonthSet = new Set(this.fyMonths);
    this.accounts = new Map(data.accounts.map((a) => [a.id, a]));
    this.products = new Map(data.products.map((p) => [p.id, p]));
    this.offeringsById = new Map(data.plan_offerings.map((o) => [o.id, o]));
    this.offeringsByKey = new Map(data.plan_offerings.map((o) => [o.key, o]));
  }

  warn(code: string, message: string, key?: string): void {
    if (this.warnings.some((w) => w.code === code && w.message === message)) return;
    this.warnings.push(key === undefined ? { code, message } : { code, message, key });
  }

  book(entry: EntryInput): void {
    if (entry.amount === 0 || !Number.isFinite(entry.amount)) return;
    this.entries.push({ stage: "direct", in_mtdc: true, in_base: true, ...entry });
  }

  addMetric(offeringKey: Id, metric: MetricName, month: Month, value: number): void {
    if (value === 0) return;
    let byMetric = this.metrics.get(offeringKey);
    if (byMetric === undefined) this.metrics.set(offeringKey, (byMetric = new Map()));
    let byMonth = byMetric.get(metric);
    if (byMonth === undefined) byMetric.set(metric, (byMonth = new Map()));
    byMonth.set(month, (byMonth.get(month) ?? 0) + value);
  }

  metric(offeringKey: Id, metric: MetricName, month?: Month): number {
    const byMonth = this.metrics.get(offeringKey)?.get(metric);
    if (byMonth === undefined) return 0;
    if (month !== undefined) return byMonth.get(month) ?? 0;
    let total = 0;
    for (const [m, v] of byMonth) if (this.fyMonthSet.has(m)) total += v;
    return total;
  }

  /** An entry's function: the line's, else its account's default, else by cost center. */
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

  offeringMonths(offering: PlanOffering): Month[] {
    return eachMonth(monthOf(offering.starts_on), monthOf(offering.ends_on));
  }

  /** Offerings active in at least one month of the fiscal year. */
  fyOfferings(): PlanOffering[] {
    return this.data.plan_offerings.filter((o) => this.offeringMonths(o).some((m) => this.fyMonthSet.has(m)));
  }

  /**
   * The row in effect on `date` among those sharing `key`'s row's name. Effective-dated rows each
   * carry their own key, so a key names a series by its row's name.
   */
  effectiveByKey<T extends { key: Id; name: string; effective_from: DateString | null }>(
    rows: T[],
    key: Id,
    date: DateString,
  ): T | undefined {
    const named = rows.find((r) => r.key === key);
    if (named === undefined) return undefined;
    return effectiveOn(
      rows.filter((r) => r.name === named.name),
      date,
    );
  }

  /** Each named assumption's value in effect on `date`. */
  assumptionsOn(date: DateString): Map<string, number> {
    const byName = new Map<string, typeof this.data.plan_assumptions>();
    for (const a of this.data.plan_assumptions) {
      byName.set(a.name, [...(byName.get(a.name) ?? []), a]);
    }
    const values = new Map<string, number>();
    for (const [name, rows] of byName) {
      const row = effectiveOn(rows, date);
      if (row !== undefined) values.set(name, row.value);
    }
    return values;
  }
}
