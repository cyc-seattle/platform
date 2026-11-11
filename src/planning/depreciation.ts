import type { Context } from "./context.ts";
import { addDays } from "./dates.ts";
import type { BoatHours } from "./staffing.ts";
import type { DateString, Id, ReserveLine } from "./types.ts";

const DAY_MS = 86_400_000;

/** Days from `from` to `to`, both counted. Zero when `to` is before `from`. */
function daysBetween(from: DateString, to: DateString): number {
  return Math.max(0, (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1);
}

function addYears(date: DateString, years: number): DateString {
  const [y, rest] = [Number(date.slice(0, 4)), date.slice(4)];
  const whole = Math.trunc(years);
  const shifted = `${String(y + whole).padStart(4, "0")}${rest === "-02-29" ? "-02-28" : rest}`;
  return addDays(shifted, Math.round((years - whole) * 365));
}

/**
 * Each boat class's straight-line depreciation for the plan year, split among the offerings that
 * sail CSC's boats of that class by their boat-hours on the water. A boat depreciates from the day it
 * went into service until it retires or is worth nothing, used or not.
 */
export function boatReserve(ctx: Context, boatHours: BoatHours): ReserveLine[] {
  const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
  const retiredOn = retirements(ctx);
  const byClass = new Map<Id, number>();
  const fyDays = daysBetween(ctx.fy.from, ctx.fy.to);

  const warned = new Set<Id>();
  for (const boat of ctx.data.boats ?? []) {
    const boatClass = classes.get(boat.boat_class_id);
    if (boatClass === undefined) continue;
    const years = boatClass.depreciation_years;
    if (years == null || years <= 0) {
      if (!warned.has(boatClass.id)) {
        warned.add(boatClass.id);
        ctx.warn(
          "no_depreciation_years",
          `${boatClass.name} has no years to depreciate over, so its boats have no boat replacement reserve`,
          boatClass.id,
        );
      }
      continue;
    }
    const start = boat.in_service_on ?? boat.acquired_on;
    if (start == null) {
      ctx.warn(
        "boat_without_date",
        `A ${boatClass.name} has no in-service or acquired date, so it has no boat replacement reserve`,
        boat.id,
      );
      continue;
    }
    const days = daysInService(start, years, retiredOn.get(boat.id), ctx.fy);
    const amount = ((boat.value_cents / years) * days) / fyDays;
    if (amount > 0) byClass.set(boatClass.id, (byClass.get(boatClass.id) ?? 0) + amount);
  }

  const lines: ReserveLine[] = [];
  for (const [classId, amount] of [...byClass].sort(([a], [b]) => a.localeCompare(b))) {
    const name = classes.get(classId)!.name;
    const line_name = `Boat replacement reserve: ${name}`;
    const hours = [...(boatHours.get(classId) ?? [])].filter(([, h]) => h > 0).sort(([a], [b]) => a.localeCompare(b));
    const total = hours.reduce((t, [, h]) => t + h, 0);
    if (total <= 0) {
      ctx.warn(
        "boats_not_sailed",
        `No offering sails CSC's ${name} boats this year, so their boat replacement reserve stays with the organization`,
        classId,
      );
      lines.push({
        cost_center_type: "org",
        cost_center_key: null,
        boat_class_id: classId,
        amount_cents: Math.round(amount),
        line_name,
        explanation: "CSC's boats of the class, each its value ÷ its class's years, for its days in service",
      });
      continue;
    }
    // Rounding the running total keeps the class's total to the cent.
    let before = 0;
    for (const [offeringKey, h] of hours) {
      const after = before + (amount * h) / total;
      const cents = Math.round(after) - Math.round(before);
      before = after;
      if (cents === 0) continue;
      lines.push({
        cost_center_type: "offering",
        cost_center_key: offeringKey,
        boat_class_id: classId,
        amount_cents: cents,
        line_name,
        explanation: "The class's depreciation for the year, split by the offerings' boat-hours on the water",
      });
    }
  }
  return lines;
}

/** The days of the plan year a boat is in service and not yet fully depreciated. */
function daysInService(
  start: DateString,
  years: number,
  retired: DateString | undefined,
  fy: { from: DateString; to: DateString },
): number {
  const ends = [addDays(addYears(start, years), -1), fy.to];
  if (retired !== undefined) ends.push(addDays(retired, -1));
  const end = ends.sort()[0]!;
  const from = start > fy.from ? start : fy.from;
  return daysBetween(from, end);
}

/** The day each boat retired: its latest stage change, when that's to Retired. */
function retirements(ctx: Context): Map<Id, DateString> {
  const latest = new Map<Id, { stage: string; changed_on: DateString }>();
  for (const change of ctx.data.boat_stage_changes ?? []) {
    const seen = latest.get(change.boat_id);
    if (seen === undefined || change.changed_on >= seen.changed_on) latest.set(change.boat_id, change);
  }
  return new Map([...latest].filter(([, c]) => c.stage === "retired").map(([id, c]) => [id, c.changed_on]));
}
