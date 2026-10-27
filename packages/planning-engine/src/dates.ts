import type { DateString, TimeString } from "./types.ts";

/** A month as `YYYY-MM`. */
export type Month = string;

export function monthOf(date: DateString): Month {
  return date.slice(0, 7);
}

/** The month's first day, as `plan_results.month` stores it. */
export function monthStart(month: Month): DateString {
  return `${month}-01`;
}

function toUtc(date: DateString): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): DateString {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: DateString, days: number): DateString {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** ISO weekday, 1 = Monday. */
export function isoWeekday(date: DateString): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from: DateString, to: DateString): DateString[] {
  const dates: DateString[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to`, inclusive. */
export function eachMonth(from: Month, to: Month): Month[] {
  const months: Month[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

/** Fiscal year N ends in calendar year N, so a July start makes FY2027 July 2026 to June 2027. */
export function fiscalYearMonths(fiscalYear: number, startMonth: number): Month[] {
  const first = startMonth === 1 ? `${fiscalYear}-01` : `${fiscalYear - 1}-${String(startMonth).padStart(2, "0")}`;
  return eachMonth(first, addMonths(first, 11));
}

export function minutesOf(time: TimeString): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Whether `date` falls in a window whose open ends are unbounded. */
export function within(
  date: DateString,
  from: DateString | null | undefined,
  to: DateString | null | undefined,
): boolean {
  return (from == null || date >= from) && (to == null || date <= to);
}

/** Whether any day of `month` falls in the window. */
export function monthOverlaps(
  month: Month,
  from: DateString | null | undefined,
  to: DateString | null | undefined,
): boolean {
  return (from == null || monthOf(from) <= month) && (to == null || monthOf(to) >= month);
}

/** The row in effect on `date`: the latest `effective_from` on or before it. A null one is always in effect. */
export function effectiveOn<T extends { effective_from: DateString | null }>(
  rows: T[],
  date: DateString,
): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (row.effective_from != null && row.effective_from > date) continue;
    if (best === undefined || (best.effective_from ?? "") <= (row.effective_from ?? "")) best = row;
  }
  return best;
}
