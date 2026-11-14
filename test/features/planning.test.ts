import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, parameter, pattern, Step, theirSession } from "./steps/index.ts";
import type { CostLine } from "../../src/planning/index.ts";
import { cents, financialPlanResults, PnlPlan, share } from "./pnl.ts";
import { userFor } from "./steps/logins.ts";
import {
  admin,
  adminCreate,
  copied,
  created,
  change,
  itemPath,
  type Item,
  PLAN_ROWS,
  PLAN_YEAR,
  planRows,
  row,
  runId,
  type Row,
} from "./steps/rows.ts";

// The P&L examples' plans, made fresh for each one.
let p = new PnlPlan();
onEachScenario(() => {
  p = new PnlPlan();
});
const first = () => p.offerings[0]!["key"];
const second = () => p.offerings[1]!["key"];
const onOffering = (key: unknown, account: string) => (l: CostLine) =>
  l.cost_center_type === "offering" && l.cost_center_key === key && l.account_id === account;

Step("a Program Plan", () => p.area());
Step("an offering in it of a program from another program area", async () => {
  const [mine] = p.areas;
  const other = await p.area();
  await p.offering(p.areaVersion(mine!), await p.product("program", other), 10_000, 1);
});
Step("a planner calculates the P&L", () => p.calculate());
Step("the planner is warned that the offering is in the wrong plan", () => {
  expect(p.warned("offering_in_wrong_plan")).toBe(true);
});

Step("the Operations Plan sells {money} of merchandise", async (_, money: string) => {
  await p.offering(await p.operationsVersion(), await p.product("merchandise", null), cents(money), 1);
});
Step("the organization's totals include {money} of merchandise sales", async (_, money: string) => {
  const merchandise = await p.account("merchandise");
  expect(p.total((l) => l.account_id === merchandise)).toBe(cents(money));
  expect(p.out.organization.operating.revenue_cents).toBeGreaterThanOrEqual(cents(money));
});

Step("a program with no program area", () => p.product("program", null));
Step("a plan with an offering of that program", async () => {
  const area = await p.area();
  await p.offering(p.areaVersion(area), p.products.at(-1)!, 10_000, 1);
});
Step("the planner is warned that the program has no program area", () => {
  expect(p.warned("program_without_area")).toBe(true);
});

// The plan is for PLAN_YEAR, 2027, and the winter starts the December before it.
let winter: Item | undefined;
Step(
  "a winter offering in the 2027 plan, from December 2026 to March 2027, that takes in {money}",
  async (_, money: string) => {
    const area = await p.area();
    winter = await p.offering(p.areaVersion(area), await p.product("program", area), cents(money), 1, 0, {
      starts_on: `${PLAN_YEAR - 1}-12-07`,
      ends_on: `${PLAN_YEAR}-03-28`,
    });
  },
);
Step(
  "a practice on December 7, 2026 from {times}, in a block with {count} coaches paid {money} an hour",
  async (_, times: string, count: string, money: string) => {
    await blockOf([winter!], times, await coachesPaid(count, money), `${PLAN_YEAR - 1}-12-07`);
  },
);
Step("the offering takes in {money}", (_, money: string) => {
  const pnl = p.out.pnl.find((x) => x.level === "offering" && x.key === first());
  expect(pnl?.revenue_cents).toBe(cents(money));
});

/** A program area with two programs, each with one offering. */
async function twoOfferings(price: number, costs: [number, number]): Promise<string> {
  const area = await p.area();
  for (const cost of costs) {
    await p.offering(p.areaVersion(area), await p.product("program", area), price, 1, cost);
  }
  return area;
}

Step("a program area with two offerings that each take in {money}", (_, money: string) =>
  twoOfferings(cents(money), [0, 0]),
);
Step("{money} of storage charged to the program area", async (_, money: string) => {
  const area = p.areas[0]!;
  await p.line(
    p.areaVersion(area),
    "storage",
    { cost_center_type: "program_area", cost_center_key: area },
    cents(money),
    {
      excluded_from_mtdc: true,
    },
  );
});
Step("the program area takes in {money}", (_, money: string) => {
  const pnl = p.out.pnl.find((x) => x.level === "program_area" && x.key === p.areas[0]);
  expect(pnl?.revenue_cents).toBe(cents(money));
});
Step("its costs include the {money} of storage", async (_, money: string) => {
  const storage = await p.account("storage");
  const pnl = p.out.pnl.find((x) => x.level === "program_area" && x.key === p.areas[0]);
  expect(pnl?.by_account.find((a) => a.account_id === storage)?.amount_cents).toBe(cents(money));
});
Step("a program area with two offerings, the first with twice the direct costs of the second", () =>
  twoOfferings(10_000, [200_000, 100_000]),
);
Step("the first offering pays {money} of the storage", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("storage")))).toBe(cents(money));
});
Step("the second offering pays {money} of the storage", async (_, money: string) => {
  expect(p.total(onOffering(second(), await p.account("storage")))).toBe(cents(money));
});
Step("a program area with two offerings with the same direct costs", () => twoOfferings(10_000, [100_000, 100_000]));
Step(
  "a salaried director paid {money} an hour, with {count} hours charged to the program area",
  async (_, money: string, hours: string) => {
    const version = await p.operationsVersion();
    const position = await adminCreate("plan_salaried_positions", {
      id: randomUUID(),
      version_id: version,
      key: randomUUID(),
      name: "Director",
      annual_salary_cents: cents(money) * 2080,
      paid_hours_per_year: 2080,
    });
    await adminCreate("plan_salaried_bookings", {
      id: randomUUID(),
      version_id: version,
      key: randomUUID(),
      position_id: position.id,
      program_area_id: p.areas[0],
      kind: "management",
      hours: Number(hours),
    });
  },
);
Step("each offering pays {money} of the director's salary", async (_, money: string) => {
  const salaries = await p.account("salaries");
  for (const key of [first(), second()]) {
    expect(p.total((l) => onOffering(key, salaries)(l) && l.line_key.endsWith(":management"))).toBe(cents(money));
  }
});

Step("the Operations Plan sets scholarships at {percent} of programs' revenue", (_, percent: string) =>
  p.charge("Scholarships", share(percent), "scholarships", ["program"], true),
);
Step(
  "an offering of a program at {money} a sailor, with {count} sailors",
  async (_, money: string, sailors: string) => {
    const area = await p.area();
    await p.offering(p.areaVersion(area), await p.product("program", area), cents(money), Number(sailors));
  },
);
Step("the offering's scholarships are {money}", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("scholarships")))).toBe(cents(money));
});
Step("the merchandise has no scholarships", async () => {
  expect(p.total(onOffering(first(), await p.account("scholarships")))).toBe(0);
});

const EVERY_KIND = ["program", "charter", "storage_lease", "merchandise", "event_hosting", "other"];
Step("the Operations Plan collects card fees from families at {percent} of revenue", (_, percent: string) =>
  p.charge("Card fees collected", share(percent), "cardFeesCollected", EVERY_KIND, false),
);
Step("the Operations Plan pays card fees at {percent} of revenue", (_, percent: string) =>
  p.charge("Card fees", share(percent), "cardFees", EVERY_KIND, false),
);
Step("an offering of a program that takes in {money}", async (_, money: string) => {
  const area = await p.area();
  await p.offering(p.areaVersion(area), await p.product("program", area), cents(money), 1);
});
Step("the offering takes in {money} of card fees from families", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("cardFeesCollected")))).toBe(cents(money));
});
Step("the offering pays {money} of card fees", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("cardFees")))).toBe(cents(money));
});

// The second offering is free, so only the first has scholarships.
Step("two offerings with the same direct costs", async () => {
  const area = await p.area();
  await p.offering(p.areaVersion(area), await p.product("program", area), 1_000_000, 1, 100_000);
  await p.offering(p.areaVersion(area), await p.product("program", area), 0, 1, 100_000);
});
Step("scholarships on the first offering only, which don't count toward the split", () =>
  p.charge("Scholarships", 0.02, "scholarships", ["program"], true),
);
Step("{money} of office costs shared by every offering", async (_, money: string) => {
  await p.line(
    await p.operationsVersion(),
    "office",
    { cost_center_type: "pool", cost_center_key: await p.pool() },
    cents(money),
  );
});
Step("each offering pays {money} of the office costs", async (_, money: string) => {
  const office = await p.account("office");
  for (const key of [first(), second()]) expect(p.total(onOffering(key, office))).toBe(cents(money));
});

