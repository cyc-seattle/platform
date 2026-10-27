import { effectiveOn, isoWeekday, monthOf, within } from "./dates.ts";
import type { Context } from "./context.ts";
import type { ScheduledActivity } from "./schedule.ts";
import type {
  ComputedActivity,
  Id,
  PlanActivityBlockRule,
  PlanOffering,
  PlanResource,
  PlanStaffLevel,
} from "./types.ts";

/** Hours a salaried position coached, by offering key and month, for the salaried rule. */
export interface SalariedCoaching {
  position_key: Id;
  offering_key: Id;
  month: string;
  hours: number;
}

/** `target_enrollment`, else `capacity × fill_rate`, unrounded. */
export function enrollmentOf(offering: PlanOffering): number {
  if (offering.target_enrollment != null) return offering.target_enrollment;
  return (offering.capacity ?? 0) * (offering.fill_rate ?? 0);
}

interface Staffed {
  a: ScheduledActivity;
  enrollment: number;
  coaches: number;
  ribs: number;
  /** Boats by boat class id; `""` when the offering names no class. */
  boats: Map<Id, number>;
  /** Sailors on club boats, by boat class id. */
  sailors: Map<Id, number>;
  fixed: { coaches: boolean; ribs: boolean; boats: boolean };
  salaried: number;
  positions: { key: Id; coaches: number }[];
  level: PlanStaffLevel | undefined;
  block: PlanActivityBlockRule | null;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Coaches for `enrollment` sailors: at least `min_coaches`, and one per `sailors_per_coach`. */
function coachesFor(offering: PlanOffering, enrollment: number): number {
  const ratio = offering.sailors_per_coach;
  const byRatio = ratio != null && ratio > 0 ? Math.ceil(enrollment / ratio) : 0;
  return Math.max(offering.min_coaches ?? 0, byRatio);
}

export class Staffing {
  private readonly ctx: Context;
  private readonly boatClasses: Map<Id, { sailors_per_boat: number | null; name: string }>;
  private readonly offeringBoatClasses = new Map<Id, { boat_class_id: Id; share: number }[]>();
  private readonly covers = new Map<Id, Set<Id>>();
  private readonly warned = new Set<string>();

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.boatClasses = new Map(ctx.data.boat_classes.map((b) => [b.id, b]));
    for (const row of ctx.data.plan_offering_boat_classes) {
      this.offeringBoatClasses.set(row.offering_id, [...(this.offeringBoatClasses.get(row.offering_id) ?? []), row]);
    }
    for (const c of ctx.data.qualification_covers) {
      this.covers.set(c.qualification_id, new Set([...(this.covers.get(c.qualification_id) ?? []), c.covers_id]));
    }
  }

  private warnOnce(code: string, message: string, key: string): void {
    if (this.warned.has(`${code}|${key}`)) return;
    this.warned.add(`${code}|${key}`);
    this.ctx.warn(code, message, key);
  }

  /** Whether holding `held` qualifies for `required`, through `qualification_covers`. */
  qualifies(held: Id[], required: Id): boolean {
    const seen = new Set<Id>();
    const stack = [...held];
    while (stack.length > 0) {
      const q = stack.pop() as Id;
      if (q === required) return true;
      if (seen.has(q)) continue;
      seen.add(q);
      stack.push(...(this.covers.get(q) ?? []));
    }
    return false;
  }

  private levelFor(offering: PlanOffering, block: PlanActivityBlockRule | null, date: string) {
    const levels = this.ctx.data.plan_staff_levels;
    if (block?.coach_level_id != null) {
      const row = levels.find((l) => l.id === block.coach_level_id);
      if (row !== undefined)
        return effectiveOn(
          levels.filter((l) => l.name === row.name),
          date,
        );
    }
    if (offering.coach_level_key == null) return undefined;
    return this.ctx.effectiveByKey(levels, offering.coach_level_key, date);
  }

  private sailorsByClass(offering: PlanOffering, enrollment: number): Map<Id, number> {
    const onClubBoats = enrollment * (1 - (offering.byob_share ?? 0));
    const classes = this.offeringBoatClasses.get(offering.id) ?? [];
    if (classes.length === 0) return new Map([["", onClubBoats]]);
    return new Map(classes.map((c) => [c.boat_class_id, onClubBoats * c.share]));
  }

