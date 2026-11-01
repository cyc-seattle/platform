import { isoWeekday, within } from "./dates.ts";
import type { Context } from "./context.ts";
import type { ScheduledActivity } from "./activities.ts";
import type {
  ComputedActivity,
  CostType,
  Id,
  PlanActivityBlockRule,
  PlanOffering,
  PlanResource,
  PlanStaffLevel,
} from "./types.ts";

/** Hours a salaried position coached, by offering key, for the salaried rule. */
export interface SalariedCoaching {
  position_key: Id;
  offering_key: Id;
  hours: number;
  /** `salary` hours are charged at the salary's hourly equivalent; `hourly` ones are paid as wages. */
  pay: "salary" | "hourly";
  /** The wages for `hourly` hours. */
  wages: number;
}

/** Whole kids: `target_enrollment` if set, otherwise `capacity × fill_rate` rounded. */
export function enrollmentOf(offering: PlanOffering): number {
  if (offering.target_enrollment != null) return Math.round(offering.target_enrollment);
  return Math.round((offering.capacity ?? 0) * (offering.fill_rate ?? 0));
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
  /** Salaried positions coaching for an hourly wage, already among the hourly coaches. */
  hourlyPositions: { key: Id; coaches: number }[];
  level: PlanStaffLevel | undefined;
  block: PlanActivityBlockRule | null;
  /** The block group it's staffed with, if any. */
  group: string | null;
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

  private levelFor(offering: PlanOffering, block: PlanActivityBlockRule | null): PlanStaffLevel | undefined {
    const levels = this.ctx.data.plan_staff_levels;
    const blockLevel = block?.coach_level_id == null ? undefined : levels.find((l) => l.id === block.coach_level_id);
    if (blockLevel !== undefined) return blockLevel;
    if (offering.coach_level_key == null) return undefined;
    return levels.find((l) => l.key === offering.coach_level_key);
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
    const { offering, stored } = a;
    const enrollment = this.ctx.enrollment.get(offering.id) ?? 0;
    const fixedCoaches = stored.fixed_coaches ?? offering.fixed_coaches;
    const fixedRibs = stored.fixed_ribs ?? offering.fixed_ribs;
    const fixedBoats = stored.fixed_boats ?? offering.fixed_boats;
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
      hourlyPositions: [],
      level: undefined,
      block: null,
      group: null,
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

    // The block's salaried positions, and its offerings' named coaches, take its first coaching
    // slots. Those paid out of a salary mean fewer hourly coaches are paid.
    // An offering with a fixed coach count keeps out of the shared coaches, so its coach does too.
    for (const s of group) if (s.fixed.coaches) this.staffNamedCoach(s);
    const named = (pay: "salary" | "hourly") =>
      coached.flatMap((s) =>
        s.a.offering.coach_position_key != null && payOf(s.a.offering) === pay ? [s.a.offering.coach_position_key] : [],
      );
    const positions = [...new Set([...(block.salaried_positions ?? []), ...named("salary")])];
    const hourlyPositions = [...new Set(named("hourly"))].filter((key) => !positions.includes(key));
    if (coachTotal > 0) {
      const salariedTotal = Math.min(positions.length, coachTotal);
      const hourlyTotal = Math.min(hourlyPositions.length, coachTotal - salariedTotal);
      for (const s of coached) {
        s.salaried = (salariedTotal * s.coaches) / coachTotal;
        s.positions =
          salariedTotal > 0 ? positions.map((key) => ({ key, coaches: s.salaried / positions.length })) : [];
        const hourly = (hourlyTotal * s.coaches) / coachTotal;
        s.hourlyPositions =
          hourlyTotal > 0 ? hourlyPositions.map((key) => ({ key, coaches: hourly / hourlyPositions.length })) : [];
      }
    }
  }

  /** An offering's named coach, on an activity outside any block: one of its coaches. */
  private staffNamedCoach(s: Staffed): void {
    const key = s.a.offering.coach_position_key;
    if (key == null || s.a.kind === "travel" || s.coaches <= 0) return;
    const coaches = Math.min(1, s.coaches);
    if (payOf(s.a.offering) === "salary") {
      s.salaried = coaches;
      s.positions = [{ key, coaches }];
    } else {
      s.hourlyPositions = [{ key, coaches }];
    }
  }

  /**
   * Splits a block's activities on one date into groups whose times overlap. An activity with no
   * times overlaps every other.
   */
  private overlapping(members: Staffed[]): Staffed[][] {
    if (members.some((s) => s.a.start_minutes === null || s.a.end_minutes === null)) return [members];
    const sorted = [...members].sort((x, y) => (x.a.start_minutes as number) - (y.a.start_minutes as number));
    const groups: Staffed[][] = [];
    let end = -Infinity;
    for (const s of sorted) {
      const last = groups.at(-1);
      if (last !== undefined && (s.a.start_minutes as number) < end) {
        last.push(s);
        end = Math.max(end, s.a.end_minutes as number);
      } else {
        groups.push([s]);
        end = s.a.end_minutes as number;
      }
    }
    return groups;
  }

  /**
   * Warns when a salaried position coaches two activities at once that aren't staffed as one block
   * group. It's still charged to both.
   */
  private checkDoubleBooked(staffed: Staffed[]): void {
    const byDay = new Map<string, Staffed[]>();
    for (const s of staffed) {
      for (const p of [...s.positions, ...s.hourlyPositions]) {
        if (p.coaches <= 0) continue;
        const id = `${p.key}|${s.a.date}`;
        byDay.set(id, [...(byDay.get(id) ?? []), s]);
      }
    }
    const names = new Map(this.ctx.data.plan_salaried_positions.map((p) => [p.key, p.name]));
    for (const [id, list] of byDay) {
      const [key, date] = id.split("|") as [Id, string];
      const clash = list.flatMap((x, i) =>
        list
          .slice(i + 1)
          .flatMap((y) => ((x.group !== null && x.group === y.group) || !overlaps(x, y) ? [] : [[x, y] as const])),
      )[0];
      if (clash === undefined) continue;
      this.ctx.warn(
        "position_double_booked",
        `${names.get(key) ?? key} coaches ${clash[0].a.offering.name} and ${clash[1].a.offering.name} at the same time on ${date}`,
        key,
      );
    }
  }

  /**
   * One RIB's hourly and daily cost, averaged over the RIB resources by `quantity`, and the part of
   * it from resources excluded from MTDC, such as rentals.
   */
  private ribRate(): { hourly: number; daily: number; rental: number; hourlyRental: number } | undefined {
    const kind = this.ctx.data.rib_resource_kind_id;
    if (kind == null) return undefined;
    const ribs = this.ctx.data.plan_resources.filter((r) => r.resource_kind_id === kind);
    if (ribs.length === 0) return undefined;
    const weight = (r: PlanResource): number => r.quantity ?? 1;
    const totalWeight = sum(ribs.map(weight));
    const average = (rows: PlanResource[], cost: (r: PlanResource) => number): number =>
      sum(rows.map((r) => weight(r) * cost(r))) / totalWeight;
    const rentals = ribs.filter((r) => r.excluded_from_mtdc);
    return {
      hourly: average(ribs, hourlyCost),
      daily: average(ribs, (r) => r.cost_per_day_cents ?? 0),
      hourlyRental: average(rentals, hourlyCost),
      rental: average(rentals, (r) => r.cost_per_day_cents ?? 0),
    };
  }

  /** Staffs every activity, and records what its coaches, RIBs, boats and resources cost. */
  run(scheduled: ScheduledActivity[]): { activities: ComputedActivity[]; coaching: SalariedCoaching[] } {
    const { ctx } = this;
    const staffed = scheduled.map((a) => this.initial(a));

    const days = new Map<string, { block: PlanActivityBlockRule; members: Staffed[] }>();
    for (const s of staffed) {
      const block = this.blockFor(s.a);
      if (block === null) {
        this.staffNamedCoach(s);
        continue;
      }
      const id = `${block.id}|${s.a.date}`;
      const day = days.get(id) ?? { block, members: [] };
      day.members.push(s);
      days.set(id, day);
    }
    for (const [id, { block, members }] of days) {
      this.overlapping(members).forEach((group, i) => {
        for (const s of group) s.group = `${id}|${i}`;
        this.staffBlock(block, group);
      });
    }
    this.checkDoubleBooked(staffed);

    const coaching: SalariedCoaching[] = [];
    const resourcesByActivity = new Map<Id, typeof ctx.data.plan_activity_resources>();
    for (const r of ctx.data.plan_activity_resources) {
      resourcesByActivity.set(r.activity_id, [...(resourcesByActivity.get(r.activity_id) ?? []), r]);
    }
    const resources = new Map(ctx.data.plan_resources.map((r) => [r.key, r]));
    const ribRate = this.ribRate();

    for (const s of staffed) {
      const { a } = s;
      const offering = a.offering;
      const key = offering.key;
      const paidHours = a.paid_minutes / 60;
      const waterHours = a.on_water_minutes / 60;

      const book = (type: CostType, amount: number, line: string, explanation: string, mtdcShare = 1): void => {
        if (amount === 0) return;
        const account = ctx.costAccount(type);
        if (account === undefined) return;
        ctx.book({
          cost_center_type: "offering",
          cost_center_key: key,
          account_id: account,
          function: ctx.functionFor(account, null, "offering"),
          amount,
          line_key: `${line}:${key}`,
          explanation,
          mtdc_share: mtdcShare,
          wages: type === "coach_wages",
        });
      };

      s.level = this.levelFor(offering, s.block);
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
      book("coach_wages", wages, "coach_wages", "Hourly coaches × paid hours × the coach level's rate");
      for (const p of s.positions) {
        coaching.push({
          position_key: p.key,
          offering_key: key,
          hours: p.coaches * paidHours,
          pay: "salary",
          wages: 0,
        });
      }
      for (const p of s.hourlyPositions) {
        const hours = p.coaches * paidHours;
        coaching.push({ position_key: p.key, offering_key: key, hours, pay: "hourly", wages: hours * rate });
      }

      if (s.ribs > 0 && waterHours > 0) {
        if (ribRate === undefined) {
          this.warnOnce("no_rib_rate", "No RIB resource is in the plan, so RIBs cost nothing", "ribs");
        } else {
          const cost = s.ribs * (waterHours * ribRate.hourly + ribRate.daily);
          const rental = s.ribs * (waterHours * ribRate.hourlyRental + ribRate.rental);
          book(
            "ribs",
            cost,
            "ribs",
            "RIBs × on-water hours × the RIB rate, plus a day rate",
            cost > 0 ? 1 - rental / cost : 1,
          );
        }
      }

      for (const [classId, boats] of s.boats) {
        if (boats <= 0 || waterHours <= 0) continue;
        const boatRate = ctx.data.plan_boat_rates.find((r) => r.boat_class_id === classId);
        if (boatRate === undefined) continue;
        book(
          "boat_maintenance",
          boats * waterHours * boatRate.maintenance_per_boat_hour_cents,
          `boats:${classId}`,
          "Boats × on-water hours × the class's maintenance rate",
        );
      }

      for (const use of resourcesByActivity.get(a.stored.id) ?? []) {
        const resource = resources.get(use.resource_key);
        if (resource === undefined) {
          this.warnOnce("unknown_resource", `Activity uses missing resource ${use.resource_key}`, use.resource_key);
          continue;
        }
        const hours = use.hours ?? paidHours;
        book(
          "resources",
          use.quantity * (hours * hourlyCost(resource) + (resource.cost_per_day_cents ?? 0)),
          `resource:${use.resource_key}`,
          `${resource.name}: quantity × hours × hourly cost, plus a day rate`,
          resource.excluded_from_mtdc ? 0 : 1,
        );
      }
    }

    this.bookTrips(staffed);

    return {
      coaching,
      activities: staffed.map((s) => ({
        offering_id: s.a.offering.id,
        offering_key: s.a.offering.key,
        trip_id: s.a.trip?.id ?? null,
        activity_id: s.a.stored.id,
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
   * A trip's coaches each fly and stay; the miles are driven once. Its coaches are those of its
   * travel days; with none, the offering's coaching ratio sets them.
   */
  private bookTrips(staffed: Staffed[]): void {
    const { ctx } = this;
    for (const trip of ctx.data.plan_trips) {
      const offering = ctx.offeringsById.get(trip.offering_id);
      if (offering === undefined || !ctx.inYear(offering)) continue;
      const travel = staffed.find((s) => s.a.trip?.id === trip.id);
      const coaches =
        travel?.coaches ?? offering.fixed_coaches ?? coachesFor(offering, ctx.enrollment.get(offering.id) ?? 0);
      const lodging = ctx.rates?.lodging_per_night_cents ?? null;
      const mileage = ctx.rates?.mileage_rate_cents ?? null;
      if ((trip.nights ?? 0) > 0 && lodging === null) {
        this.warnOnce("no_rate", "Trips have nights but no lodging_per_night_cents rate", "lodging_per_night_cents");
      }
      if ((trip.miles ?? 0) > 0 && mileage === null) {
        this.warnOnce("no_rate", "Trips have miles but no mileage_rate_cents rate", "mileage_rate_cents");
      }
      const amount =
        coaches * (trip.airfare_cents ?? 0) +
        coaches * (trip.nights ?? 0) * (lodging ?? 0) +
        (trip.miles ?? 0) * (mileage ?? 0);
      if (amount === 0) continue;
      const account = ctx.costAccount("travel");
      if (account === undefined) continue;
      ctx.book({
        cost_center_type: "offering",
        cost_center_key: offering.key,
        account_id: account,
        function: ctx.functionFor(account, null, "offering"),
        amount,
        line_key: `trip:${trip.key}`,
        explanation: `${trip.name}: ${round2(coaches)} coaches, ${trip.nights ?? 0} nights, ${trip.miles ?? 0} miles`,
      });
    }
  }
}

function payOf(offering: PlanOffering): "salary" | "hourly" {
  return offering.coach_position_pay ?? "salary";
}

/** Whether two activities' times overlap. One with no times overlaps everything on its date. */
function overlaps(x: Staffed, y: Staffed): boolean {
  const [xs, xe, ys, ye] = [x.a.start_minutes, x.a.end_minutes, y.a.start_minutes, y.a.end_minutes];
  if (xs === null || xe === null || ys === null || ye === null) return true;
  return xs < ye && ys < xe;
}

function hourlyCost(r: PlanResource): number {
  return (r.cost_per_hour_cents ?? 0) + (r.fuel_per_hour_cents ?? 0) + (r.maintenance_per_hour_cents ?? 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
