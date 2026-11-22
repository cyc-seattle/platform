import type { Context, WarningScope } from "./context.ts";
import type { ScheduledActivity } from "./activities.ts";
import type {
  Asset,
  ComputedActivity,
  DateString,
  Id,
  PlanActivityBlock,
  PlanBlockBoats,
  PlanBlockStaff,
  PlanOffering,
  PlanProgram,
  WarningSeverity,
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
function offeringsOf(ctx: Context, block: Block): string {
  return listOf([...new Set(block.members.map((a) => ctx.offeringName(a.offering)))]);
}

/** The offerings a block holds, other than on a travel day, each once. */
function offeringsIn(block: Block): PlanOffering[] {
  return [
    ...new Map(block.members.filter((a) => a.kind !== "travel").map((a) => [a.offering.id, a.offering])).values(),
  ];
}

/** Whether the organization has the asset on `date`. */
function hasOn(asset: Asset, date: DateString): boolean {
  return (
    (asset.acquired_on == null || asset.acquired_on <= date) && (asset.disposed_on == null || date < asset.disposed_on)
  );
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
          `${this.ctx.offeringName(a.offering)}'s ${a.kind} is in a missing block.`,
          a.stored.key,
        );
        continue;
      }
      if (row.date !== a.date) {
        this.ctx.warn(
          "block_date_mismatch",
          `${this.ctx.offeringName(a.offering)}'s ${a.kind} is in ${row.name}, on ${dayOf(row.date)}.`,
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

  /** Each program's settings, by its product. */
  private programs(): Map<Id, PlanProgram> {
    return new Map(this.ctx.data.plan_programs.map((p) => [p.product_id, p]));
  }

  /**
   * Records the most sailors of each offering the block's seats take with every other offering full.
   * Coaches don't limit it, since more can always be hired. Seats count the boats sailors bring.
   */
  private checkCapacity(block: Block, holds: Map<Id, number>): void {
    const { ctx } = this;
    const offerings = offeringsIn(block);
    const most = (o: PlanOffering) => ctx.maxEnrollment.get(o.id) ?? 0;
    const sailors = sum(offerings.map(most));
    const warns = sailors > 0;
    const scope = { plan_id: block.row.plan_id, date: block.row.date };

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
              `Add ${classes.get(b.boat_class_id)?.name ?? b.boat_class_id}'s max capacity to check there are enough.`,
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
    if (!sails) return;
    for (const o of offerings) {
      const n = seats - (sailors - most(o));
      holds.set(o.id, Math.min(holds.get(o.id) ?? Infinity, Math.max(0, n)));
    }
  }

  /** How many boats of each class the organization has on `date`. */
  private ownedOn(date: DateString): Map<Id, number> {
    const assets = new Map(this.ctx.data.assets.map((a) => [a.id, a]));
    const result = new Map<Id, number>();
    for (const b of this.ctx.data.boats) {
      const asset = assets.get(b.asset_id);
      if (asset !== undefined && hasOn(asset, date))
        result.set(b.boat_class_id, (result.get(b.boat_class_id) ?? 0) + 1);
    }
    return result;
  }

  /**
   * The boats of each class a block that sails would need of the organization's own for `most` of
   * each offering's sailors: every offering full, or the sailors expected. Its sailboats are what
   * it's given, and more of one class if their seats, with the boats sailors bring, are too few, and
   * it needs a coach boat for each coach its programs need, the extra ones of the coach boat class
   * it's given most of. Charters stay as given.
   */
  private ownedFor(block: Block, programs: Map<Id, PlanProgram>, most: (o: PlanOffering) => number): Map<Id, number> {
    const result = new Map<Id, number>();
    if (!block.members.some((a) => a.uses_boats)) return result;
    const { ctx } = this;
    const offerings = offeringsIn(block);
    const capacity = new Map(ctx.data.boat_classes.map((c) => [c.id, c.max_capacity]));
    const given = (b: PlanBlockBoats) => b.count + (b.chartered ?? 0);
    const sailboats = block.boats.filter((b) => (capacity.get(b.boat_class_id) ?? 0) > 0);
    const coachBoats = block.boats.filter((b) => capacity.get(b.boat_class_id) === 0);

    const seats = (n: (b: PlanBlockBoats) => number) =>
      sum(sailboats.map((b) => n(b) * capacity.get(b.boat_class_id)!));
    for (const b of sailboats) result.set(b.boat_class_id, (result.get(b.boat_class_id) ?? 0) + b.count);
    // The seats it's short, in whatever classes it's given, come in the fewest more boats: of the class
    // that seats the most, of those, the one it's given most of (cyc-seattle/platform#313), then the
    // one the organization has most of that day. The class's id settles the rest, so the rows' order can't.
    const short = sum(offerings.map(most)) - seats((b) => b.sailor_owned ?? 0) - seats(given);
    const perBoat = (b: PlanBlockBoats) => capacity.get(b.boat_class_id)!;
    const owned = this.ownedOn(block.row.date);
    const rank = (b: PlanBlockBoats) => [perBoat(b), given(b), owned.get(b.boat_class_id) ?? 0];
    const before = (x: PlanBlockBoats, b: PlanBlockBoats) => {
      const [rx, rb] = [rank(x), rank(b)];
      const i = rx.findIndex((n, j) => n !== rb[j]);
      return i >= 0 ? rx[i]! > rb[i]! : x.boat_class_id <= b.boat_class_id;
    };
    const roomiest = sailboats
      .filter((b) => given(b) > 0)
      .reduce<PlanBlockBoats | undefined>((x, b) => (x && before(x, b) ? x : b), undefined);
    if (short > 0 && roomiest !== undefined) {
      const id = roomiest.boat_class_id;
      result.set(id, result.get(id)! + Math.ceil(short / perBoat(roomiest) - 1e-9));
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
    paidHours = 0,
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
        paid_hours: paidHours * share,
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
              `${block.row.name} charters ${pluralOf(name)}, which have no charter rate. They cost nothing.`,
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
   * full (cyc-seattle/platform#294): an error when it hasn't enough even for the sailors expected
   * (cyc-seattle/platform#313). Every class that seats no sailors is a coach boat, and any coach
   * boat can stand in for another, so they're counted together. A sailboat class that runs short
   * is covered by spare boats of the other classes every program in the block can sail
   * (cyc-seattle/platform#313). Boats it charters, or sailors bring, don't count. A class it has
   * none of that day is only chartered, and more can be.
   */
  private checkInventory(blocks: Block[], programs: Map<Id, PlanProgram>): void {
    const { ctx } = this;
    const dates = groupBy(blocks, (b) => b.row.date);
    const classes = new Map(ctx.data.boat_classes.map((c) => [c.id, c]));
    const COACH_BOATS = "coach boats";
    // What a class is counted as: itself, or every coach boat together.
    const kindOf = (id: Id) => (classes.get(id)?.max_capacity === 0 ? COACH_BOATS : id);
    const nameOf = (kind: string) => (kind === COACH_BOATS ? "coach boat" : (classes.get(kind)?.name ?? kind));
    const countIn = (n: number, kind: string) =>
      kind === COACH_BOATS ? `${n} coach boat${n === 1 ? "" : "s"}` : countOf(n, nameOf(kind));
    const assets = new Map(ctx.data.assets.map((a) => [a.id, a]));
    const boats = ctx.data.boats.flatMap((b) => {
      const asset = assets.get(b.asset_id);
      return asset === undefined ? [] : [{ asset, kind: kindOf(b.boat_class_id) }];
    });
    const byKind = (owned: Map<Id, number>) => {
      const result = new Map<string, number>();
      for (const [id, n] of owned) result.set(kindOf(id), (result.get(kindOf(id)) ?? 0) + n);
      return result;
    };
    const atMax = new Map(
      blocks.map((b) => [b, byKind(this.ownedFor(b, programs, (o) => ctx.maxEnrollment.get(o.id) ?? 0))]),
    );
    const expected = new Map(
      blocks.map((b) => [b, byKind(this.ownedFor(b, programs, (o) => ctx.enrollment.get(o.id) ?? 0))]),
    );
    const organization = ctx.data.organization.name;
    const sails = new Map<Id, Set<Id>>();
    const productOf = new Map((ctx.data.programs ?? []).map((p) => [p.id, p.product_id]));
    for (const row of ctx.data.program_boat_classes ?? []) {
      const product = productOf.get(row.program_id);
      if (product == null) continue;
      sails.set(product, (sails.get(product) ?? new Set()).add(row.boat_class_id));
    }
    // The classes that can stand in for `kind` on a block: those every program in it can sail.
    const standIns = (block: Block, kind: string): Id[] => {
      const lists = offeringsIn(block).map((o) => sails.get(o.product_id));
      if (lists.length === 0 || lists.some((l) => l === undefined)) return [];
      return [...lists[0]!].filter(
        (id) => id !== kind && (classes.get(id)?.max_capacity ?? 0) > 0 && lists.every((l) => l!.has(id)),
      );
    };
    for (const [date, list] of dates) {
      const has = (a: Asset) => hasOn(a, date);
      const peakOf = (used: (b: Block) => number) =>
        mostAtOnce(list.flatMap((b) => (used(b) > 0 ? [{ block: b, n: used(b) }] : [])));
      const haveOf = (kind: string) => boats.filter((b) => b.kind === kind && has(b.asset)).length;
      // Boats each check has already borrowed from a class on this date, so none is lent twice.
      const lent = new Map<string, Map<string, number>>();
      /**
       * Whether spare boats of the classes that can stand in seat the `short` boats of `kind` that
       * the blocks `at` use. A class's spare boats are those the organization has that day, less the
       * most of them `used` at once that day. A block lends out no more seats than its own boats take.
       */
      const covered = (
        kind: string,
        short: number,
        at: { block: Block; n: number }[],
        used: (b: Block, kind: string) => number,
        check: string,
      ) => {
        const perBoat = classes.get(kind)?.max_capacity ?? 0;
        if (kind === COACH_BOATS || perBoat <= 0) return false;
        const done = lent.get(check) ?? new Map<string, number>();
        const borrowed = new Map<string, number>();
        let seats = short * perBoat;
        for (const { block, n } of at) {
          let own = n * perBoat;
          for (const id of standIns(block, kind)) {
            if (seats <= 0 || own <= 0) break;
            const takes = classes.get(id)!.max_capacity!;
            const spare = haveOf(id) - peakOf((b) => used(b, id)).total - (done.get(id) ?? 0) - (borrowed.get(id) ?? 0);
            const n = Math.min(spare, Math.ceil(Math.min(seats, own) / takes));
            if (n <= 0) continue;
            borrowed.set(id, (borrowed.get(id) ?? 0) + n);
            seats -= n * takes;
            own -= n * takes;
          }
        }
        if (seats > 0) return false;
        for (const [id, n] of borrowed) done.set(id, (done.get(id) ?? 0) + n);
        lent.set(check, done);
        return true;
      };
      const given = (b: Block, kind: string) =>
        sum(b.boats.filter((x) => kindOf(x.boat_class_id) === kind).map((x) => x.count));
      const warn = (
        code: string,
        what: string,
        at: { block: Block }[],
        message: string,
        severity: WarningSeverity = "warning",
      ) => {
        for (const plan of new Set(at.map(({ block }) => block.row.plan_id))) {
          ctx.warn(code, message, what, { plan_id: plan, date: date as DateString, severity });
        }
      };
      const kinds = new Set(
        list.flatMap((b) => [...b.boats.map((x) => kindOf(x.boat_class_id)), ...atMax.get(b)!.keys()]),
      );
      for (const kind of kinds) {
        const what = nameOf(kind);
        const have = haveOf(kind);
        const out = peakOf((b) => given(b, kind));
        if (out.total > have && !covered(kind, out.total - have, out.at, given, "given")) {
          const count = countIn(out.total, kind);
          warn(
            "over_inventory_boats",
            what,
            out.at,
            out.at.length === 1
              ? `${count} out for ${offeringsOf(ctx, out.at[0]!.block)}. ${organization} has ${have}.`
              : `${count} out: ${listOf(out.at.map(({ block, n }) => `${n} for ${offeringsOf(ctx, block)}`))}. ${organization} has ${have}.`,
          );
          continue;
        }
        if (have === 0) continue;
        const short = (
          need: Map<Block, Map<string, number>>,
          when: string,
          severity: WarningSeverity,
          check: string,
        ) => {
          const peak = peakOf((b) => need.get(b)!.get(kind) ?? 0);
          if (peak.total <= have) return false;
          if (covered(kind, peak.total - have, peak.at, (b, id) => need.get(b)!.get(id) ?? 0, check)) return false;
          const names = [
            ...new Set(peak.at.flatMap(({ block }) => block.members.map((a) => ctx.offeringName(a.offering)))),
          ];
          const needs = names.length === 1 ? "needs" : "need";
          warn(
            "short_of_boats",
            what,
            peak.at,
            `${listOf(names)} ${needs} ${countIn(peak.total, kind)}${when}. ${organization} has ${have}.`,
            severity,
          );
          return true;
        };
        if (!short(expected, "", "error", "expected")) short(atMax, " when full", "warning", "max");
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
          `${names.get(key) ?? key} is on ${clash[0].row.name} and ${clash[1].row.name} at once` +
            (hours > 0 ? ` for ${round2(hours)} hours.` : "."),
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
    const programs = this.programs();
    const holds = new Map<Id, number>();
    // By date, so a warning given once names the first date it's seen on.
    for (const block of byDate(blocks)) this.checkCapacity(block, holds);
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

      let wages = 0;
      // The hours paid at more than $0, which a payroll tax by the hour is charged on.
      let paid = 0;
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
                `${position.name} has no hourly coaching rate, so its hours cost nothing.`,
                position.key,
                scope,
              );
            }
            wages += hours * (rate ?? 0);
            if ((rate ?? 0) > 0) paid += hours;
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
            `${block.row.name}'s staff level has no rate, so they cost nothing.`,
            s.staff_level_id ?? s.key,
            scope,
          );
          continue;
        }
        wages += s.count * paidHours * rate;
        if (rate > 0) paid += s.count * paidHours;
      }
      this.book(
        block,
        ctx.costAccount("coach_wages"),
        wages,
        "coach_wages",
        "Coach wages",
        "Staff × paid hours × each one's hourly rate",
        1,
        true,
        paid,
      );

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
          `${trip.name} has no staff on its travel days, so no coach airfare or lodging.`,
          trip.key,
          { plan_id: trip.plan_id, ...(first !== undefined && { date: first }) },
        );
      }
      const lodging = ctx.rates?.lodging_per_night_cents ?? null;
      const mileage = ctx.rates?.mileage_rate_cents ?? null;
      if ((trip.nights ?? 0) > 0 && lodging === null) {
        this.warnOnce("no_rate", "Trips have nights, but no lodging rate.", "lodging_per_night_cents");
      }
      if ((trip.miles ?? 0) > 0 && mileage === null) {
        this.warnOnce("no_rate", "Trips have miles, but no mileage rate.", "mileage_rate_cents");
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
