import { addDays, eachDate, isoWeekday, minutesOf } from "./dates.ts";
import type { Context } from "./context.ts";
import type { ActivityKind, Id, PlanActivity, PlanOffering, PlanScheduleRule, PlanTrip } from "./types.ts";

/** An activity before staffing: generated from a rule or trip, or stored. */
export interface ScheduledActivity {
  offering: PlanOffering;
  rule: PlanScheduleRule | null;
  trip: PlanTrip | null;
  stored: PlanActivity | null;
  date: string;
  kind: ActivityKind;
  paid_minutes: number;
  on_water_minutes: number;
  uses_boats: boolean;
}

function fromRule(rule: PlanScheduleRule, offering: PlanOffering): ScheduledActivity[] {
  const from = rule.starts_on ?? offering.starts_on;
  const to = rule.ends_on ?? offering.ends_on;
  const skip = new Set(rule.skip_dates ?? []);
  const weekdays = new Set(rule.weekdays);
  const span = minutesOf(rule.end_time) - minutesOf(rule.start_time);
  const paid = span + (rule.setup_minutes ?? 0) + (rule.putaway_minutes ?? 0);
  const onWater = Math.round(span * (rule.on_water_fraction ?? 1));
  return eachDate(from, to)
    .filter((d) => weekdays.has(isoWeekday(d)) && !skip.has(d))
    .map((date) => ({
      offering,
      rule,
      trip: null,
      stored: null,
      date,
      kind: rule.kind,
      paid_minutes: paid,
      on_water_minutes: rule.uses_boats ? onWater : 0,
      uses_boats: rule.uses_boats,
    }));
}

/**
 * A trip generates only its travel days; the event days come from a regatta rule. Loading falls
 * on the first travel day out and unloading on the last day back, or on the event's own first or
 * last day when there's no travel day.
 */
function fromTrip(trip: PlanTrip, offering: PlanOffering): ScheduledActivity[] {
  const travelMinutes = Math.round((trip.travel_hours_per_day ?? 0) * 60);
  const out = Array.from({ length: trip.pre_travel_days ?? 0 }, (_, i) =>
    addDays(trip.starts_on, i - (trip.pre_travel_days ?? 0)),
  );
  const back = Array.from({ length: trip.post_travel_days ?? 0 }, (_, i) => addDays(trip.ends_on, i + 1));
  const minutes = new Map<string, number>();
  for (const d of [...out, ...back]) minutes.set(d, travelMinutes);
  const add = (date: string, m: number): void => {
    if (m > 0) minutes.set(date, (minutes.get(date) ?? 0) + m);
  };
  add(out[0] ?? trip.starts_on, trip.load_minutes ?? 0);
  add(back.at(-1) ?? trip.ends_on, trip.unload_minutes ?? 0);
  return [...minutes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, paid]) => ({
      offering,
      rule: null,
      trip,
      stored: null,
      date,
      kind: "travel" as const,
      paid_minutes: paid,
      on_water_minutes: 0,
      uses_boats: false,
    }));
}

function fromStored(
  activity: PlanActivity,
  offering: PlanOffering,
  rule: PlanScheduleRule | null,
  trip: PlanTrip | null,
): ScheduledActivity {
  const span =
    activity.start_time != null && activity.end_time != null
      ? minutesOf(activity.end_time) - minutesOf(activity.start_time)
      : (activity.on_water_minutes ?? 0);
  const usesBoats = activity.kind !== "travel" && (rule?.uses_boats ?? true);
  return {
    offering,
    rule,
    trip,
    stored: activity,
    date: activity.date,
    kind: activity.kind,
    paid_minutes: span + (activity.setup_minutes ?? 0) + (activity.putaway_minutes ?? 0),
    on_water_minutes: usesBoats ? (activity.on_water_minutes ?? span) : 0,
    uses_boats: usesBoats,
  };
}

/**
 * Expands schedule rules and trips into activities, then applies the stored ones. A stored row
 * marked `overridden` replaces the generated activity with the same rule or trip and date; a stored
 * row with neither is a one-off. Stored rows that aren't overridden are the last expansion's copy,
 * so they're regenerated rather than read.
 */
export function scheduleActivities(ctx: Context): ScheduledActivity[] {
  const { data } = ctx;
  const rules = new Map(data.plan_schedule_rules.map((r) => [r.id, r]));
  const trips = new Map(data.plan_trips.map((t) => [t.id, t]));
  const sourceKey = (source: Id, date: string): string => `${source}|${date}`;

  const overrides = new Map<string, ScheduledActivity>();
  const oneOffs: ScheduledActivity[] = [];
  for (const activity of data.plan_activities) {
    const offering = ctx.offeringsById.get(activity.offering_id);
    if (offering === undefined) {
      ctx.warn("unknown_offering", `Activity ${activity.key} names a missing offering`, activity.key);
      continue;
    }
    const rule = activity.schedule_rule_id == null ? null : (rules.get(activity.schedule_rule_id) ?? null);
    const trip = activity.trip_id == null ? null : (trips.get(activity.trip_id) ?? null);
    const source = activity.schedule_rule_id ?? activity.trip_id;
    if (source == null) oneOffs.push(fromStored(activity, offering, null, null));
    else if (activity.overridden) {
      overrides.set(sourceKey(source, activity.date), fromStored(activity, offering, rule, trip));
    }
  }

  const generated: ScheduledActivity[] = [];
  for (const rule of data.plan_schedule_rules) {
    const offering = ctx.offeringsById.get(rule.offering_id);
    if (offering === undefined) {
      ctx.warn("unknown_offering", `Schedule rule ${rule.key} names a missing offering`, rule.key);
      continue;
    }
    generated.push(...fromRule(rule, offering));
  }
  for (const trip of data.plan_trips) {
    const offering = ctx.offeringsById.get(trip.offering_id);
    if (offering === undefined) {
      ctx.warn("unknown_offering", `Trip ${trip.key} names a missing offering`, trip.key);
      continue;
    }
    generated.push(...fromTrip(trip, offering));
  }

  const result: ScheduledActivity[] = [];
  for (const a of generated) {
    const key = sourceKey((a.rule?.id ?? a.trip?.id) as Id, a.date);
    const override = overrides.get(key);
    if (override === undefined) result.push(a);
    else {
      result.push(override);
      overrides.delete(key);
    }
  }
  // An override whose date the rule no longer generates still stands: the planner moved it.
  result.push(...overrides.values(), ...oneOffs);
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.offering.key.localeCompare(b.offering.key));
}
