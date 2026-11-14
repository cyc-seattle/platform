import type { DateString, TimeString } from "./types.ts";

function toUtc(date: DateString): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** ISO weekday, 1 = Monday. */
export function isoWeekday(date: DateString): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function minutesOf(time: TimeString): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}
