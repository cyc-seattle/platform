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
  PlanBlockStaff,
  PlanOffering,
  PlanProgram,
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

/** Whole kids expected: `target_enrollment`, or none when it's empty. */
export function enrollmentOf(offering: PlanOffering): number {
  return Math.round(offering.target_enrollment ?? 0);
}

/** The most sailors an offering takes: its `capacity`, or else the sailors expected. */
export function maxEnrollmentOf(offering: PlanOffering): number {
  return offering.capacity ?? enrollmentOf(offering);
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

/** The offerings a block holds, other than on a travel day, each once. */
function offeringsIn(block: Block): PlanOffering[] {
  return [
    ...new Map(block.members.filter((a) => a.kind !== "travel").map((a) => [a.offering.id, a.offering])).values(),
  ];
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

  /** Warns once for each row and plan, about the first date it's seen on. */
  private warnOnce(code: string, message: string, key: string, scope: WarningScope = {}): void {
    const id = `${code}|${key}|${scope.plan_id ?? ""}`;
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
          { plan_id: a.stored.plan_id, date: a.date },
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
        plan_id: a.stored.plan_id,
        date: a.date,
      });
    }
  }

  /** Each program's settings, by its product. */
  private programs(): Map<Id, PlanProgram> {
    return new Map(this.ctx.data.plan_programs.map((p) => [p.product_id, p]));
  }

  /**
   * Records the most sailors of each offering the block can take with every other offering full,
   * by its coaches and its seats. Each program's sailors count against its own sailors per coach,
   * and every coach on the block counts, at any staff level or salaried: the ratio is required, a
   * coach's level isn't (cyc-seattle/sail-team#82). Seats count the boats sailors bring.
   */
  private checkCapacity(block: Block, programs: Map<Id, PlanProgram>, holds: Map<Id, number>): void {
    const { ctx } = this;
    const offerings = offeringsIn(block);
    const most = (o: PlanOffering) => ctx.maxEnrollment.get(o.id) ?? 0;
    const sailors = sum(offerings.map(most));
    const warns = sailors > 0;
    const scope = { plan_id: block.row.plan_id, date: block.row.date };

    const needs = new Map<Id, number>();
    const perCoach = new Map<Id, number>();
    for (const o of offerings) {
      const settings = programs.get(o.product_id);
      if (settings?.staff_level_id == null || settings.sailors_per_coach == null || settings.sailors_per_coach <= 0) {
        if (warns) {
          this.warnOnce(
            "no_program_settings",
            `${o.name}'s program has no staff level or sailors per coach. Add both to check that ${ctx.data.organization.name} has enough coach boats`,
            o.product_id,
            { plan_id: o.plan_id, date: block.row.date },
          );
        }
        continue;
      }
      needs.set(o.id, most(o) / settings.sailors_per_coach);
      perCoach.set(o.id, settings.sailors_per_coach);
    }
    const coaches = sum(block.staff.map((s) => s.count));
    const load = sum(needs.values());

    const sails = block.members.some((a) => a.uses_boats);
    let seats = 0;
    if (sails) {
      const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
      for (const b of block.boats) {
        // A coach boat's class takes 0, without a warning.
        const perBoat = classes.get(b.boat_class_id)?.max_capacity;
        if (perBoat == null) {
          if (warns) {
            this.warnOnce(
              "no_max_capacity",
              `${classes.get(b.boat_class_id)?.name ?? b.boat_class_id} has no max capacity. Add it to check that ${ctx.data.organization.name} has enough of them`,
              b.boat_class_id,
              scope,
            );
          }
          continue;
        }
        seats += (b.count + (b.chartered ?? 0) + (b.sailor_owned ?? 0)) * perBoat;
      }
    }

    // What's left for each offering once the others in the block are full.
    for (const o of offerings) {
      const own = needs.get(o.id);
      const byCoaches =
        own === undefined ? Infinity : Math.floor((coaches - (load - own)) * perCoach.get(o.id)! + 1e-9);
      const byBoats = sails ? seats - (sailors - most(o)) : Infinity;
      const n = Math.min(byCoaches, byBoats);
      if (n === Infinity) continue;
      holds.set(o.id, Math.min(holds.get(o.id) ?? Infinity, Math.max(0, n)));
    }
  }

  /**
   * The boats of each class a block that sails would need of the organization's own with every
   * offering full. Its sailboats are scaled up from what it's given until they seat everyone, the
   * boats sailors bring kept as they are, and it needs a coach boat for each coach a full program
   * needs, the extra ones of the coach boat class it's given most of. Charters stay as given.
   */
  private ownedAtMax(block: Block, programs: Map<Id, PlanProgram>): Map<Id, number> {
    const result = new Map<Id, number>();
    if (!block.members.some((a) => a.uses_boats)) return result;
    const { ctx } = this;
    const offerings = offeringsIn(block);
    const most = (o: PlanOffering) => ctx.maxEnrollment.get(o.id) ?? 0;
    const capacity = new Map(ctx.data.boat_classes.map((c) => [c.id, c.max_capacity]));
    const given = (b: PlanBlockBoats) => b.count + (b.chartered ?? 0);
    const sailboats = block.boats.filter((b) => (capacity.get(b.boat_class_id) ?? 0) > 0);
    const coachBoats = block.boats.filter((b) => capacity.get(b.boat_class_id) === 0);

    const seats = (n: (b: PlanBlockBoats) => number) =>
      sum(sailboats.map((b) => n(b) * capacity.get(b.boat_class_id)!));
    const theirs = seats((b) => b.sailor_owned ?? 0);
    const ours = seats(given);
    const scale = ours > 0 ? Math.max(1, (sum(offerings.map(most)) - theirs) / ours) : 1;
    for (const b of sailboats) {
      const n = Math.ceil(given(b) * scale - 1e-9) - (b.chartered ?? 0);
      result.set(b.boat_class_id, (result.get(b.boat_class_id) ?? 0) + n);
    }

    const coaches = Math.ceil(
      sum(
        offerings.map((o) => {
          const perCoach = programs.get(o.product_id)?.sailors_per_coach;
          return perCoach == null || perCoach <= 0 ? 0 : most(o) / perCoach;
        }),
      ) - 1e-9,
    );
    const busiest = coachBoats.reduce<PlanBlockBoats | undefined>(
      (x, b) => (x && given(x) >= given(b) ? x : b),
      undefined,
    );
    const extra = Math.max(0, coaches - sum(coachBoats.map(given)));
    for (const b of coachBoats) {
      const n = b.count + (b === busiest ? extra : 0);
      result.set(b.boat_class_id, (result.get(b.boat_class_id) ?? 0) + n);
    }
    return result;
  }

  /** Books a cost on a block, split among its activities by their offerings' sailors. */
  private book(
    block: Block,
    account: Id | undefined,
    amount: number,
    line: string,
    name: string,
    explanation: string,
    mtdcShare = 1,
    wages = false,
  ): void {
    if (amount === 0 || account === undefined) return;
    for (const [a, share] of block.shares) {
      this.ctx.book({
        cost_center_type: "offering",
        cost_center_key: a.offering.key,
        account_id: account,
        function: this.ctx.functionFor(account, null, "offering"),
        amount: amount * share,
        line_key: `${line}:${a.offering.key}`,
        line_name: name,
        explanation,
        mtdc_share: mtdcShare,
        wages,
      });
    }
  }

  /**
   * Charges each boat class's charter rate once a day, for the most of its boats chartered at once
   * that day, shared among the blocks that charter them by how many each does. A charter is a rental,
   * so it's left out of MTDC (2 CFR 200.1).
   */
  private bookCharters(blocks: Block[]): void {
    const { ctx } = this;
    const rates = new Map(ctx.data.plan_boat_rates.map((r) => [r.boat_class_id, r]));
    const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    for (const list of groupBy(blocks, (b) => b.row.date).values()) {
      const chartered = list.flatMap((block) =>
        block.boats.flatMap((b) => ((b.chartered ?? 0) > 0 ? [{ block, id: b.boat_class_id, n: b.chartered! }] : [])),
      );
      for (const [id, uses] of groupBy(chartered, (c) => c.id)) {
        const name = classes.get(id)?.name ?? id;
        const rate = rates.get(id)?.charter_per_day_cents;
        if (rate == null) {
          for (const { block } of uses) {
            this.warnOnce(
              "no_charter_rate",
              `${block.row.name} charters ${pluralOf(name)}, but the Operations Plan has no charter rate for them, so they cost nothing`,
              id,
              { plan_id: block.row.plan_id, date: block.row.date },
            );
          }
          continue;
        }
        const day = mostAtOnce(uses).total * rate;
        const total = sum(uses.map((u) => u.n));
        for (const { block, n } of uses) {
          this.book(
            block,
            ctx.costAccount("resources"),
            (day * n) / total,
            `charters:${id}`,
            `Boat charters: ${name}`,
            "The most boats of the class chartered at once that day × the class's charter rate",
            0,
          );
        }
      }
    }
  }

  /**
   * Warns when more of the organization's boats of one class are given to blocks at once on a date
   * than it has that day on the asset list, and else when it hasn't enough for every block to run
   * full (cyc-seattle/platform#294). Boats it charters, or sailors bring, don't count. A class it
   * has none of that day is only chartered, and more can be.
   */
  private checkInventory(blocks: Block[], programs: Map<Id, PlanProgram>): void {
    const { ctx } = this;
    const dates = groupBy(blocks, (b) => b.row.date);
    const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    const assets = new Map(ctx.data.assets.map((a) => [a.id, a]));
    const boats = ctx.data.boats.flatMap((b) => {
      const asset = assets.get(b.asset_id);
      return asset === undefined ? [] : [{ asset, boat_class_id: b.boat_class_id }];
    });
    const atMax = new Map(blocks.map((b) => [b, this.ownedAtMax(b, programs)]));
    const organization = ctx.data.organization.name;
    for (const [date, list] of dates) {
      const has = (a: Asset) =>
        (a.acquired_on == null || a.acquired_on <= date) && (a.disposed_on == null || date < a.disposed_on);
      const peakOf = (used: (b: Block) => number) =>
        mostAtOnce(list.flatMap((b) => (used(b) > 0 ? [{ block: b, n: used(b) }] : [])));
      const warn = (code: string, what: string, at: { block: Block }[], message: string) => {
        for (const plan of new Set(at.map(({ block }) => block.row.plan_id))) {
          ctx.warn(code, message, what, { plan_id: plan, date: date as DateString });
        }
      };
      const classIds = new Set(list.flatMap((b) => [...b.boats.map((x) => x.boat_class_id), ...atMax.get(b)!.keys()]));
      for (const id of classIds) {
        const what = classes.get(id)?.name ?? id;
        const have = boats.filter((b) => b.boat_class_id === id && has(b.asset)).length;
        const out = peakOf((b) => sum(b.boats.filter((x) => x.boat_class_id === id).map((x) => x.count)));
        if (out.total > have) {
          const only = have === 0 ? "none" : `only ${have}`;
          const count = countOf(out.total, what);
          warn(
            "over_inventory_boats",
            what,
            out.at,
            out.at.length === 1
              ? `${count} out at once for ${offeringsOf(out.at[0]!.block)}, but ${organization} has ${only}`
              : `${count} out at once, but ${organization} has ${only}: ${listOf(out.at.map(({ block, n }) => `${n} for ${offeringsOf(block)}`))}`,
          );
          continue;
        }
        if (have === 0) continue;
        const full = peakOf((b) => atMax.get(b)!.get(id) ?? 0);
        if (full.total <= have) continue;
        const names = [...new Set(full.at.flatMap(({ block }) => block.members.map((a) => a.offering.name)))];
        const [needs, it] = names.length === 1 ? ["needs", "it's"] : ["need", "they're"];
        warn(
          "short_of_boats",
          what,
          full.at,
          `${listOf(names)} ${needs} ${countOf(full.total, what)} out at once when ${it} full, but ${organization} has only ${have}, so ${it} ${full.total - have} short`,
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
      for (const plan of new Set(list.map((b) => b.row.plan_id))) {
        this.ctx.warn(
          "position_double_booked",
          `${names.get(key) ?? key} coaches ${clash[0].row.name} and ${clash[1].row.name} at the same time` +
            (hours > 0 ? `, so another coach is needed for ${round2(hours)} hours` : ""),
          key,
          { plan_id: plan, date },
        );
      }
    }
    return result;
  }

  /** Costs every block's staff and boats, and checks them against the limits. */
  run(scheduled: ScheduledActivity[]): {
    activities: ComputedActivity[];
    coaching: SalariedCoaching[];
    doubleBooked: Map<Id, DoubleBooked>;
    /** The most sailors each offering id's blocks can take. */
    holds: Map<Id, number>;
  } {
    const { ctx } = this;
    const blocks = this.blocks(scheduled);
    this.checkUnallocated(scheduled, blocks);
    const programs = this.programs();
    const holds = new Map<Id, number>();
    // By date, so a warning given once names the first date it's seen on.
    for (const block of byDate(blocks)) this.checkCapacity(block, programs, holds);
    this.checkInventory(byDate(blocks), programs);
    const doubleBooked = this.checkDoubleBooked([...blocks.values()]);

    const coaching: SalariedCoaching[] = [];
    const rates = new Map(ctx.data.plan_staff_levels.map((l) => [l.staff_level_id, l.hourly_rate_cents]));
    const positions = new Map(ctx.data.plan_salaried_positions.map((p) => [p.key, p]));
    const boatClasses = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    const boatRates = new Map(ctx.data.plan_boat_rates.map((r) => [r.boat_class_id, r]));
    const given = new Map<ScheduledActivity, { coaches: number; boats: number }>();

    for (const block of byDate(blocks)) {
      const scope = { plan_id: block.row.plan_id, date: block.row.date };
      const paidHours = block.paid_minutes / 60;
      const waterHours = block.on_water_minutes / 60;

      const book = (type: CostType, amount: number, line: string, name: string, explanation: string): void =>
        this.book(block, ctx.costAccount(type), amount, line, name, explanation, 1, type === "coach_wages");

      let wages = 0;
      for (const s of block.staff) {
        if (s.count <= 0) continue;
        if (s.position_key != null) {
          const position = positions.get(s.position_key);
          if (s.pay === "hourly") {
            const hours = s.count * paidHours;
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
            const hours = s.count * paidHours;
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
        const rate = s.staff_level_id == null ? undefined : rates.get(s.staff_level_id);
        if (rate === undefined) {
          this.warnOnce(
            "unknown_staff_level",
            `${block.row.name} has staff at a staff level with no rate in the Operations Plan, so they cost nothing`,
            s.staff_level_id ?? s.key,
            scope,
          );
          continue;
        }
        wages += s.count * paidHours * rate;
      }
      book("coach_wages", wages, "coach_wages", "Coach wages", "Staff × paid hours × each one's hourly rate");

      for (const b of block.boats) {
        const rate = boatRates.get(b.boat_class_id);
        if (rate === undefined || b.count <= 0 || waterHours <= 0) continue;
        const boatClass = boatClasses.get(b.boat_class_id);
        this.book(
          block,
          boatClass?.account_id ?? ctx.costAccount("boat_maintenance"),
          b.count * waterHours * (rate.maintenance_per_boat_hour_cents + (rate.fuel_per_hour_cents ?? 0)),
          `boats:${b.boat_class_id}`,
          `Boats: ${boatClass?.name ?? "boats"}`,
          "The organization's boats × on-water hours × the class's fuel and upkeep",
        );
      }

      const coaches = sum(block.staff.map((s) => s.count));
      const boats = sum(block.boats.map((b) => b.count + (b.chartered ?? 0)));
      for (const [a, share] of block.shares) {
        given.set(a, { coaches: coaches * share, boats: boats * share });
      }
    }

    this.bookCharters(byDate(blocks));

    this.bookTrips(blocks, scheduled);

    return {
      coaching,
      doubleBooked,
      holds,
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
      if (offering === undefined) continue;
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
          { plan_id: trip.plan_id, ...(first !== undefined && { date: first }) },
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

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
