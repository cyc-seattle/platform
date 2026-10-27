import type { DateString, TimeString } from "./types.ts";

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

/** Fiscal year N ends in calendar year N, so a July start makes FY2027 2026-07-01 to 2027-06-30. */
export function fiscalYearDates(fiscalYear: number, startMonth: number): { from: DateString; to: DateString } {
  const startYear = startMonth === 1 ? fiscalYear : fiscalYear - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const nextYear = `${startYear + 1}-${String(startMonth).padStart(2, "0")}-01`;
  return { from, to: addDays(nextYear, -1) };
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