  private boatsFor(sailors: Map<Id, number>, offeringKey: Id): Map<Id, number> {
    const boats = new Map<Id, number>();
    for (const [classId, n] of sailors) {
      const perBoat = this.boatClasses.get(classId)?.sailors_per_boat;
      if (perBoat == null || perBoat <= 0) {
        if (n > 0) {
          this.warnOnce(
            "no_sailors_per_boat",
            classId === ""
              ? `Offering ${offeringKey} sails boats but names no boat class`
              : `Boat class ${classId} has no sailors_per_boat, so offering ${offeringKey} counts no boats in it`,
            offeringKey,
          );
        }
        continue;
      }
      boats.set(classId, Math.ceil(n / perBoat));
    }
    return boats;
  }

  private initial(a: ScheduledActivity): Staffed {
    const { offering, rule, stored } = a;
    const enrollment = this.ctx.enrollment.get(offering.id) ?? 0;
    const fixedCoaches = stored?.fixed_coaches ?? rule?.fixed_coaches ?? offering.fixed_coaches;
    const fixedRibs = stored?.fixed_ribs ?? rule?.fixed_ribs ?? offering.fixed_ribs;
    const fixedBoats = stored?.fixed_boats ?? offering.fixed_boats;
    const coaches = fixedCoaches ?? coachesFor(offering, enrollment);
    const travel = a.kind === "travel";
    const ribs = fixedRibs ?? (travel ? 0 : Math.ceil(coaches * (offering.ribs_per_coach ?? 0)));
    const sailors = a.uses_boats ? this.sailorsByClass(offering, enrollment) : new Map<Id, number>();
    let boats: Map<Id, number>;
    if (!a.uses_boats) boats = new Map();
    else if (fixedBoats != null) {
      const total = sum(sailors.values());
      boats = new Map(
        [...sailors].map(([c, n]) => [c, total > 0 ? (fixedBoats * n) / total : fixedBoats / sailors.size]),
      );
    } else boats = this.boatsFor(sailors, offering.key);
    return {
      a,
      enrollment,
      coaches,
      ribs,
      boats,
      sailors,
      fixed: { coaches: fixedCoaches != null, ribs: fixedRibs != null, boats: fixedBoats != null },
      salaried: 0,
      positions: [],
      level: undefined,
      block: null,
    };
  }

  private blockFor(a: ScheduledActivity): PlanActivityBlockRule | null {
    if (a.kind === "travel") return null;
    return (
      this.ctx.data.plan_activity_block_rules.find(
        (b) =>
          b.offering_keys.includes(a.offering.key) &&
          within(a.date, b.starts_on, b.ends_on) &&
          (b.weekdays == null || b.weekdays.length === 0 || b.weekdays.includes(isoWeekday(a.date))),
      ) ?? null
    );
  }

  /**
   * Staffs a block's activities on one date as one group, then gives each activity its share. A
   * count an activity fixes keeps it out of that part of the group.
   */
  private staffBlock(block: PlanActivityBlockRule, group: Staffed[]): void {
    for (const s of group) s.block = block;
    const byEnrollment = (members: Staffed[], total: number, s: Staffed): number =>
      sum(members.map((m) => m.enrollment)) > 0
        ? (total * s.enrollment) / sum(members.map((m) => m.enrollment))
        : total / members.length;

    const coached = group.filter((s) => !s.fixed.coaches);
    let coachTotal = 0;
    if (coached.length > 0) {
      const load = sum(
        coached.map((s) => {
          const ratio = s.a.offering.sailors_per_coach;
          return ratio != null && ratio > 0 ? s.enrollment / ratio : 0;
        }),
      );
      coachTotal = Math.max(Math.ceil(load - 1e-9), ...coached.map((s) => s.a.offering.min_coaches ?? 0));
      for (const s of coached) s.coaches = byEnrollment(coached, coachTotal, s);
    }

    const ribbed = group.filter((s) => !s.fixed.ribs);
    if (ribbed.length > 0) {
      const coaches = sum(ribbed.map((s) => s.coaches));
      const ratio = Math.max(...ribbed.map((s) => s.a.offering.ribs_per_coach ?? 0));
      const ribTotal = Math.ceil(coaches * ratio - 1e-9);
      for (const s of ribbed) s.ribs = coaches > 0 ? (ribTotal * s.coaches) / coaches : 0;
    }

    const boated = group.filter((s) => !s.fixed.boats && s.a.uses_boats);
    const sailorsByClass = new Map<Id, number>();
    for (const s of boated) {
      for (const [c, n] of s.sailors) sailorsByClass.set(c, (sailorsByClass.get(c) ?? 0) + n);
    }
    const shared = this.boatsFor(sailorsByClass, group[0]?.a.offering.key ?? "");
    for (const s of boated) {
      s.boats = new Map(
        [...s.sailors].map(([c, n]) => {
          const totalSailors = sailorsByClass.get(c) ?? 0;
          return [c, totalSailors > 0 ? ((shared.get(c) ?? 0) * n) / totalSailors : 0];
        }),
      );
    }

    // The block's salaried positions take its first coaching slots, so fewer hourly coaches are paid.
    const positions = block.salaried_positions ?? [];
    if (positions.length > 0 && coachTotal > 0) {
      const salariedTotal = Math.min(positions.length, coachTotal);
      for (const s of coached) {
        s.salaried = (salariedTotal * s.coaches) / coachTotal;
        s.positions = positions.map((key) => ({ key, coaches: s.salaried / positions.length }));
      }
    }
  }