Step("the Operations Plan buys a {money} coach boat", async (_, money: string) => {
  await p.line(await p.operationsVersion(), "coachBoats", { cost_center_type: "org" }, cents(money));
});
Step("no offering or program area pays for the coach boat", async () => {
  const boats = await p.account("coachBoats");
  expect(p.total((l) => l.account_id === boats && l.cost_center_type !== "org")).toBe(0);
});
Step("the organization's totals show {money} of capital", (_, money: string) => {
  expect(p.out.organization.capital_cents).toBe(cents(money));
});
Step("a {money} coach boat charged to a program area", async (_, money: string) => {
  const area = await twoOfferings(10_000, [100_000, 100_000]);
  await p.line(
    p.areaVersion(area),
    "coachBoats",
    { cost_center_type: "program_area", cost_center_key: area },
    cents(money),
  );
});
Step("the program area doesn't pay for the coach boat", async () => {
  const boats = await p.account("coachBoats");
  const pnl = p.out.pnl.find((x) => x.level === "program_area" && x.key === p.areas[0]);
  expect(pnl?.by_account.some((a) => a.account_id === boats)).toBe(false);
  expect(p.total((l) => l.account_id === boats && l.cost_center_type !== "org")).toBe(0);
});
Step("the planner is warned that capital can't be charged to a program area", () => {
  expect(p.warned("capital_off_org")).toBe(true);
});

Step("programs that take in {money} and cost {money}", async (_, revenue: string, costs: string) => {
  const area = await p.area();
  await p.offering(p.areaVersion(area), await p.product("program", area), cents(revenue), 1, cents(costs));
});
Step("donations of {money}, which cost {money} to raise", async (_, raised: string, cost: string) => {
  const version = await p.operationsVersion();
  await p.line(version, "donations", { cost_center_type: "org" }, cents(raised));
  await p.line(version, "costs", { cost_center_type: "org" }, cents(cost), { function: "fundraising" });
});
Step("the organization's totals are:", (_, table: { line: string; amount: string }[]) => {
  const { operating, fundraising, capital_cents, total_cents } = p.out.organization;
  const shown: Record<string, number> = {
    "operating net": operating.net_cents,
    "fundraising net": fundraising.net_cents,
    capital: -capital_cents,
    total: total_cents,
  };
  for (const { line, amount } of table) expect(shown[line], line).toBe(cents(amount));
});

// Pay, bonuses, closed days, and saved P&Ls, which step 12c builds.
parameter("counted", ["after shared costs", "before shared costs"]);
pattern("times", /\d+(?:am|pm) to (?:noon|\d+(?:am|pm))/);
/** The first `weekday` (0 = Sunday) on or after `from`. */
function next(weekday: number, from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The director's bonus: who owns it, and in which version.
let earner: { owner: string; version: string; area: string } | undefined;
let position: string | undefined;
onEachScenario(() => {
  earner = undefined;
  position = undefined;
});
const bonusTotal = (prefix = "bonus:") => p.total((l) => l.line_key.startsWith(prefix));

/** A director in a new program area's plan, earning `rate` of the net of the products it's given. */
async function directorWithBonus(rate: number, extra: Row = {}): Promise<void> {
  const area = await p.area();
  const version = p.areaVersion(area);
  earner = { owner: await p.bonus(version, rate, [], extra), version, area };
}
/** A program of the director's area, which the bonus counts, with an offering. */
async function bonusProgram(price: number, costs: number, extra: Row = {}): Promise<Item> {
  const product = await p.product("program", earner!.area);
  await p.owns(earner!.owner, earner!.version, product);
  return p.offering(earner!.version, product, price, 1, costs, extra);
}

Step("a Program Plan that pays its director {percent} of its programs' net", (_, percent: string) =>
  directorWithBonus(share(percent)),
);
Step("its programs make {money} after their costs and shared costs", (_, money: string) =>
  bonusProgram(cents(money), 0),
);
Step("the director's bonus is {money}", (_, money: string) => {
  expect(bonusTotal()).toBe(cents(money));
});
Step("a Program Plan that pays its director a bonus on a program from another program area", async () => {
  await directorWithBonus(0.5);
  const other = await p.area();
  const product = await p.product("program", other);
  await p.offering(p.areaVersion(other), product, 1_000_000, 1);
  await p.owns(earner!.owner, earner!.version, product);
});
Step("the planner is warned that the bonus is on another program area's program", () => {
  expect(p.warned("bonus_outside_area")).toBe(true);
});
Step("the other area's program doesn't count toward the bonus", () => {
  expect(bonusTotal()).toBe(0);
});

const COUNTED: Record<string, Row> = {
  "after shared costs": { basis: "after_shared_costs" },
  "before shared costs": { basis: "before_shared_costs" },
};
Step("a director who earns {percent} of their programs' net {counted}", (_, percent: string, counted: string) =>
  directorWithBonus(share(percent), COUNTED[counted]),
);
Step(
  "their programs take in {money} and cost {money}, plus {money} of shared costs",
  async (_, revenue: string, costs: string, shared: string) => {
    await bonusProgram(cents(revenue), cents(costs));
    await p.line(
      await p.operationsVersion(),
      "office",
      { cost_center_type: "pool", cost_center_key: await p.pool() },
      cents(shared),
    );
  },
);
Step("payroll tax at {percent} of wages", (_, percent: string) =>
  p.operationsRow("plan_rates", { payroll_tax_rate: share(percent) }),
);
Step("a director whose bonus is {money}", async (_, money: string) => {
  await directorWithBonus(0.5);
  await bonusProgram(cents(money) * 2, 0);
});
Step("the organization pays {money} of payroll tax on the bonus", (_, money: string) => {
  expect(bonusTotal("bonus_payroll_tax:")).toBe(cents(money));
});
Step("a director's bonus, with its payroll tax, on the first offering only", async () => {
  await p.operationsRow("plan_rates", { payroll_tax_rate: 0.1 });
  const area = p.areas[0]!;
  await p.bonus(p.areaVersion(area), 0.5, [p.offerings[0]!["product_id"] as string]);
});

/** A salaried director in the Operations Plan. */
async function salaried(name: string, salary: number, hours: number): Promise<void> {
  position = await p.operationsRow("plan_salaried_positions", {
    name,
    annual_salary_cents: salary,
    paid_hours_per_year: hours,
  });
}
Step("a salaried director paid {money} an hour", (_, money: string) => salaried("Director", cents(money) * 2080, 2080));
Step("the offering pays {money} of the director's salary", async (_, money: string) => {
  const salaries = await p.account("salaries");
  expect(p.total((l) => onOffering(first(), salaries)(l) && l.line_key.endsWith(":coaching"))).toBe(cents(money));
});
Step("the offering pays {money} of coaches' wages", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("coachWages")))).toBe(cents(money));
});
Step("the offering pays none of the director's salary", async () => {
  expect(p.total(onOffering(first(), await p.account("salaries")))).toBe(0);
});
Step("a bonus for the director that comes to {money}", async (_, money: string) => {
  const area = p.areas[0]!;
  const product = await p.product("program", area);
  await p.offering(p.areaVersion(area), product, cents(money) * 2, 1);
  await p.bonus(p.areaVersion(area), 0.5, [product], { position_key: position });
});
Step("the director's pay for the year is:", (_, table: { pay: string; amount: string }[]) => {
  const pay = p.out.positions.find((x) => x.position_key === position)!;
  const shown: Record<string, number> = {
    salary: pay.salary_cents,
    "hourly coaching": pay.hourly_coaching_cents,
    bonus: pay.bonus_cents,
    total: pay.total_pay_cents,
  };
  for (const { pay: line, amount } of table) expect(shown[line], line).toBe(cents(amount));
});
Step("the planner isn't warned about the director", () => {
  expect(p.warned("position_double_booked")).toBe(false);
});

