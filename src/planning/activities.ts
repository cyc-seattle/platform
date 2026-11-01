import { minutesOf } from "./dates.ts";
import type { Context } from "./context.ts";
import type { ActivityKind, PlanActivity, PlanOffering, PlanTrip } from "./types.ts";

/** A stored activity, before staffing, with its paid time and time on the water. */
export interface ScheduledActivity {
  offering: PlanOffering;
  trip: PlanTrip | null;
  stored: PlanActivity;
  date: string;
  /** Minutes after midnight, or null when the activity has no times. */
  start_minutes: number | null;
  end_minutes: number | null;
  kind: ActivityKind;
  paid_minutes: number;
  on_water_minutes: number;
  uses_boats: boolean;
}

/**
 * The plan year's activities. Paid time is start to end plus setup and put-away; on-water time is
 * `on_water_minutes` if set, otherwise the whole span, and zero when the activity uses no boats.
 */
export function scheduleActivities(ctx: Context): ScheduledActivity[] {
  const trips = new Map(ctx.data.plan_trips.map((t) => [t.id, t]));
  const closed = new Map((ctx.data.plan_closed_dates ?? []).map((c) => [c.date, c.name]));
  const result: ScheduledActivity[] = [];
  for (const activity of ctx.data.plan_activities) {
    const offering = ctx.offeringsById.get(activity.offering_id);
    if (offering === undefined) {
      ctx.warn("unknown_offering", `Activity ${activity.key} names a missing offering`, activity.key);
      continue;
    }
    if (!ctx.inYear(offering)) continue;
    const timed = activity.start_time != null && activity.end_time != null;
    const start = timed ? minutesOf(activity.start_time as string) : null;
    const end = timed ? minutesOf(activity.end_time as string) : null;
    const span = start !== null && end !== null ? end - start : 0;
    const closedFor = closed.get(activity.date);
    if (closedFor !== undefined && activity.kind !== "travel") {
      ctx.warn(
        "closed_date",
        `${offering.name} has an activity on ${activity.date}, when the club is closed for ${closedFor}`,
        activity.key,
      );
    }
    const usesBoats = activity.kind !== "travel" && activity.uses_boats;
    result.push({
      offering,
      trip: activity.trip_id == null ? null : (trips.get(activity.trip_id) ?? null),
      stored: activity,
      date: activity.date,
      start_minutes: start,
      end_minutes: end,
      kind: activity.kind,
      paid_minutes: span + (activity.setup_minutes ?? 0) + (activity.putaway_minutes ?? 0),
      on_water_minutes: usesBoats ? (activity.on_water_minutes ?? span) : 0,
      uses_boats: usesBoats,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.offering.key.localeCompare(b.offering.key));
}