  private ribRate(date: string): { hourly: number; daily: number } | undefined {
    const kind = this.ctx.data.rib_resource_kind_id;
    if (kind == null) return undefined;
    const ribs = this.ctx.data.plan_resources.filter((r) => r.resource_kind_id === kind);
    const current = [...new Set(ribs.map((r) => r.name))]
      .map((name) =>
        effectiveOn(
          ribs.filter((r) => r.name === name),
          date,
        ),
      )
      .filter((r): r is PlanResource => r !== undefined);
    if (current.length === 0) return undefined;
    const weight = (r: PlanResource): number => r.quantity ?? 1;
    const totalWeight = sum(current.map(weight));
    return {
      hourly: sum(current.map((r) => weight(r) * hourlyCost(r))) / totalWeight,
      daily: sum(current.map((r) => weight(r) * (r.cost_per_day_cents ?? 0))) / totalWeight,
    };
  }

  /** Staffs every activity, books its labor and equipment, and records its metrics. */
  run(scheduled: ScheduledActivity[]): { activities: ComputedActivity[]; coaching: SalariedCoaching[] } {
    const { ctx } = this;
    const staffed = scheduled.map((a) => this.initial(a));

    const groups = new Map<string, { block: PlanActivityBlockRule; members: Staffed[] }>();
    for (const s of staffed) {
      const block = this.blockFor(s.a);
      if (block === null) continue;
      const id = `${block.id}|${s.a.date}`;
      const group = groups.get(id) ?? { block, members: [] };
      group.members.push(s);
      groups.set(id, group);
    }
    for (const { block, members } of groups.values()) this.staffBlock(block, members);

    const coaching: SalariedCoaching[] = [];
    const resourcesByActivity = new Map<Id, typeof ctx.data.plan_activity_resources>();
    for (const r of ctx.data.plan_activity_resources) {
      resourcesByActivity.set(r.activity_id, [...(resourcesByActivity.get(r.activity_id) ?? []), r]);
    }
    const posting = ctx.data.posting_accounts;

    for (const s of staffed) {
      const { a } = s;
      const offering = a.offering;
      const key = offering.key;
      const month = monthOf(a.date);
      const paidHours = a.paid_minutes / 60;
      const waterHours = a.on_water_minutes / 60;

      const book = (account: Id, amount: number, line: string, explanation: string): void =>
        ctx.book({
          cost_center_type: "offering",
          cost_center_key: key,
          account_id: account,
          function: ctx.functionFor(account, null, "offering"),
          basis: "both",
          month,
          amount,
          line_key: `${line}:${key}`,
          explanation,
        });

      s.level = this.levelFor(offering, s.block, a.date);
      const hourly = s.coaches - s.salaried;
      if (offering.required_qualification != null && s.level !== undefined) {
        if (!this.qualifies(s.level.qualifications ?? [], offering.required_qualification)) {
          this.warnOnce(
            "unqualified_level",
            `Offering ${key}'s coach level ${s.level.name} lacks its required qualification`,
            key,
          );
        }
      }
      if (hourly > 0 && s.level === undefined) {
        this.warnOnce("no_coach_level", `Offering ${key} has coaches but no coach level, so they cost nothing`, key);
      }
      const volunteer = s.level?.pay_type === "volunteer";
      const rate = volunteer ? 0 : (s.level?.hourly_rate_cents ?? 0);
      const wages = hourly * paidHours * rate;
      book(posting.coach_wages, wages, "coach_wages", "Hourly coaches × paid hours × the coach level's rate");
      ctx.addMetric(key, "coach_hours", month, s.coaches * paidHours);
      if (!volunteer && s.level !== undefined) ctx.addMetric(key, "paid_hours", month, hourly * paidHours);
      ctx.addMetric(key, "wages", month, wages);
      for (const p of s.positions) {
        coaching.push({ position_key: p.key, offering_key: key, month, hours: p.coaches * paidHours });
      }

      if (s.ribs > 0 && waterHours > 0) {
        const ribRate = this.ribRate(a.date);
        if (ribRate === undefined)
          this.warnOnce("no_rib_rate", "No RIB resource is in effect, so RIBs cost nothing", "ribs");
        else {
          book(
            posting.ribs,
            s.ribs * (waterHours * ribRate.hourly + ribRate.daily),
            "ribs",
            "RIBs × on-water hours × the RIB rate, plus a day rate",
          );
        }
        ctx.addMetric(key, "rib_hours", month, s.ribs * waterHours);
      }

      for (const [classId, boats] of s.boats) {
        if (boats <= 0 || waterHours <= 0) continue;
        ctx.addMetric(key, "boat_hours", month, boats * waterHours);
        const rate = effectiveOn(
          ctx.data.plan_boat_rates.filter((r) => r.boat_class_id === classId),
          a.date,
        );
        if (rate === undefined) continue;
        book(
          posting.boat_maintenance,
          boats * waterHours * rate.maintenance_per_boat_hour_cents,
          `boats:${classId}`,
          "Boats × on-water hours × the class's maintenance rate",
        );
      }

      for (const use of a.stored === null ? [] : (resourcesByActivity.get(a.stored.id) ?? [])) {
        const resource = ctx.effectiveByKey(ctx.data.plan_resources, use.resource_key, a.date);
        if (resource === undefined) {
          this.warnOnce("unknown_resource", `Activity uses missing resource ${use.resource_key}`, use.resource_key);
          continue;
        }
        const hours = use.hours ?? paidHours;
        book(
          posting.resources,
          use.quantity * (hours * hourlyCost(resource) + (resource.cost_per_day_cents ?? 0)),
          `resource:${use.resource_key}`,
          `${resource.name}: quantity × hours × hourly cost, plus a day rate`,
        );
      }
    }

    this.bookTrips(staffed);

    return {
      coaching,
      activities: staffed.map((s) => ({
        offering_id: s.a.offering.id,
        offering_key: s.a.offering.key,
        schedule_rule_id: s.a.rule?.id ?? null,
        trip_id: s.a.trip?.id ?? null,
        activity_id: s.a.stored?.id ?? null,
        date: s.a.date,
        kind: s.a.kind,
        paid_minutes: s.a.paid_minutes,
        on_water_minutes: s.a.on_water_minutes,
        uses_boats: s.a.uses_boats,
        coaches: s.coaches,
        ribs: s.ribs,
        boats: sum(s.boats.values()),
        block_rule_id: s.block?.id ?? null,
      })),
    };
  }