const laborDay = () => next(1, `${PLAN_YEAR}-09-01`);
Step("the Operations Plan lists Labor Day as a closed day", () =>
  p.operationsRow("plan_closed_dates", { date: laborDay(), name: "Labor Day" }),
);
Step("an offering with a practice on Labor Day", async () => {
  const area = await p.area();
  const offering = await p.offering(p.areaVersion(area), await p.product("program", area), 0, 1);
  await p.activities(offering, [laborDay()], "09:00", "12:00");
});
Step("the planner is warned that the practice is on a closed day", () => {
  expect(p.warned("closed_date")).toBe(true);
});

// A salaried coach's own hourly rate.
Step("a director on a {money} salary, who's paid {money} an hour to coach", async (_, salary: string, rate: string) => {
  position = await p.operationsRow("plan_salaried_positions", {
    name: "Director",
    annual_salary_cents: cents(salary),
    paid_hours_per_year: 2000,
    hourly_coaching_rate_cents: cents(rate),
  });
});

// Program settings, blocks, and what each block is given.
parameter("program", ["Guppies", "Minnows"]);
parameter("level", ["Level 1 Instructor", "Level 2 Instructor"]);
parameter("boats", ["Sailqubes", "Optis"]);
parameter("staff", ["one coach", "two coaches"]);
/** "4pm" or "noon" as `HH:MM`. */
function clock(time: string): string {
  if (time === "noon") return "12:00";
  const [, hour, half] = /^(\d+)(am|pm)$/.exec(time)!;
  const h = (Number(hour) % 12) + (half === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:00`;
}
const span = (times: string) => times.split(" to ").map(clock) as [string, string];
const JUNE = `${PLAN_YEAR}-06-01`;
const JULY_13 = `${PLAN_YEAR}-07-13`;
const AUGUST_2 = `${PLAN_YEAR}-08-02`;
const MORNING = "9am to noon";
const juneDays = (n: number) =>
  Array.from({ length: n }, (_, i) => `${PLAN_YEAR}-06-${String(i + 1).padStart(2, "0")}`);

/** The scenario's programs, staff levels, boat classes and RIBs, by the names the steps use. */
let programs: Record<string, string> = {};
let levels: Record<string, Item> = {};
let classes: Record<string, string> = {};
let ribs: string | undefined;
/** Offerings that share a block whose activities a later step adds, and the block. */
let pending: { offerings: Item[]; block: string } | undefined;
onEachScenario(() => {
  programs = {};
  levels = {};
  classes = {};
  ribs = undefined;
  pending = undefined;
});

/** The scenario's program area: every program and block in a scenario is in one Program Plan. */
const theArea = async () => p.areas[0] ?? (await p.area());
async function programNamed(name: string): Promise<string> {
  programs[name] ??= await p.product("program", await theArea());
  return programs[name];
}
/** A staff level in the Operations Plan, paid `rate` cents an hour. */
async function level(name: string, rate = 2000): Promise<Item> {
  levels[name] ??= await adminCreate("plan_staff_levels", {
    id: randomUUID(),
    version_id: await p.operationsVersion(),
    key: randomUUID(),
    name,
    pay_type: "hourly",
    hourly_rate_cents: rate,
  });
  return levels[name];
}
async function boatClass(name: string, sailors = name === "Optis" ? 1 : 2): Promise<string> {
  classes[name] ??= await p.boatClass(name, sailors);
  return classes[name];
}
/** The Operations Plan's RIBs, which cost `rate` cents an hour on the water, with `quantity` of them. */
async function theRibs(fields: Row = {}): Promise<string> {
  if (ribs === undefined) {
    ribs = await p.operationsRow("plan_resources", {
      resource_kind_id: await p.rib(),
      name: "RIBs",
      cost_per_hour_cents: 0,
      excluded_from_mtdc: false,
      ...fields,
    });
  }
  return ribs;
}
const staffAt = async (name: string, count: number, rate?: number) => ({
  staff_level_key: (await level(name, rate))["key"],
  count,
});

/** What a block is given. */
interface Given {
  staff?: Row[];
  resources?: Row[];
  boats?: Row[];
}
/** An offering of `program`, or of a new program, with `sailors` sailors. */
async function offeringOf(program: string | undefined, sailors: number): Promise<Item> {
  const area = await theArea();
  const product = program === undefined ? await p.product("program", area) : await programNamed(program);
  return p.offering(p.areaVersion(area), product, 0, sailors);
}
/** A block on `date` holding a practice of each offering at `times`, given `given`. Returns the block. */
async function blockOf(offerings: Item[], times: string, given: Given, date = JUNE, name = "A block"): Promise<string> {
  const version = offerings[0]!["version_id"] as string;
  const block = await p.block(version, date, name);
  for (const o of offerings) {
    // A practice with boats or RIBs is on the water.
    const sails = (given.boats ?? []).length > 0 || (given.resources ?? []).length > 0;
    await p.activities(o, [date], ...span(times), { block_id: block, uses_boats: sails });
  }
  for (const s of given.staff ?? []) await p.given("plan_block_staff", version, block, s);
  for (const r of given.resources ?? []) await p.given("plan_block_resources", version, block, r);
  for (const b of given.boats ?? []) await p.given("plan_block_boats", version, block, b);
  return block;
}
const coachesPaid = async (count: string, money: string) => ({
  staff: [await staffAt("Coach", Number(count), cents(money))],
});
/** Enough boats for `sailors`, two to a Sailqube. */
const enoughBoats = async (sailors: number) => [
  { boat_class_id: await boatClass("Sailqubes"), count: Math.ceil(sailors / 2) },
];

const wagesOf = async (offering: Item) => p.total(onOffering(offering["key"], await p.account("coachWages")));
const warning = (code: string) => p.out.warnings.find((w) => w.code === code);

Step("{program} have a coach for every {count} sailors", async (_, program: string, sailors: string) => {
  await p.programSettings(await theArea(), await programNamed(program), {
    staff_level_key: (await level("Coach"))["key"],
    sailors_per_coach: Number(sailors),
  });
});
Step(
  "{program} have a {level} for every {count} sailors",
  async (_, program: string, name: string, sailors: string) => {
    await p.programSettings(await theArea(), await programNamed(program), {
      staff_level_key: (await level(name))["key"],
      sailors_per_coach: Number(sailors),
    });
  },
);
Step(
  "Guppies have a coach for every {count} sailors, and Minnows a coach for every {count}",
  async (_, guppies: string, minnows: string) => {
    const coach = (await level("Coach"))["key"];
    for (const [program, sailors] of [
      ["Guppies", guppies],
      ["Minnows", minnows],
    ] as const) {
      await p.programSettings(await theArea(), await programNamed(program), {
        staff_level_key: coach,
        sailors_per_coach: Number(sailors),
      });
    }
  },
);
for (const text of ["{boats} take {count} sailor each", "{boats} take {count} sailors each"]) {
  Step(text, (_, boats: string, sailors: string) => boatClass(boats, Number(sailors)));
}
Step("{boats} that cost {money} an hour on the water in upkeep", async (_, boats: string, money: string) => {
  await p.operationsRow("plan_boat_rates", {
    boat_class_id: await boatClass(boats),
    maintenance_per_boat_hour_cents: cents(money),
  });
});
Step("RIBs that cost {money} an hour on the water", (_, money: string) =>
  theRibs({ cost_per_hour_cents: cents(money) }),
);
Step("the Operations Plan says the organization has {count} {boats}", async (_, count: string, boats: string) => {
  await p.operationsRow("plan_boat_rates", {
    boat_class_id: await boatClass(boats),
    maintenance_per_boat_hour_cents: 0,
    quantity: Number(count),
  });
});
Step("the Operations Plan says the organization has {count} RIBs", (_, count: string) =>
  theRibs({ quantity: Number(count) }),
);

// What the P&L costs.
Step(
  "an offering with a practice from {times}, in a block with {count} coaches paid {money} an hour",
  async (_, times: string, count: string, money: string) => {
    await blockOf([await offeringOf(undefined, 1)], times, await coachesPaid(count, money));
  },
);
Step(
  "an offering with a practice from {times}, in a block with {count} RIBs",
  async (_, times: string, count: string) => {
    await blockOf([await offeringOf(undefined, 1)], times, {
      resources: [{ resource_key: await theRibs(), quantity: Number(count) }],
    });
  },
);
Step(
  "an offering with a practice from {times}, in a block with {count} of the organization's {boats} and {count} {boats} that sailors bring",
  async (_, times: string, count: string, boats: string, owned: string) => {
    await blockOf([await offeringOf(undefined, 1)], times, {
      boats: [{ boat_class_id: await boatClass(boats), count: Number(count), sailor_owned: Number(owned) }],
    });
  },
);
Step(
  "a {program} offering of {count} sailors, with a practice from {times}, in a block with {count} coach paid {money} an hour",
  async (_, program: string, sailors: string, times: string, count: string, money: string) => {
    await blockOf([await offeringOf(program, Number(sailors))], times, await coachesPaid(count, money));
  },
);
Step(
  "two offerings, of {count} sailors and {count} sailors, in one block from {times} with {count} coach paid {money} an hour",
  async (_, first: string, second: string, times: string, count: string, money: string) => {
    const offerings = [await offeringOf(undefined, Number(first)), await offeringOf(undefined, Number(second))];
    await blockOf(offerings, times, await coachesPaid(count, money));
  },
);
Step("two offerings in one block with {count} coach paid {money} an hour", async (_, count: string, money: string) => {
  const offerings = [await offeringOf(undefined, 1), await offeringOf(undefined, 1)];
  const version = offerings[0]!["version_id"] as string;
  const block = await p.block(version, JUNE);
  await p.given("plan_block_staff", version, block, (await coachesPaid(count, money)).staff[0]!);
  pending = { offerings, block };
});
Step("one practices from {times} and the other from {times}", async (_, one: string, other: string) => {
  const { offerings, block } = pending!;
  await p.activities(offerings[0]!, [JUNE], ...span(one), { block_id: block });
  await p.activities(offerings[1]!, [JUNE], ...span(other), { block_id: block });
});
Step("the first offering pays {money} of coaches' wages", async (_, money: string) => {
  expect(await wagesOf(p.offerings[0]!)).toBe(cents(money));
});
Step("the second offering pays {money} of coaches' wages", async (_, money: string) => {
  expect(await wagesOf(p.offerings[1]!)).toBe(cents(money));
});
Step("the two offerings pay {money} of coaches' wages between them", async (_, money: string) => {
  expect((await wagesOf(p.offerings[0]!)) + (await wagesOf(p.offerings[1]!))).toBe(cents(money));
});
Step("the offering pays {money} for RIBs", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("ribs")))).toBe(cents(money));
});
Step("the offering pays {money} of boat upkeep", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("boatUpkeep")))).toBe(cents(money));
});
Step("the offering pays no coaches' wages", async () => {
  expect(await wagesOf(p.offerings[0]!)).toBe(0);
});

// Salaried coaches on blocks.
/** An offering with `practices` practices of `hours` hours in June, each in a block the director coaches. */
async function coachedBlocks(practices: number, hours: number, pay: "salary" | "hourly", extra: Row[] = []) {
  const offering = await offeringOf(undefined, 1);
  const version = offering["version_id"] as string;
  for (const date of juneDays(practices)) {
    const block = await p.block(version, date);
    await p.activities(offering, [date], "16:00", `${16 + hours}:00`, { block_id: block });
    await p.given("plan_block_staff", version, block, { position_key: position, count: 1, pay });
    for (const s of extra) await p.given("plan_block_staff", version, block, s);
  }
}
Step(
  "an offering with {count} practices of {count} hours, each in a block the director coaches",
  (_, practices: string, hours: string) => coachedBlocks(Number(practices), Number(hours), "salary"),
);
Step(
  "an offering with {count} practices of {count} hours, each in a block the director coaches by the hour",
  (_, practices: string, hours: string) => coachedBlocks(Number(practices), Number(hours), "hourly"),
);
Step(
  "an offering with {count} practices of {count} hours, each in a block the director coaches by the hour with a coach paid {money} an hour",
  async (_, practices: string, hours: string, money: string) =>
    coachedBlocks(Number(practices), Number(hours), "hourly", [await staffAt("Coach", 1, cents(money))]),
);
Step("a director on a {money} salary, with no hourly rate to coach", async (_, salary: string) => {
  position = await p.operationsRow("plan_salaried_positions", {
    name: "Director",
    annual_salary_cents: cents(salary),
    paid_hours_per_year: 2000,
  });
});
Step("the planner is warned that the director has no hourly rate to coach", () => {
  expect(p.warned("no_hourly_rate")).toBe(true);
});

/** Offerings the salaried director coaches, each in blocks of its own. */
let groups: Item[] = [];
async function directorsBlocks(count: number): Promise<void> {
  await salaried("Director", 6_000_000, 2000);
  groups = [];
  for (let i = 0; i < count; i++) groups.push(await offeringOf(undefined, 1));
}
const coachedBy = () => ({ staff: [{ position_key: position, count: 1 }] });
Step("a salaried director who coaches two blocks", () => directorsBlocks(2));
Step("a salaried director who coaches three blocks", () => directorsBlocks(3));
for (const text of [
  "both blocks run from {times} on the same day",
  "all three blocks run from {times} on the same day",
]) {
  Step(text, async (_, times: string) => {
    for (const group of groups) await blockOf([group], times, coachedBy());
  });
}
Step(
  "one block runs from {times} and the other from {times} on the same day",
  async (_, one: string, other: string) => {
    await blockOf([groups[0]!], one, coachedBy());
    await blockOf([groups[1]!], other, coachedBy());
  },
);
Step("the planner is warned that the director is coaching two blocks at once", () => {
  expect(p.warned("position_double_booked")).toBe(true);
});
Step("the director's blocks need {count} hours of another coach", (_, hours: string) => {
  expect(p.out.positions.find((x) => x.position_key === position)?.double_booked_hours).toBe(Number(hours));
});

// The organization's boats and RIBs.
Step(
  "a {program} block with {count} {boats} and a {program} block with {count}, both on the morning of July 13",
  async (_, one: string, n: string, boats: string, other: string, m: string) => {
    const id = await boatClass(boats);
    await blockOf(
      [await offeringOf(one, 1)],
      MORNING,
      { boats: [{ boat_class_id: id, count: Number(n) }] },
      JULY_13,
      one,
    );
    await blockOf(
      [await offeringOf(other, 1)],
      "9am to 11am",
      { boats: [{ boat_class_id: id, count: Number(m) }] },
      JULY_13,
      other,
    );
  },
);
Step(
  "a {program} block with {count} {boats} on the morning of July 13, and a {program} block with {count} that afternoon",
  async (_, one: string, n: string, boats: string, other: string, m: string) => {
    const id = await boatClass(boats);
    await blockOf(
      [await offeringOf(one, 1)],
      MORNING,
      { boats: [{ boat_class_id: id, count: Number(n) }] },
      JULY_13,
      one,
    );
    await blockOf(
      [await offeringOf(other, 1)],
      "1pm to 4pm",
      { boats: [{ boat_class_id: id, count: Number(m) }] },
      JULY_13,
      other,
    );
  },
);
Step(
  "a block with {count} of the organization's {boats} and {count} {boats} that sailors bring",
  async (_, count: string, boats: string, owned: string) => {
    await blockOf(
      [await offeringOf(undefined, 1)],
      MORNING,
      {
        boats: [{ boat_class_id: await boatClass(boats), count: Number(count), sailor_owned: Number(owned) }],
      },
      JULY_13,
    );
  },
);
Step(
  "the planner is warned that July 13 has {count} {boats} out, but the organization has {count}",
  (_, out: string, _boats: string, have: string) => {
    const found = warning("over_inventory_boats");
    expect(found).toMatchObject({ category: "allocation", date: JULY_13 });
    // The warning gives the date, so the message starts with the count, and names the organization.
    expect(found?.message).toMatch(new RegExp(`^${out} .+ out at once.*, but .+ has only ${have}`));
  },
);
Step("the planner isn't warned about {boats}", () => {
  expect(p.warned("over_inventory_boats")).toBe(false);
});
Step("two blocks on the morning of July 13, with {count} RIBs and {count} RIBs", async (_, n: string, m: string) => {
  const rib = await theRibs();
  await blockOf(
    [await offeringOf(undefined, 1)],
    MORNING,
    { resources: [{ resource_key: rib, quantity: Number(n) }] },
    JULY_13,
  );
  await blockOf(
    [await offeringOf(undefined, 1)],
    MORNING,
    { resources: [{ resource_key: rib, quantity: Number(m) }] },
    JULY_13,
  );
});
Step(
  "the planner is warned that July 13 has {count} RIBs out, but the organization has {count}",
  (_, out: string, have: string) => {
    const found = warning("over_inventory_resource");
    expect(found).toMatchObject({ category: "allocation", date: JULY_13 });
    expect(found?.message).toMatch(new RegExp(`^${out} RIBs out at once.*, but .+ has only ${have}`));
  },
);

// What a block's staff and boats can safely take.
Step(
  "a {program} block of {count} sailors with one {level} and enough boats",
  async (_, program: string, sailors: string, name: string) => {
    await blockOf([await offeringOf(program, Number(sailors))], MORNING, {
      staff: [await staffAt(name, 1)],
      boats: await enoughBoats(Number(sailors)),
    });
  },
);
Step(
  "a {program} block of {count} sailors that the director coaches, with enough boats",
  async (_, program: string, sailors: string) => {
    await blockOf([await offeringOf(program, Number(sailors))], MORNING, {
      staff: [{ position_key: position, count: 1 }],
      boats: await enoughBoats(Number(sailors)),
    });
  },
);
Step(
  "a block of {count} Guppies and {count} Minnows, with {staff} and enough boats",
  async (_, guppies: string, minnows: string, staff: string) => {
    const offerings = [await offeringOf("Guppies", Number(guppies)), await offeringOf("Minnows", Number(minnows))];
    await blockOf(offerings, MORNING, {
      staff: [await staffAt("Coach", staff === "two coaches" ? 2 : 1)],
      boats: await enoughBoats(Number(guppies) + Number(minnows)),
    });
  },
);
Step(
  "a {program} block of {count} sailors with enough staff and {count} {boats}",
  async (_, program: string, sailors: string, count: string, boats: string) => {
    await blockOf([await offeringOf(program, Number(sailors))], MORNING, {
      staff: [await staffAt("Coach", Number(sailors))],
      boats: [{ boat_class_id: await boatClass(boats), count: Number(count) }],
    });
  },
);
Step(
  "a block of {count} sailors with enough staff, {count} of the organization's {boats}, and {count} {boats} that sailors bring",
  async (_, sailors: string, count: string, boats: string, owned: string) => {
    await blockOf([await offeringOf(undefined, Number(sailors))], MORNING, {
      staff: [await staffAt("Coach", Number(sailors))],
      boats: [{ boat_class_id: await boatClass(boats), count: Number(count), sailor_owned: Number(owned) }],
    });
  },
);
// A block's warning starts with its offerings' names, then says what it has.
const overCapacity = (limit: "coach" | "boats") =>
  p.out.warnings.filter((w) => w.code === "over_capacity" && w.message.includes(limit));
const saysBlockHas = (limit: "coach" | "boats", text: string) =>
  expect(overCapacity(limit).map((w) => w.message.replace(/^.+? ha(s|ve) /, ""))).toContain(text);
Step(
  "the planner is warned that the block has {count} sailors, but enough coaches for only {count}",
  (_, sailors: string, can: string) => saysBlockHas("coach", `${sailors} sailors, but enough coaches for only ${can}`),
);
Step(
  "the planner is warned that the block has {count} sailors, but the boats hold only {count}",
  (_, sailors: string, can: string) => saysBlockHas("boats", `${sailors} sailors, but the boats hold only ${can}`),
);
Step("the planner is warned that the block has too few coaches", () => {
  expect(overCapacity("coach")).not.toEqual([]);
});
Step("the planner isn't warned about the block", () => {
  expect(p.warned("over_capacity")).toBe(false);
});

// Activities with no staff.
Step("an offering with a practice on August 2 that's in no block", async () => {
  await p.activities(await offeringOf(undefined, 1), [AUGUST_2], "09:00", "12:00");
});
Step("an offering with a practice on August 2, in a block with boats but no staff", async () => {
  await blockOf(
    [await offeringOf(undefined, 1)],
    MORNING,
    { boats: [{ boat_class_id: await boatClass("Optis"), count: 1 }] },
    AUGUST_2,
  );
});
Step("the planner is warned that the practice on August 2 has no staff", () => {
  expect(warning("unallocated_activity")).toMatchObject({ category: "allocation", date: AUGUST_2 });
});

// Readable result lines.
Step("{money} of office costs in a pool named {string}", async (_, money: string, name: string) => {
  const pool = await p.operationsRow("plan_pools", { name });
  await p.line(
    await p.operationsVersion(),
    "office",
    { cost_center_type: "pool", cost_center_key: pool },
    cents(money),
    { name: "Office" },
  );
});
// Financial Plans: each holds an Operations Plan and Program Plans, saved together.
const NEEDS_OPERATIONS = "A Financial Plan needs an Operations Plan before it's saved.";
const ONE_PER_AREA = "A Financial Plan holds one Operations Plan, and at most one Program Plan for each program area.";
const ONLY_SAVED_ACTIVE = "Only a saved Financial Plan can be marked active.";

/** The Financial Plans a scenario made, by name, and the one it's about. */
let named: Record<string, string> = {};
let financialPlan: string | undefined;
let started: string | undefined;
let attempt: { status: number; body: { errors?: { message: string }[] } } | undefined;
onEachScenario(() => {
  named = {};
  financialPlan = undefined;
  started = undefined;
  attempt = undefined;
});

/** Writes as "they", noting a row they made for cleanup, and keeps the answer in `attempt`. */
async function theyWrite(method: "POST" | "PATCH", path: string, data: Row): Promise<typeof attempt> {
  const { status, body } = await (await theirSession()).request(method, path, data);
  if (method === "POST" && status < 300) {
    created.push({ collection: path.split("/")[2]!, id: data["id"] });
  }
  attempt = { status, body };
  return attempt;
}
const expectOk = (answer: typeof attempt) => expect(answer?.status, JSON.stringify(answer?.body)).toBe(200);
const expectRefused = (answer: typeof attempt) => expect(answer?.status, JSON.stringify(answer?.body)).toBe(403);
const expectTold = (message: string) => {
  expect(attempt?.status, JSON.stringify(attempt?.body)).toBe(400);
  expect(attempt?.body.errors?.[0]?.message).toContain(message);
};

async function read(collection: string, filter: object, fields = "*"): Promise<Row[]> {
  const query = `filter=${encodeURIComponent(JSON.stringify(filter))}&fields=${fields}&limit=-1`;
  return (await admin()).ok("GET", `/items/${collection}?${query}`);
}
const one = async (collection: string, id: unknown, fields = "*"): Promise<Row> =>
  (await admin()).ok("GET", `${itemPath(collection, id)}?fields=${fields}`);

/** A new Financial Plan for the scenario's organization and year, as "they". */
async function theyStart(name: string, parent?: string): Promise<string> {
  const id = randomUUID();
  expectOk(
    await theyWrite("POST", "/items/version_sets", {
      id,
      organization_id: await p.organization(),
      fiscal_year: PLAN_YEAR,
      name,
      ...(parent && { parent_id: parent }),
    }),
  );
  return id;
}

/** A new Financial Plan started from `parent`, as the admin, once its plans are copied in. */
async function adminStart(name: string, parent: string): Promise<string> {
  const set = await adminCreate("version_sets", {
    id: randomUUID(),
    organization_id: await p.organization(),
    fiscal_year: PLAN_YEAR,
    name,
    status: "draft",
    parent_id: parent,
  });
  await copied(set.id);
  return set.id;
}

/** A Program Plan with one offering of `price` a sailor, and the offering. */
async function programWithOffering(price = 100_000, extra: Row = {}): Promise<{ area: string; offering: Item }> {
  const area = await p.area();
  const offering = await p.offering(p.areaVersion(area), await p.product("program", area), price, 10, 100_000, extra);
  return { area, offering };
}

/** The copy of `offering` in a Financial Plan started from the one that holds it. */
async function copyOf(offering: Item, set: string): Promise<Row> {
  const copies = (await copied(set)).map((m) => m["version_id"]);
  const [copy] = await read("plan_offerings", { version_id: { _in: copies }, key: { _eq: offering["key"] } });
  expect(copy, "the offering's copy").toBeDefined();
  return copy!;
}

/** The office costs an offering pays in a saved Financial Plan's results. */
async function officeIn(set: string, offering: unknown): Promise<number> {
  const office = await p.account("office");
  return (await financialPlanResults(set)).lines
    .filter((l) => l["account_id"] === office && l["cost_center_key"] === offering)
    .reduce((t, l) => t + Number(l["amount_cents"]), 0);
}

// What a Financial Plan holds.
Step("they start a Financial Plan for next year with only an Operations Plan", async () => {
  financialPlan = await theyStart(`Financial Plan ${runId}`);
  const plan = randomUUID();
  expectOk(
    await theyWrite("POST", "/items/plans", {
      id: plan,
      kind: "operations",
      organization_id: await p.organization(),
      fiscal_year: PLAN_YEAR,
      name: `Operations ${runId}`,
    }),
  );
  const copy = randomUUID();
  expectOk(await theyWrite("POST", "/items/plan_versions", { id: copy, plan_id: plan, status: "draft" }));
  expectOk(
    await theyWrite("POST", "/items/version_set_members", {
      id: randomUUID(),
      version_set_id: financialPlan,
      version_id: copy,
    }),
  );
});
Step("the Financial Plan is a draft, with the Operations Plan in it", async () => {
  expect(await one("version_sets", financialPlan, "status")).toMatchObject({ status: "draft" });
  const members = await read("version_set_members", { version_set_id: { _eq: financialPlan } }, "plan_id.kind");
  expect(members).toEqual([{ plan_id: { kind: "operations" } }]);
});
Step("a draft Financial Plan with a Program Plan but no Operations Plan", async () => {
  await p.area();
  financialPlan = await p.draftSet(undefined, { operations: false });
});
Step("they try to save the Financial Plan", async () => {
  await theyWrite("PATCH", itemPath("version_sets", financialPlan), { status: "saved" });
});
Step("they're told that the Financial Plan needs an Operations Plan", () => expectTold(NEEDS_OPERATIONS));
Step("the Financial Plan is still a draft", async () => {
  expect(await one("version_sets", financialPlan, "status")).toMatchObject({ status: "draft" });
});

Step("a draft Financial Plan with a Program Plan for Youth Racing", async () => {
  const area = await p.area();
  await (await admin()).ok("PATCH", itemPath("program_areas", area), { name: `Youth Racing ${runId}` });
  financialPlan = await p.draftSet();
});
Step("they try to add another Program Plan for Youth Racing to it", async () => {
  const copy = randomUUID();
  expectOk(
    await theyWrite("POST", "/items/plan_versions", { id: copy, plan_id: p.areaPlan(p.areas[0]!), status: "draft" }),
  );
  await theyWrite("POST", "/items/version_set_members", {
    id: randomUUID(),
    version_set_id: financialPlan,
    version_id: copy,
  });
});
Step("they're told that the Financial Plan already has a Program Plan for Youth Racing", () => {
  expectTold(ONE_PER_AREA);
  expect(attempt?.body.errors?.[0]?.message).toContain("Youth Racing");
});

// Saving a Financial Plan.
Step("a draft Financial Plan with an Operations Plan and two Program Plans", async () => {
  await p.area();
  await p.area();
  financialPlan = await p.draftSet();
});
Step("they save the Financial Plan", async () => {
  expectOk(await theyWrite("PATCH", itemPath("version_sets", financialPlan), { status: "saved" }));
});
Step("the Financial Plan and all three of its plans are saved at the same moment", async () => {
  const set = await one("version_sets", financialPlan, "status,saved_at");
  const copies = await read(
    "version_set_members",
    { version_set_id: { _eq: financialPlan } },
    "version_id.status,version_id.saved_at",
  );
  expect(copies).toHaveLength(3);
  for (const { version_id: copy } of copies as { version_id: Row }[]) {
    expect(copy).toEqual({ status: "saved", saved_at: set["saved_at"] });
  }
  expect(set["status"]).toBe("saved");
});

// Several drafts a year, and starting one from another.
Step("a draft Financial Plan for next year named {string}", async (_, name: string) => {
  named[name] = await p.draftSet(name);
});
Step("they start another draft Financial Plan for next year named {string}", async (_, name: string) => {
  named[name] = await theyStart(name);
});
Step("next year has both drafts", async () => {
  const drafts = await read(
    "version_sets",
    { organization_id: { _eq: await p.organization() }, fiscal_year: { _eq: PLAN_YEAR }, status: { _eq: "draft" } },
    "id",
  );
  expect(drafts.map((d) => d["id"]).sort()).toEqual(Object.values(named).sort());
});

let offering: Item | undefined;
onEachScenario(() => {
  offering = undefined;
});
Step(
  "a saved Financial Plan named {string} with an offering at {money} a sailor",
  async (_, name: string, money: string) => {
    offering = (await programWithOffering(cents(money))).offering;
    // A staff level in its Operations Plan, for a draft an AI starts from it.
    await level("Coach");
    named[name] = await p.savedSet(name);
  },
);
for (const text of [
  "they start a new Financial Plan from {string}",
  "they started a new Financial Plan from {string}",
]) {
  Step(text, async (_, name: string) => {
    started = await theyStart(`From ${name} ${runId}`, named[name]);
    await copied(started);
  });
}
Step("the new Financial Plan has the same offering at {money} a sailor", async (_, money: string) => {
  const copy = await copyOf(offering!, started!);
  expect(copy).toMatchObject({ key: offering!["key"], price_cents: cents(money) });
  expect(copy["id"]).not.toBe(offering!["id"]);
});
Step("its parent is {string}", async (_, name: string) => {
  expect(await one("version_sets", started, "parent_id")).toEqual({ parent_id: named[name] });
});
Step("they change the offering's price to {money} a sailor in the new Financial Plan", async (_, money: string) => {
  const copy = await copyOf(offering!, started!);
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", copy["id"]), { price_cents: cents(money) }));
});
Step("{string} still has the offering at {money} a sailor", async (_, _name: string, money: string) => {
  expect(await one("plan_offerings", offering!["id"], "price_cents")).toEqual({ price_cents: cents(money) });
});

// An offering's activities, in a Financial Plan started from it.
let practice: Item | undefined;
onEachScenario(() => {
  practice = undefined;
});
Step("a saved Financial Plan named {string} with a practice on June 6", async (_, name: string) => {
  ({ offering } = await programWithOffering());
  practice = await adminCreate("plan_activities", {
    id: randomUUID(),
    version_id: offering["version_id"],
    key: randomUUID(),
    offering_id: offering["id"],
    date: `${PLAN_YEAR}-06-06`,
    start_time: "09:00",
    end_time: "12:00",
    kind: "practice",
    uses_boats: true,
  });
  named[name] = await p.savedSet(name);
});
Step("its practice on June 6 is the same practice as the one in {string}", async () => {
  const copy = await copyOf(offering!, started!);
  const [activity] = await read("plan_activities", { offering_id: { _eq: copy["id"] } });
  expect(activity).toMatchObject({ key: practice!["key"], date: `${PLAN_YEAR}-06-06`, version_id: copy["version_id"] });
  expect(activity!["id"]).not.toBe(practice!["id"]);
});

// The active Financial Plan.
Step(
  "two saved Financial Plans for next year, {string} marked active and {string}",
  async (_, first: string, second: string) => {
    named[first] = await p.savedSet(first);
    // A plan copy is in one Financial Plan, so the second starts from the first.
    named[second] = await adminStart(second, named[first]!);
    await p.save(named[second]!);
    await (await admin()).ok("PATCH", itemPath("version_sets", named[first]), { status: "active" });
  },
);
Step("they mark {string} active", async (_, name: string) => {
  expectOk(await theyWrite("PATCH", itemPath("version_sets", named[name]), { status: "active" }));
});
Step("{string} is the active Financial Plan for next year", async (_, name: string) => {
  const active = await read(
    "version_sets",
    { organization_id: { _eq: await p.organization() }, fiscal_year: { _eq: PLAN_YEAR }, status: { _eq: "active" } },
    "id",
  );
  expect(active.map((set) => set["id"])).toEqual([named[name]]);
});
Step("{string} is saved, and no longer active", async (_, name: string) => {
  expect(await one("version_sets", named[name]!, "status")).toEqual({ status: "saved" });
});
Step("a draft Financial Plan", async () => {
  await p.area();
  financialPlan = await p.draftSet();
});
Step("they try to mark it active", async () => {
  await theyWrite("PATCH", itemPath("version_sets", financialPlan), { status: "active" });
});
Step("they're told that only a saved Financial Plan can be active", () => expectTold(ONLY_SAVED_ACTIVE));

// A saved Financial Plan never changes, apart from its name and note.
Step("a saved Financial Plan", async () => {
  ({ offering } = await programWithOffering());
  financialPlan = await p.savedSet();
});
Step("they can't change the Financial Plan or any of its plans", async () => {
  expectRefused(await theyWrite("PATCH", itemPath("version_sets", financialPlan), { platform_version: "0.0.0" }));
  expectRefused(await theyWrite("PATCH", itemPath("plan_versions", offering!["version_id"]), { message: "Changed" }));
  expectRefused(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { price_cents: 1 }));
});
Step("they can't turn the Financial Plan back into a draft", async () => {
  expectRefused(await theyWrite("PATCH", itemPath("version_sets", financialPlan), { status: "draft" }));
  expect(await one("version_sets", financialPlan, "status")).toEqual({ status: "saved" });
});
Step("they can't delete the Financial Plan", async () => {
  const { status } = await (await theirSession()).request("DELETE", itemPath("version_sets", financialPlan));
  expect(status).not.toBe(204);
  expect(await one("version_sets", financialPlan, "id")).toEqual({ id: financialPlan });
});
Step("they can change its note to {string}", async (_, note: string) => {
  expectOk(await theyWrite("PATCH", itemPath("version_sets", financialPlan), { message: note }));
  expect(await one("version_sets", financialPlan, "message")).toEqual({ message: note });
});
let savedTotals: Row | undefined;
Step("they can change its name to {string}", async (_, name: string) => {
  savedTotals = (await financialPlanResults(financialPlan!)).totals;
  expectOk(await theyWrite("PATCH", itemPath("version_sets", financialPlan), { name }));
  expect(await one("version_sets", financialPlan, "name")).toEqual({ name });
});
Step("its P&L stays the same", async () => {
  expect((await financialPlanResults(financialPlan!)).totals).toEqual(savedTotals);
});

// A Financial Plan's P&L.
Step("a draft Financial Plan with two Program Plans whose offerings have the same direct costs", async () => {
  await programWithOffering(0);
  await programWithOffering(0);
  financialPlan = await p.draftSet();
});
Step("each Program Plan's offering pays {money} of the office costs", async (_, money: string) => {
  const office = await p.account("office");
  for (const each of p.offerings) {
    expect(p.total(onOffering(each["key"], office))).toBe(cents(money));
  }
});
Step("a draft Financial Plan whose offering takes in {money}", async (_, money: string) => {
  const area = await p.area();
  offering = await p.offering(p.areaVersion(area), await p.product("program", area), cents(money), 1);
  financialPlan = await p.draftSet();
});
Step("they change the offering to take in {money}", async (_, money: string) => {
  // The offering has one sailor, so its price is what it takes in.
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { price_cents: cents(money) }));
});
Step("they see that the Financial Plan's P&L shows the offering takes in {money}", async (_, money: string) => {
  // Through the items API, as an AI does over Directus's MCP server, which can't run the engine. A
  // draft's P&L is worked out again a moment after each change, so this waits for the new one.
  const they = await theirSession();
  const filter = encodeURIComponent(
    JSON.stringify({ version_set_id: { _eq: financialPlan }, level: { _eq: "offering" } }),
  );
  const revenue = async () => {
    const { status, body } = await they.request("GET", `/items/plan_result_pnl?limit=-1&filter=${filter}`);
    expect(status).toBe(200);
    const rows = (body as { data: Row[] }).data;
    return Number(rows.find((r) => r["subject_key"] === offering!["key"])?.["revenue_cents"]);
  };
  await expect.poll(revenue, { timeout: 60_000, interval: 1000 }).toBe(cents(money));
});
Step("the Financial Plan's P&L shows that the offering takes in {money}", async (_, money: string) => {
  // A draft's P&L is worked out again a moment after each change, so this waits for the new one.
  const revenue = async () => {
    const { pnl } = await financialPlanResults(financialPlan!);
    const mine = pnl.find((r) => r["level"] === "offering" && r["subject_key"] === offering!["key"]);
    return Number(mine?.["revenue_cents"]);
  };
  await expect.poll(revenue, { timeout: 60_000, interval: 1000 }).toBe(cents(money));
});
Step(
  "a saved Financial Plan named {string} whose offering pays {money} of office costs",
  async (_, name: string, money: string) => {
    ({ offering } = await programWithOffering(0));
    await p.line(
      await p.operationsVersion(),
      "office",
      { cost_center_type: "pool", cost_center_key: await p.pool() },
      cents(money),
    );
    named[name] = await p.savedSet(name);
  },
);
Step(
  "a planner saves a Financial Plan started from {string} with {money} of office costs",
  async (_, name: string, money: string) => {
    const child = await adminStart(`From ${name} ${runId}`, named[name]!);
    const copies = (await copied(child)).map((m) => m["version_id"]);
    const [office] = await read("plan_budget_lines", {
      version_id: { _in: copies },
      key: { _eq: p.lines["office"]!["key"] },
    });
    await (await admin()).ok("PATCH", itemPath("plan_budget_lines", office!["id"]), { amount_cents: cents(money) });
    await p.save(child);
    await financialPlanResults(child);
  },
);
Step(
  "the P&L of {string} still shows that the offering pays {money} of office costs",
  async (_, name: string, money: string) => {
    expect(await officeIn(named[name]!, offering!["key"])).toBe(cents(money));
  },
);
Step("a draft Financial Plan with one offering that has direct costs", async () => {
  ({ offering } = await programWithOffering(0));
  financialPlan = await p.draftSet();
});
Step("the Financial Plan's P&L names the offering's share of the office {string}", async (_, lineName: string) => {
  const { lines } = await financialPlanResults(financialPlan!);
  const share = lines.find(
    (l) => l["cost_center_key"] === offering!["key"] && l["account_id"] === p.lines["office"]!["account_id"],
  );
  expect(share?.["line_name"]).toBe(lineName);
});
Step("they can't change a saved Financial Plan's P&L", async () => {
  await planRows();
  const [results] = await read("plan_results", { version_set_id: { _eq: row["version_sets@saved"] } }, "id");
  expectRefused(await theyWrite("PATCH", itemPath("plan_results", results!["id"]), { total_cents: 1 }));
});
Step("they can't add a P&L to a draft Financial Plan", async () => {
  await planRows();
  expectRefused(
    await theyWrite("POST", "/items/plan_results", {
      id: randomUUID(),
      version_set_id: row["version_sets@draft"],
      total_cents: 0,
    }),
  );
});

// A plan's rules: the planner's own words, which a saved Financial Plan keeps.
Step("they can write a Program Plan's rules", async () => {
  expectOk(
    await theyWrite("PATCH", itemPath("plan_versions", p.areaVersion(p.areas[0]!)), {
      rules: "Practice on Mondays and Fridays.",
    }),
  );
});
Step("a saved Financial Plan whose Program Plan has rules", async () => {
  const area = await p.area();
  await (
    await admin()
  ).ok("PATCH", itemPath("plan_versions", p.areaVersion(area)), { rules: "Practice on Wednesdays." });
  financialPlan = await p.savedSet();
});
Step("they can't change the Program Plan's rules", async () => {
  expectRefused(
    await theyWrite("PATCH", itemPath("plan_versions", p.areaVersion(p.areas[0]!)), { rules: "Practice every day." }),
  );
});

// Who can do what with a Financial Plan.
Step("a draft Financial Plan someone else started", () => planRows());
Step("they can change any of its plans", async () => {
  await planRows();
  for (const collection of PLAN_ROWS) {
    expectOk(await theyWrite("PATCH", itemPath(collection, row[`${collection}@draft`]), change(collection)));
  }
  expectOk(await theyWrite("PATCH", itemPath("plan_versions", row["plan_versions@draft"]), { message: "Changed." }));
});
Step("they can start a Financial Plan", async () => {
  await theyStart(`Started ${runId}`);
});
Step("they can save a draft Financial Plan", async () => {
  await p.area();
  const set = await p.draftSet();
  expectOk(await theyWrite("PATCH", itemPath("version_sets", set), { status: "saved" }));
  const me = await (await theirSession()).ok("GET", "/users/me?fields=id");
  expect(await one("version_sets", set, "status,saved_by")).toEqual({ status: "saved", saved_by: me.id });
});
Step("they can mark a saved Financial Plan active", async () => {
  await planRows();
  expectOk(await theyWrite("PATCH", itemPath("version_sets", row["version_sets@saved"]), { status: "active" }));
});
Step("they can see the Financial Plan and its P&L", async () => {
  await planRows();
  const they = await theirSession();
  expect((await they.request("GET", itemPath("version_sets", row["version_sets@saved"]))).status).toBe(200);
  const filter = encodeURIComponent(JSON.stringify({ version_set_id: { _eq: row["version_sets@saved"] } }));
  const { status, body } = await they.request("GET", `/items/plan_results?filter=${filter}`);
  expect(status).toBe(200);
  expect(body.data).toHaveLength(1);
});
Step("they can't start, save, or mark a Financial Plan active", async () => {
  await planRows();
  expectRefused(
    await theyWrite("POST", "/items/version_sets", {
      id: randomUUID(),
      organization_id: row["organizations"],
      fiscal_year: PLAN_YEAR,
      name: "Refused",
    }),
  );
  expectRefused(await theyWrite("PATCH", itemPath("version_sets", row["version_sets@draft"]), { status: "saved" }));
  expectRefused(await theyWrite("PATCH", itemPath("version_sets", row["version_sets@saved"]), { status: "active" }));
});

// A program's settings and rules in a Financial Plan started from another.
let settings: string | undefined;
onEachScenario(() => {
  settings = undefined;
});
Step(
  "a saved Financial Plan named {string} where {program} have a coach for every {count} sailors",
  async (_, name: string, program: string, sailors: string) => {
    settings = await p.programSettings(await theArea(), await programNamed(program), {
      staff_level_key: (await level("Coach"))["key"],
      sailors_per_coach: Number(sailors),
    });
    named[name] = await p.savedSet(name);
  },
);
Step(
  "they change {program} to a coach for every {count} sailors in the new Financial Plan",
  async (_, _program: string, sailors: string) => {
    const copies = (await copied(started!)).map((m) => m["version_id"]);
    const original = await one("plan_programs", settings, "key");
    const [copy] = await read("plan_programs", { version_id: { _in: copies }, key: { _eq: original["key"] } }, "id");
    expectOk(await theyWrite("PATCH", itemPath("plan_programs", copy!["id"]), { sailors_per_coach: Number(sailors) }));
  },
);
Step(
  "{string} still has {program} with a coach for every {count} sailors",
  async (_, _name: string, _program: string, sailors: string) => {
    expect(Number((await one("plan_programs", settings, "sailors_per_coach"))["sailors_per_coach"])).toBe(
      Number(sailors),
    );
  },
);
Step("they can write the rules for one of a Program Plan's programs", async () => {
  const area = p.areas[0]!;
  const id = await p.programSettings(area, await p.product("program", area), {});
  expectOk(
    await theyWrite("PATCH", itemPath("plan_programs", id), {
      rules: "If there are more than 12 Guppies, add a Junior Instructor.",
    }),
  );
});

// A draft the planner's AI filled in, which the planner keeps or deletes.
const AI_NOTE = "Gave the June 6 practice a block with two coaches. Nothing is left to warn about.";
let aiBlock: string | undefined;
onEachScenario(() => {
  aiBlock = undefined;
});
Step("a saved Financial Plan named {string}", async (_, name: string) => {
  ({ offering } = await programWithOffering());
  // The staff level the AI gives its blocks, copied into the draft with the rest.
  await level("Coach");
  named[name] = await p.savedSet(name);
});
Step(
  "a draft their AI started from {string}, with its blocks filled in and a note of what it changed",
  async (_, name: string) => {
    // As the planner's AI does it over Directus's MCP server, with the planner's own policy.
    started = await theyStart(`AI allocations ${runId}`, named[name]);
    const copy = (await copyOf(offering!, started))["version_id"] as string;
    const offeringCopy = (await copyOf(offering!, started))["id"];
    aiBlock = randomUUID();
    const coach = await level("Coach");
    for (const [collection, data] of [
      ["plan_activity_blocks", { id: aiBlock, date: `${PLAN_YEAR}-06-06`, name: "Morning" }],
      [
        "plan_activities",
        {
          id: randomUUID(),
          offering_id: offeringCopy,
          block_id: aiBlock,
          date: `${PLAN_YEAR}-06-06`,
          start_time: "09:00",
          end_time: "12:00",
          kind: "practice",
          uses_boats: false,
        },
      ],
      ["plan_block_staff", { id: randomUUID(), block_id: aiBlock, staff_level_key: coach["key"], count: 2 }],
    ] as const) {
      expectOk(await theyWrite("POST", `/items/${collection}`, { version_id: copy, key: randomUUID(), ...data }));
    }
    expectOk(await theyWrite("PATCH", itemPath("version_sets", started), { message: AI_NOTE }));
  },
);
Step("they save the draft", async () => {
  expectOk(await theyWrite("PATCH", itemPath("version_sets", started), { status: "saved" }));
});
Step("the draft is saved with its blocks, its note, and its P&L", async () => {
  expect(await one("version_sets", started, "status,message")).toEqual({ status: "saved", message: AI_NOTE });
  expect(await one("plan_activity_blocks", aiBlock, "id")).toEqual({ id: aiBlock });
  expect((await financialPlanResults(started!)).totals).toBeDefined();
});
Step("they delete the draft", async () => {
  const { status } = await (await theirSession()).request("DELETE", itemPath("version_sets", started));
  expect(status).toBe(204);
});
Step("the draft is gone", async () => {
  expect(await read("version_sets", { id: { _eq: started } }, "id")).toEqual([]);
});

// A saved Financial Plan's warnings.
Step("a draft Financial Plan whose Program Plan has a practice on August 2 with no staff", async () => {
  ({ offering } = await programWithOffering());
  await p.activities(offering, [AUGUST_2], "09:00", "12:00");
  financialPlan = await p.draftSet();
});
Step("the Financial Plan's warnings say that the practice on August 2, in its Program Plan, has no staff", async () => {
  const [member] = await read(
    "version_set_members",
    { version_set_id: { _eq: financialPlan }, version_id: { _eq: offering!["version_id"] } },
    "id",
  );
  const planner = (await userFor({ policies: ["Plan Reader"] })).session;
  const filter = encodeURIComponent(
    JSON.stringify({ version_set_id: { _eq: financialPlan }, code: { _eq: "unallocated_activity" } }),
  );
  // The hook writes a saved Financial Plan's results just after the save answers.
  const warnings = async () =>
    planner.ok("GET", `/items/plan_result_warnings?filter=${filter}&fields=version_set_member_id,date,category`);
  await expect
    .poll(warnings, { timeout: 60_000, interval: 1000 })
    .toEqual([{ version_set_member_id: member!["id"], date: AUGUST_2, category: "allocation" }]);
});

describeAccessFeature("planning.feature");
