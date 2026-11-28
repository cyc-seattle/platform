// The plan-to-catalog sync's difference (cyc-seattle/platform#395): what the frozen Financial Plan in force for
// a year plans that its catalog offerings don't have yet. A person reviews it and applies what they choose, so it
// shows every difference every time, with no stored base.
import type { DateString, Id, PlanActivity, PlanOffering, TimeString } from "./types.ts";

/** A catalog offering, as the sync reads it. */
export interface SyncOffering {
  id: Id;
  product_id: Id;
  name: string | null;
  registration_form_id: Id | null;
  starts_on: DateString | null;
  ends_on: DateString | null;
  capacity: number | null;
  price_cents: number | null;
  archived_at: string | null;
  confirmed_count: number;
}

/** One day of the week a catalog offering meets: 1 is Monday, 7 Sunday. */
export interface ScheduleDay {
  weekday: number;
  start_time: TimeString;
  end_time: TimeString;
}

/** A catalog offering's row in its schedule. */
export interface SyncScheduleRow extends ScheduleDay {
  id: Id;
  offering_id: Id;
}

/** A catalog activity: one day an offering meets, with its times. */
export interface SyncActivity {
  id: Id;
  offering_id: Id;
  date: DateString;
  start_time: TimeString;
  end_time: TimeString;
  archived_at: string | null;
}

export interface SyncInput {
  /** The Financial Plan in force for the year, whose plans hold `planOfferings` and `planActivities`. */
  financialPlan: { id: Id; status: "draft" | "frozen" };
  planOfferings: Pick<PlanOffering, "id" | "offering_id" | "starts_on" | "ends_on" | "capacity" | "price_cents">[];
  planActivities: Pick<PlanActivity, "id" | "offering_id" | "date" | "start_time" | "end_time" | "kind">[];
  /** Every catalog offering any of the year's Financial Plans plans, archived ones' included. */
  offerings: SyncOffering[];
  /** Those offerings' schedules. */
  schedule: SyncScheduleRow[];
  /** Those offerings' activities. */
  activities: SyncActivity[];
}

/** A catalog offering's field the plan gives another value. */
export interface FieldChange {
  field: "starts_on" | "ends_on" | "capacity" | "price_cents";
  plan: string | number | null;
  catalog: string | number | null;
}

export interface ActivityAdd {
  plan_activity_id: Id;
  date: DateString;
  start_time: TimeString;
  end_time: TimeString;
}

export interface ActivityChange {
  activity_id: Id;
  date: DateString;
  start_time: TimeString;
  /** Its end time in the catalog, and in the plan. */
  end_time: { catalog: TimeString; plan: TimeString };
  /** Whether it's archived in the catalog, so applying it brings it back. */
  restore: boolean;
}

export interface ActivityArchive {
  activity_id: Id;
  date: DateString;
  start_time: TimeString;
}

/** What one catalog offering lacks of the plan, and the plan's activities the sync leaves out. */
export interface OfferingDifference {
  offering: SyncOffering;
  plan_offering_id: Id;
  fields: FieldChange[];
  /** The plan's schedule, and the catalog's, when they differ; otherwise null. */
  schedule: { plan: ScheduleDay[]; catalog: ScheduleDay[] } | null;
  adds: ActivityAdd[];
  changes: ActivityChange[];
  archives: ActivityArchive[];
  /** Plan activities with no start or end time, which a catalog activity can't be made from. */
  skipped: { plan_activity_id: Id; date: DateString }[];
}

export type CatalogDifference =
  | { refused: "draft" }
  | {
      refused?: undefined;
      /** Each planned catalog offering with a difference, or a plan activity skipped. */
      offerings: OfferingDifference[];
      /** Catalog offerings a Financial Plan for the year plans, but the plan in force doesn't. */
      archives: SyncOffering[];
    };

const time = (t: TimeString): TimeString => (t.length === 5 ? `${t}:00` : t);
const sameTime = (a: TimeString | null, b: TimeString | null) =>
  a === null ? b === null : b !== null && time(a) === time(b);