  /**
   * A trip's coaches each fly and stay; the miles are driven once. The rates are assumptions named
   * `lodging_per_night_cents` and `mileage_rate_cents`.
   */
  private bookTrips(staffed: Staffed[]): void {
    const { ctx } = this;
    for (const trip of ctx.data.plan_trips) {
      const offering = ctx.offeringsById.get(trip.offering_id);
      if (offering === undefined) continue;
      const travel = staffed.find((s) => s.a.trip?.id === trip.id);
      const coaches =
        travel?.coaches ?? offering.fixed_coaches ?? coachesFor(offering, ctx.enrollment.get(offering.id) ?? 0);
      const assumptions = ctx.assumptionsOn(trip.starts_on);
      const lodging = assumptions.get("lodging_per_night_cents");
      const mileage = assumptions.get("mileage_rate_cents");
      if ((trip.nights ?? 0) > 0 && lodging === undefined) {
        this.warnOnce(
          "no_assumption",
          "Trips have nights but no lodging_per_night_cents assumption",
          "lodging_per_night_cents",
        );
      }
      if ((trip.miles ?? 0) > 0 && mileage === undefined) {
        this.warnOnce("no_assumption", "Trips have miles but no mileage_rate_cents assumption", "mileage_rate_cents");
      }
      const amount =
        coaches * (trip.airfare_cents ?? 0) +
        coaches * (trip.nights ?? 0) * (lodging ?? 0) +
        (trip.miles ?? 0) * (mileage ?? 0);
      const account = ctx.data.posting_accounts.travel;
      ctx.book({
        cost_center_type: "offering",
        cost_center_key: offering.key,
        account_id: account,
        function: ctx.functionFor(account, null, "offering"),
        basis: "both",
        month: monthOf(trip.starts_on),
        amount,
        line_key: `trip:${trip.key}`,
        explanation: `${trip.name}: ${round2(coaches)} coaches, ${trip.nights ?? 0} nights, ${trip.miles ?? 0} miles`,
      });
    }
  }
}

function hourlyCost(r: PlanResource): number {
  return (r.cost_per_hour_cents ?? 0) + (r.fuel_per_hour_cents ?? 0) + (r.maintenance_per_hour_cents ?? 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
