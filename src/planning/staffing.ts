import type { Context, WarningScope } from "./context.ts";
import type { ScheduledActivity } from "./activities.ts";
import type {
  Asset,
  ComputedActivity,
  CostType,
  DateString,
  Id,
  PlanActivityBlock,
  PlanBlockBoats,
  PlanBlockResource,
  PlanBlockStaff,
  PlanOffering,
  PlanProgram,
  PlanResource,
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

/** A salaried position's year of coaching two blocks at once. */
export interface DoubleBooked {
  /** Hours another coach would need: n − 1 for each hour it's on n blocks at once. */
  hours: number;
  /** Dates it's on two blocks at once. */
  dates: number;
}

/** Whole kids: `target_enrollment` if set, otherwise `capacity × fill_rate` rounded. */
export function enrollmentOf(offering: PlanOffering): number {
  if (offering.target_enrollment != null) return Math.round(offering.target_enrollment);
  return Math.round((offering.capacity ?? 0) * (offering.fill_rate ?? 0));
}

/** A block with its activities, its times, and what it's given. */
interface Block {
  row: PlanActivityBlock;
  members: ScheduledActivity[];
  /** Minutes after midnight, from its first activity's start to its last one's end; null when one has no times. */
  start: number | null;
  end: number | null;
  paid_minutes: number;
  on_water_minutes: number;
  staff: PlanBlockStaff[];
  resources: PlanBlockResource[];
  boats: PlanBlockBoats[];
  /** Each member's share of the block's costs, by its offering's sailors. */
  shares: Map<ScheduledActivity, number>;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * `n` of something, in words: "9 Sailqubes", "1 Opti". Only a one-word name is made plural, and not one that already
 * ends in "s", such as RIBs; any other name is used as given, since adding an "s" to "Laser Radial" reads wrong.
 */
function countOf(n: number, name: string): string {
  return `${n} ${n === 1 ? name : pluralOf(name)}`;
}

function pluralOf(name: string): string {
  return /^\S+$/.test(name) && !/s$/i.test(name) ? `${name}s` : name;
}

const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** A date as a person says it: "July 13". */
function dayOf(date: DateString): string {
  return day.format(new Date(`${date}T00:00:00Z`));
}

/** Names as a sentence lists them: `a`, `a and b`, or `a, b, and c`. */
function listOf(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** The offerings a block holds, by name, so a warning about it says whose it is. */
function offeringsOf(block: Block): string {
  return listOf([...new Set(block.members.map((a) => a.offering.name))]);
}

function groupBy<T>(rows: T[], key: (row: T) => Id): Map<Id, T[]> {
  const groups = new Map<Id, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

export class Staffing {
  private readonly ctx: Context;
  private readonly warned = new Set<string>();

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  /** Warns once for each row and plan copy, about the first date it's seen on. */
  private warnOnce(code: string, message: string, key: string, scope: WarningScope = {}): void {
    const id = `${code}|${key}|${scope.version_id ?? ""}`;
    if (this.warned.has(id)) return;
    this.warned.add(id);
    this.ctx.warn(code, message, key, scope);
  }

  /**
   * Gathers each block's activities, times and allocations. A block's paid time runs from its first
   * activity's start to its last one's end, plus the longest setup and put-away. Its time on the
   * water is the longest `on_water_minutes` its activities set, or else the span of those that sail.
   */
  private blocks(scheduled: ScheduledActivity[]): Map<Id, Block> {
    const { data } = this.ctx;
    const staff = groupBy(data.plan_block_staff, (r) => r.block_id);
    const resources = groupBy(data.plan_block_resources, (r) => r.block_id);
    const boats = groupBy(data.plan_block_boats, (r) => r.block_id);
    const rows = new Map(data.plan_activity_blocks.map((b) => [b.id, b]));
    const members = new Map<Id, ScheduledActivity[]>();
    for (const a of scheduled) {
      const id = a.stored.block_id;
      if (id == null) continue;
      const row = rows.get(id);
      if (row === undefined) {
        this.ctx.warn(
          "unknown_block",
          `${a.offering.name}'s ${a.kind} is in a block that isn't in the plan`,
          a.stored.key,
        );
        continue;
      }
      if (row.date !== a.date) {
        this.ctx.warn(
          "block_date_mismatch",
          `${a.offering.name}'s ${a.kind} is in ${row.name}, which is on ${dayOf(row.date)}`,
          a.stored.key,
          { version_id: a.stored.version_id, date: a.date },
        );
      }
      members.set(id, [...(members.get(id) ?? []), a]);
    }

    const result = new Map<Id, Block>();
    for (const [id, list] of members) {
      const row = rows.get(id) as PlanActivityBlock;
      const span = timeSpan(list);
      const sailing = list.filter((a) => a.uses_boats);
      const set = sailing.flatMap((a) => (a.stored.on_water_minutes == null ? [] : [a.stored.on_water_minutes]));
      const sailingSpan = timeSpan(sailing);
      const sailingMinutes =
        sailingSpan.start === null || sailingSpan.end === null
          ? Math.max(0, ...sailing.map((a) => a.on_water_minutes))
          : sailingSpan.end - sailingSpan.start;
      // Each offering's sailors count once, split among its activities in the block.
      const enrollment = (a: ScheduledActivity) => this.ctx.enrollment.get(a.offering.id) ?? 0;
      const byOffering = groupBy(list, (a) => a.offering.id);
      const total = sum([...byOffering.values()].map((own) => enrollment(own[0]!)));
      const share = (a: ScheduledActivity) =>
        (total > 0 ? enrollment(a) / total : 1 / byOffering.size) / byOffering.get(a.offering.id)!.length;
      result.set(id, {
        row,
        members: list,
        ...span,
        paid_minutes:
          (span.start === null || span.end === null ? 0 : span.end - span.start) +
          Math.max(0, ...list.map((a) => a.stored.setup_minutes ?? 0)) +
          Math.max(0, ...list.map((a) => a.stored.putaway_minutes ?? 0)),
        on_water_minutes: set.length > 0 ? Math.max(...set) : sailingMinutes,
        staff: staff.get(id) ?? [],
        resources: resources.get(id) ?? [],
        boats: boats.get(id) ?? [],
        shares: new Map(list.map((a) => [a, share(a)])),
      });
    }
    return result;
  }

  /** Warns about each activity, other than travel, that's in no block, or in one with no staff. */
  private checkUnallocated(scheduled: ScheduledActivity[], blocks: Map<Id, Block>): void {
    for (const a of scheduled) {
      if (a.kind === "travel") continue;
      const block = a.stored.block_id == null ? undefined : blocks.get(a.stored.block_id);
      if (block !== undefined && sum(block.staff.map((s) => s.count)) > 0) continue;
      this.ctx.warn("unallocated_activity", `${a.offering.name}'s ${a.kind} has no staff`, a.stored.key, {
        version_id: a.stored.version_id,
        date: a.date,
      });
    }
  }

  /** Each program's settings, by its product. */
  private programs(): Map<Id, PlanProgram> {
    return new Map(this.ctx.data.plan_programs.map((p) => [p.product_id, p]));
  }

  /**
   * Warns when a block's sailors are more than its staff or its boats can safely take. Each program's
   * sailors count against its own sailors per coach, and every coach on the block counts, at any
   * staff level or salaried: the ratio is required, a coach's level isn't (cyc-seattle/sail-team#82).
   * Boats count the ones sailors bring.
   */
  private checkCapacity(block: Block, programs: Map<Id, PlanProgram>): void {
    const { ctx } = this;
    const offerings = [
      ...new Map(block.members.filter((a) => a.kind !== "travel").map((a) => [a.offering.id, a.offering])).values(),
    ];
    const sailors = sum(offerings.map((o) => ctx.enrollment.get(o.id) ?? 0));
    if (sailors <= 0) return;
    const scope = { version_id: block.row.version_id, date: block.row.date };
    // The block's offerings, with the verb that agrees with them: "Guppies Week 2 has".
    const has = `${offeringsOf(block)} ${new Set(block.members.map((a) => a.offering.id)).size > 1 ? "have" : "has"}`;

    // Coaches the block needs: each program's sailors over its sailors per coach.
    let load = 0;
    let counted = 0;
    for (const o of offerings) {
      const settings = programs.get(o.product_id);
      if (settings?.staff_level_key == null || settings.sailors_per_coach == null || settings.sailors_per_coach <= 0) {
        this.warnOnce(
          "no_program_settings",
          `${o.name}'s program has no staff level or sailors per coach. Add both to check that it has enough coaches`,
          o.product_id,
          { version_id: o.version_id, date: block.row.date },
        );
        continue;
      }
      const n = ctx.enrollment.get(o.id) ?? 0;
      load += n / settings.sailors_per_coach;
      counted += n;
    }
    if (counted > 0) {
      const covered = Math.min(load, sum(block.staff.map((s) => s.count)));
      if (load > covered + 1e-9) {
        ctx.warn(
          "over_capacity",
          covered === 0
            ? `${has} ${countOf(counted, "sailor")} and no coach`
            : `${has} ${countOf(counted, "sailor")}, but enough coaches for only ${Math.floor((covered * counted) / load + 1e-9)}`,
          block.row.key,
          scope,
        );
      }
    }

    if (!block.members.some((a) => a.uses_boats)) return;
    const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    let seats = 0;
    for (const b of block.boats) {
      const perBoat = classes.get(b.boat_class_id)?.max_capacity;
      if (perBoat == null || perBoat <= 0) {
        this.warnOnce(
          "no_max_capacity",
          `${classes.get(b.boat_class_id)?.name ?? b.boat_class_id} has no max capacity. Add it to check that the boats hold every sailor`,
          b.boat_class_id,
          scope,
        );
        continue;
      }
      seats += (b.count + (b.sailor_owned ?? 0)) * perBoat;
    }
    if (sailors > seats) {
      ctx.warn(
        "over_capacity",
        seats === 0
          ? `${has} ${countOf(sailors, "sailor")} and no boats`
          : `${has} ${countOf(sailors, "sailor")}, but the boats hold only ${seats}`,
        block.row.key,
        scope,
      );
    }
  }

  /**
   * Warns when more of the organization's sailboats of one class, or its coach boats, are given to
   * blocks at once on a date than it has that day on the asset list. Boats sailors bring don't count.
   */
  private checkInventory(blocks: Block[]): void {
    const { ctx } = this;
    const dates = groupBy(blocks, (b) => b.row.date);
    const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    const assets = new Map(ctx.data.assets.map((a) => [a.id, a]));
    const boats = new Map(ctx.data.boats.map((b) => [b.id, b]));
    const sailboats = ctx.data.sailboats.flatMap((s) => {
      const asset = assets.get(boats.get(s.boat_id)?.asset_id ?? "");
      return asset === undefined ? [] : [{ asset, boat_class_id: s.boat_class_id }];
    });
    const powerboats = ctx.data.assets.filter((a) => a.kind === "powerboat");
    const ribKind = ctx.data.rib_resource_kind_id;
    const coachBoats = new Set(
      ctx.data.plan_resources.filter((r) => ribKind != null && r.resource_kind_id === ribKind).map((r) => r.key),
    );
    const organization = ctx.data.organization.name;
    for (const [date, list] of dates) {
      const has = (a: Asset) =>
        (a.acquired_on == null || a.acquired_on <= date) && (a.disposed_on == null || date < a.disposed_on);
      const check = (code: string, what: string, have: number, used: (b: Block) => number, plural = pluralOf(what)) => {
        const out = list.flatMap((b) => (used(b) > 0 ? [{ block: b, n: used(b) }] : []));
        const peak = mostAtOnce(out);
        if (peak.total <= have) return;
        const only = have === 0 ? "none" : `only ${have}`;
        const count = `${peak.total} ${peak.total === 1 ? what : plural}`;
        const message =
          peak.at.length === 1
            ? `${count} out at once for ${offeringsOf(peak.at[0]!.block)}, but ${organization} has ${only}`
            : `${count} out at once, but ${organization} has ${only}: ${listOf(peak.at.map(({ block, n }) => `${n} for ${offeringsOf(block)}`))}`;
        for (const version of new Set(peak.at.map(({ block }) => block.row.version_id))) {
          ctx.warn(code, message, what, {
            version_id: version,
            date: date as DateString,
          });
        }
      };
      const classIds = new Set(list.flatMap((b) => b.boats.filter((x) => x.count > 0).map((x) => x.boat_class_id)));
      for (const id of classIds) {
        const have = sailboats.filter((s) => s.boat_class_id === id && has(s.asset)).length;
        check("over_inventory_boats", classes.get(id)?.name ?? id, have, (b) =>
          sum(b.boats.filter((x) => x.boat_class_id === id).map((x) => x.count)),
        );
      }
      if (coachBoats.size > 0) {
        check(
          "over_inventory_resource",
          "coach boat",
          powerboats.filter(has).length,
          (b) => sum(b.resources.filter((x) => coachBoats.has(x.resource_key)).map((x) => x.quantity)),
          "coach boats",
        );
      }
    }
  }

  /**
   * Warns when a salaried position coaches two blocks whose times overlap. It's still charged to
   * both. Returns each position's double-booked hours and dates.
   */
  private checkDoubleBooked(blocks: Block[]): Map<Id, DoubleBooked> {
    const byDay = new Map<string, Block[]>();
    for (const b of blocks) {
      for (const s of b.staff) {
        if (s.position_key == null || s.count <= 0) continue;
        const id = `${s.position_key}|${b.row.date}`;
        byDay.set(id, [...(byDay.get(id) ?? []), b]);
      }
    }
    const names = new Map(this.ctx.data.plan_salaried_positions.map((p) => [p.key, p.name]));
    const result = new Map<Id, DoubleBooked>();
    for (const [id, list] of byDay) {
      const [key, date] = id.split("|") as [Id, string];
      const clash = list.flatMap((x, i) =>
        list.slice(i + 1).flatMap((y) => (overlaps(x, y) ? [[x, y] as const] : [])),
      )[0];
      if (clash === undefined) continue;
      const hours = extraCoachMinutes(list) / 60;
      const total = result.get(key) ?? { hours: 0, dates: 0 };
      result.set(key, { hours: total.hours + hours, dates: total.dates + 1 });
      for (const version of new Set(list.map((b) => b.row.version_id))) {
        this.ctx.warn(
          "position_double_booked",
          `${names.get(key) ?? key} coaches ${clash[0].row.name} and ${clash[1].row.name} at the same time` +
            (hours > 0 ? `, so another coach is needed for ${round2(hours)} hours` : ""),
          key,
          { version_id: version, date },
        );
      }
    }
    return result;
  }

  /** Costs every block's staff, coach boats, boats and resources, and checks them against the limits. */
  run(scheduled: ScheduledActivity[]): {
    activities: ComputedActivity[];
    coaching: SalariedCoaching[];
    doubleBooked: Map<Id, DoubleBooked>;
  } {
    const { ctx } = this;
    const blocks = this.blocks(scheduled);
    this.checkUnallocated(scheduled, blocks);
    const programs = this.programs();
    // By date, so a warning given once names the first date it's seen on.
    for (const block of byDate(blocks)) this.checkCapacity(block, programs);
    this.checkInventory(byDate(blocks));
    const doubleBooked = this.checkDoubleBooked([...blocks.values()]);

    const coaching: SalariedCoaching[] = [];
    const levels = new Map(ctx.data.plan_staff_levels.map((l) => [l.key, l]));
    const positions = new Map(ctx.data.plan_salaried_positions.map((p) => [p.key, p]));
    const resources = new Map(ctx.data.plan_resources.map((r) => [r.key, r]));
    const boatClasses = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    const boatRates = new Map(ctx.data.plan_boat_rates.map((r) => [r.boat_class_id, r]));
    const ribKind = ctx.data.rib_resource_kind_id;
    const given = new Map<ScheduledActivity, { coaches: number; ribs: number; boats: number }>();

    for (const block of byDate(blocks)) {
      const scope = { version_id: block.row.version_id, date: block.row.date };
      const paidHours = block.paid_minutes / 60;
      const waterHours = block.on_water_minutes / 60;

      // Each cost is split among the block's activities by their offerings' sailors.
      const book = (
        type: CostType,
        amount: number,
        line: string,
        name: string,
        explanation: string,
        mtdcShare = 1,
      ): void => {
        if (amount === 0) return;
        const account = ctx.costAccount(type);
        if (account === undefined) return;
        for (const [a, share] of block.shares) {
          ctx.book({
            cost_center_type: "offering",
            cost_center_key: a.offering.key,
            account_id: account,
            function: ctx.functionFor(account, null, "offering"),
            amount: amount * share,
            line_key: `${line}:${a.offering.key}`,
            line_name: name,
            explanation,
            mtdc_share: mtdcShare,
            wages: type === "coach_wages",
          });
        }
      };

      let wages = 0;
      for (const s of block.staff) {
        if (s.count <= 0) continue;
        if (s.position_key != null) {
          const position = positions.get(s.position_key);
          const hours = s.count * paidHours;
          if (s.pay === "hourly") {
            const rate = position?.hourly_coaching_rate_cents;
            if (position !== undefined && rate == null) {
              this.warnOnce(
                "no_hourly_rate",
                `${position.name} is paid by the hour to coach but has no own hourly coaching rate, so those hours cost nothing`,
                position.key,
                scope,
              );
            }
            wages += hours * (rate ?? 0);
            for (const [a, share] of block.shares) {
              coaching.push({
                position_key: s.position_key,
                offering_key: a.offering.key,
                hours: hours * share,
                pay: "hourly",
                wages: hours * share * (rate ?? 0),
              });
            }
          } else {
            for (const [a, share] of block.shares) {
              coaching.push({
                position_key: s.position_key,
                offering_key: a.offering.key,
                hours: hours * share,
                pay: "salary",
                wages: 0,
              });
            }
          }
          continue;
        }
        const level = s.staff_level_key == null ? undefined : levels.get(s.staff_level_key);
        if (level === undefined) {
          this.warnOnce(
            "unknown_staff_level",
            `${block.row.name} has staff at a staff level that isn't in the Operations Plan, so they cost nothing`,
            s.staff_level_key ?? s.key,
            scope,
          );
          continue;
        }
        if (level.pay_type !== "volunteer") wages += s.count * paidHours * (level.hourly_rate_cents ?? 0);
      }
      book("coach_wages", wages, "coach_wages", "Coach wages", "Staff × paid hours × each one's hourly rate");

      let ribs = 0;
      for (const use of block.resources) {
        const resource = resources.get(use.resource_key);
        if (resource === undefined) {
          this.warnOnce(
            "unknown_resource",
            `${block.row.name} uses resource ${use.resource_key}, which isn't in the plan`,
            use.resource_key,
            scope,
          );
          continue;
        }
        const rib = ribKind != null && resource.resource_kind_id === ribKind;
        if (rib) ribs += use.quantity;
        const hours = use.hours ?? (rib ? waterHours : paidHours);
        const cost = use.quantity * (hours * hourlyCost(resource) + (resource.cost_per_day_cents ?? 0));
        book(
          rib ? "ribs" : "resources",
          cost,
          rib ? "ribs" : `resource:${resource.key}`,
          rib ? "Coach boats" : resource.name,
          `${resource.name}: quantity × hours × hourly cost, plus a day rate`,
          resource.excluded_from_mtdc ? 0 : 1,
        );
      }

      for (const b of block.boats) {
        const rate = boatRates.get(b.boat_class_id);
        if (rate === undefined || b.count <= 0 || waterHours <= 0) continue;
        book(
          "boat_maintenance",
          b.count * waterHours * rate.maintenance_per_boat_hour_cents,
          `boats:${b.boat_class_id}`,
          `Boat maintenance: ${boatClasses.get(b.boat_class_id)?.name ?? "boats"}`,
          "The organization's boats × on-water hours × the class's maintenance rate",
        );
      }

      const coaches = sum(block.staff.map((s) => s.count));
      const boats = sum(block.boats.map((b) => b.count));
      for (const [a, share] of block.shares) {
        given.set(a, { coaches: coaches * share, ribs: ribs * share, boats: boats * share });
      }
    }

    this.bookTrips(blocks, scheduled);

    return {
      coaching,
      doubleBooked,
      activities: scheduled.map((a) => ({
        offering_id: a.offering.id,
        offering_key: a.offering.key,
        trip_id: a.trip?.id ?? null,
        activity_id: a.stored.id,
        date: a.date,
        kind: a.kind,
        paid_minutes: a.paid_minutes,
        on_water_minutes: a.on_water_minutes,
        uses_boats: a.uses_boats,
        coaches: given.get(a)?.coaches ?? 0,
        ribs: given.get(a)?.ribs ?? 0,
        boats: given.get(a)?.boats ?? 0,
        block_id: blocks.has(a.stored.block_id ?? "") ? a.stored.block_id : null,
      })),
    };
  }

  /**
   * A trip's coaches each fly and stay; the miles are driven once. Its coaches are the staff on the
   * block of its busiest travel day.
   */
  private bookTrips(blocks: Map<Id, Block>, scheduled: ScheduledActivity[]): void {
    const { ctx } = this;
    for (const trip of ctx.data.plan_trips) {
      const offering = ctx.offeringsById.get(trip.offering_id);
      if (offering === undefined || !ctx.inYear(offering)) continue;
      const travel = (a: ScheduledActivity) => a.kind === "travel" && a.trip?.id === trip.id;
      const staffed = [...blocks.values()].filter((b) => b.members.some(travel));
      const coaches = Math.max(0, ...staffed.map((b) => sum(b.staff.map((s) => s.count))));
      if (coaches === 0 && ((trip.airfare_cents ?? 0) > 0 || (trip.nights ?? 0) > 0)) {
        const first = scheduled
          .filter(travel)
          .map((a) => a.date)
          .sort()[0];
        this.warnOnce(
          "trip_without_staff",
          `${trip.name} has no staff on its travel days, so the plan has no airfare or lodging for its coaches`,
          trip.key,
          { version_id: trip.version_id, ...(first !== undefined && { date: first }) },
        );
      }
      const lodging = ctx.rates?.lodging_per_night_cents ?? null;
      const mileage = ctx.rates?.mileage_rate_cents ?? null;
      if ((trip.nights ?? 0) > 0 && lodging === null) {
        this.warnOnce(
          "no_rate",
          "Trips have nights, but the Operations Plan has no lodging per night",
          "lodging_per_night_cents",
        );
      }
      if ((trip.miles ?? 0) > 0 && mileage === null) {
        this.warnOnce("no_rate", "Trips have miles, but the Operations Plan has no mileage rate", "mileage_rate_cents");
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
        line_name: trip.name,
        explanation: `${trip.name}: ${round2(coaches)} coaches, ${trip.nights ?? 0} nights, ${trip.miles ?? 0} miles`,
      });
    }
  }
}

const byDate = (blocks: Map<Id, Block>) => [...blocks.values()].sort((x, y) => x.row.date.localeCompare(y.row.date));

/** The first start and last end among `list`; both null when one has no times. */
function timeSpan(list: ScheduledActivity[]): { start: number | null; end: number | null } {
  if (list.length === 0 || list.some((a) => a.start_minutes === null || a.end_minutes === null)) {
    return { start: null, end: null };
  }
  return {
    start: Math.min(...list.map((a) => a.start_minutes as number)),
    end: Math.max(...list.map((a) => a.end_minutes as number)),
  };
}

/** Whether two blocks' times overlap. One with no times overlaps everything on its date. */
function overlaps(x: Block, y: Block): boolean {
  if (x.start === null || x.end === null || y.start === null || y.end === null) return true;
  return x.start < y.end && y.start < x.end;
}

/**
 * The most of something out at one moment, and the blocks that had it then. A block with no times
 * is out all day.
 */
function mostAtOnce(out: { block: Block; n: number }[]): { total: number; at: { block: Block; n: number }[] } {
  let best = { total: 0, at: [] as { block: Block; n: number }[] };
  for (const candidate of out) {
    // The peak starts when some block starts, so each block's start is a moment to check.
    const at = out.filter((o) => o === candidate || overlapsAt(o.block, candidate.block));
    const total = sum(at.map((o) => o.n));
    if (total > best.total) best = { total, at };
  }
  return best;
}

/** Whether `x` is out at the moment `y` starts. */
function overlapsAt(x: Block, y: Block): boolean {
  if (x.start === null || x.end === null || y.start === null) return true;
  return x.start <= y.start && y.start < x.end;
}

/**
 * Minutes another coach would cover among one position's blocks on one date: at each moment it's on
 * n blocks, n − 1. Blocks with no times add nothing.
 */
function extraCoachMinutes(list: Block[]): number {
  const edges = list
    .flatMap((b) =>
      b.start === null || b.end === null
        ? []
        : [
            { at: b.start, step: 1 },
            { at: b.end, step: -1 },
          ],
    )
    .sort((x, y) => x.at - y.at || x.step - y.step);
  let on = 0;
  let last = 0;
  let minutes = 0;
  for (const { at, step } of edges) {
    if (on > 1) minutes += (on - 1) * (at - last);
    on += step;
    last = at;
  }
  return minutes;
}

function hourlyCost(r: PlanResource): number {
  return (r.cost_per_hour_cents ?? 0) + (r.fuel_per_hour_cents ?? 0) + (r.maintenance_per_hour_cents ?? 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