/** ISO weekday, 1 for Monday to 7 for Sunday, of a `YYYY-MM-DD`. */
function weekdayOf(date: DateString): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of a date's week, which names the week. */
function weekOf(date: DateString): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (weekdayOf(date) - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * An offering's schedule from its plan activities with both times, but travel days: each weekday with an activity
 * in at least half the weeks that have any, at the start and end most of them share there, the earlier on a tie.
 */
export function scheduleOf(activities: SyncInput["planActivities"]): ScheduleDay[] {
  const timed = activities.filter((a) => a.kind !== "travel" && a.start_time !== null && a.end_time !== null);
  const weeks = new Set(timed.map((a) => weekOf(a.date))).size;
  const days: ScheduleDay[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const on = timed.filter((a) => weekdayOf(a.date) === weekday);
    if (new Set(on.map((a) => weekOf(a.date))).size * 2 < weeks || on.length === 0) continue;
    const counts = new Map<string, number>();
    for (const a of on) {
      const pair = `${time(a.start_time!)}|${time(a.end_time!)}`;
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    const [best] = [...counts].sort(([a, m], [b, n]) => n - m || a.localeCompare(b));
    const [start_time, end_time] = best![0].split("|") as [TimeString, TimeString];
    days.push({ weekday, start_time, end_time });
  }
  return days;
}

const scheduleKey = (days: ScheduleDay[]) =>
  days
    .map((d) => `${d.weekday}|${time(d.start_time)}|${time(d.end_time)}`)
    .sort()
    .join(",");

const FIELDS = ["starts_on", "ends_on", "capacity", "price_cents"] as const;

/**
 * What the frozen Financial Plan in force lacks in the catalog: each linked catalog offering's dates, capacity and
 * price, its schedule, and its activities, and the catalog offerings the year's other Financial Plans plan but this
 * one doesn't. A draft is refused, so the catalog never takes numbers the board didn't approve.
 */
export function catalogDifference(input: SyncInput): CatalogDifference {
  if (input.financialPlan.status !== "frozen") return { refused: "draft" };
  const offerings = new Map(input.offerings.map((o) => [o.id, o]));
  const planned = new Set(input.planOfferings.map((o) => o.offering_id));
  const result: OfferingDifference[] = [];
  for (const po of input.planOfferings) {
    const offering = offerings.get(po.offering_id);
    if (offering === undefined) continue;
    const fields = FIELDS.filter((f) => (po[f] ?? null) !== (offering[f] ?? null)).map((field) => ({
      field,
      plan: po[field] ?? null,
      catalog: offering[field] ?? null,
    }));
    const own = input.planActivities.filter((a) => a.offering_id === po.id);
    const plan = scheduleOf(own);
    const catalog = input.schedule
      .filter((s) => s.offering_id === offering.id)
      .map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time }))
      .sort((a, b) => a.weekday - b.weekday);
    const schedule = scheduleKey(plan) === scheduleKey(catalog) ? null : { plan, catalog };

    const theirs = input.activities.filter((a) => a.offering_id === offering.id);
    const matched = new Set<Id>();
    const adds: ActivityAdd[] = [];
    const changes: ActivityChange[] = [];
    const skipped: OfferingDifference["skipped"] = [];
    for (const a of own) {
      if (a.start_time === null || a.end_time === null) {
        skipped.push({ plan_activity_id: a.id, date: a.date });
        continue;
      }
      const match = theirs.find((c) => !matched.has(c.id) && c.date === a.date && sameTime(c.start_time, a.start_time));
      if (match === undefined) {
        adds.push({ plan_activity_id: a.id, date: a.date, start_time: time(a.start_time), end_time: time(a.end_time) });
        continue;
      }
      matched.add(match.id);
      const restore = match.archived_at !== null;
      if (restore || !sameTime(match.end_time, a.end_time)) {
        changes.push({
          activity_id: match.id,
          date: a.date,
          start_time: time(a.start_time),
          end_time: { catalog: time(match.end_time), plan: time(a.end_time) },
          restore,
        });
      }
    }
    const archives = theirs
      .filter((c) => !matched.has(c.id) && c.archived_at === null)
      .map((c) => ({ activity_id: c.id, date: c.date, start_time: time(c.start_time) }));
    const sortByDay = <T extends { date: DateString; start_time: TimeString }>(rows: T[]) =>
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
    if (fields.length + adds.length + changes.length + archives.length + skipped.length > 0 || schedule !== null) {
      result.push({
        offering,
        plan_offering_id: po.id,
        fields,
        schedule,
        adds: sortByDay(adds),
        changes: sortByDay(changes),
        archives: sortByDay(archives),
        skipped: skipped.sort((a, b) => a.date.localeCompare(b.date)),
      });
    }
  }
  const archives = input.offerings.filter((o) => !planned.has(o.id) && o.archived_at === null);
  return { offerings: result, archives };
}
