import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, parameter, pattern, Step, theirSession } from "./steps/index.ts";
import { planInForce, type CostLine } from "../../src/planning/index.ts";
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
  key,
  OPERATIONS_PLAN_ROWS,
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
  await p.offering(p.areaPlan(mine!), await p.product("program", other), 10_000, 1);
});
Step("a planner calculates the P&L", () => p.calculate());
Step("the planner is warned that the offering is in the wrong plan", () => {
  expect(p.warned("offering_in_wrong_plan")).toBe(true);
});

Step("the Operations Plan sells {money} of merchandise", async (_, money: string) => {
  await p.offering(await p.operationsPlan(), await p.product("merchandise", null), cents(money), 1);
});
Step("the organization's totals include {money} of merchandise sales", async (_, money: string) => {
  const merchandise = await p.account("merchandise");
  expect(p.total((l) => l.account_id === merchandise)).toBe(cents(money));
  expect(p.out.organization.operating.revenue_cents).toBeGreaterThanOrEqual(cents(money));
});

Step("a program with no program area", () => p.product("program", null));
Step("a plan with an offering of that program", async () => {
  const area = await p.area();
  await p.offering(p.areaPlan(area), p.products.at(-1)!, 10_000, 1);
});
Step("the planner is warned that the program has no program area", () => {
  expect(p.warned("program_without_area")).toBe(true);
});

/** A program area with two programs, each with one offering. */
async function twoOfferings(price: number, costs: [number, number]): Promise<string> {
  const area = await p.area();
  for (const cost of costs) {
    await p.offering(p.areaPlan(area), await p.product("program", area), price, 1, cost);
  }
  return area;
}

Step("a program area with two offerings that each take in {money}", (_, money: string) =>
  twoOfferings(cents(money), [0, 0]),
);
Step("{money} of storage charged to the program area", async (_, money: string) => {
  const area = p.areas[0]!;
  await p.line(p.areaPlan(area), "storage", { cost_center_type: "program_area", cost_center_key: area }, cents(money), {
    in_mtdc: false,
  });
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
// A program area's P&L for each term, one of the Operations Plan's, made the first time a step names it. The
// features say "no term" for an offering in none.
let terms = new Map<string, string>();
onEachScenario(() => {
  terms = new Map();
});
/** Summer comes before fall, so the terms are in the order the features list them. */
const TERM_DATES: Record<string, [string, string]> = { Summer: ["06-01", "08-31"], Fall: ["09-01", "11-30"] };
async function termKey(name: string | null): Promise<string | null> {
  if (name === null || name === "no term") return null;
  if (!terms.has(name)) {
    const [starts, ends] = TERM_DATES[name.split(" ")[0]!] ?? ["01-01", "12-31"];
    const key = await p.operationsRow("plan_terms", {
      name,
      starts_on: `${PLAN_YEAR}-${starts}`,
      ends_on: `${PLAN_YEAR}-${ends}`,
    });
    terms.set(name, key);
  }
  return terms.get(name)!;
}
const termNamed = (key: string | null | undefined) =>
  key == null ? "no term" : ([...terms].find(([, k]) => k === key)?.[0] ?? key);
const areaTerm = async (name: string) => {
  const key = await termKey(name);
  return p.out.pnl.find((x) => x.level === "program_area_term" && x.key === p.areas[0] && x.term_key === key);
};
async function termOffering(term: string | null, price: number, costs = 0): Promise<Item> {
  const area = p.areas[0] ?? (await p.area());
  const extra = { term_key: await termKey(term) };
  return p.offering(p.areaPlan(area), await p.product("program", area), price, 1, costs, extra);
}
Step("a program area with an offering in {string} that takes in {money}", (_, term: string, money: string) =>
  termOffering(term, cents(money)),
);
Step("an offering in {string} that takes in {money}", (_, term: string, money: string) =>
  termOffering(term, cents(money)),
);
Step("an offering in no term that takes in {money}", (_, money: string) => termOffering(null, cents(money)));
Step("the program area's P&L for each term is:", (_, table: { term: string; "takes in": string }[]) => {
  const rows = p.out.pnl.filter((x) => x.level === "program_area_term" && x.key === p.areas[0]);
  expect(rows.map((r) => ({ term: termNamed(r.term_key), "takes in": r.revenue_cents }))).toEqual(
    table.map((r) => ({ term: r.term, "takes in": cents(r["takes in"]) })),
  );
});
Step(
  "a program area with an offering in {string} and one in {string}, each taking in {money}",
  async (_, first: string, second: string, money: string) => {
    await termOffering(first, cents(money));
    await termOffering(second, cents(money));
  },
);
Step(
  "the program area's P&L for {string} includes {money} of the office costs",
  async (_, term: string, money: string) => {
    const office = await p.account("office");
    expect((await areaTerm(term))?.by_account.find((a) => a.account_id === office)?.amount_cents).toBe(cents(money));
  },
);

Step("a program area with two offerings, the first with twice the direct costs of the second", () =>
  twoOfferings(10_000, [200_000, 100_000]),
);
Step("the first offering pays {money} of the storage", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("storage")))).toBe(cents(money));
});
Step("the second offering pays {money} of the storage", async (_, money: string) => {
  expect(p.total(onOffering(second(), await p.account("storage")))).toBe(cents(money));
});
Step("each offering pays {money} of the storage", async (_, money: string) => {
  const storage = await p.account("storage");
  for (const key of [first(), second()]) expect(p.total(onOffering(key, storage))).toBe(cents(money));
});
Step("a program area with two offerings with the same direct costs", () => twoOfferings(10_000, [100_000, 100_000]));
Step(
  "a salaried director paid {money} an hour, with {count} hours charged to the program area",
  async (_, money: string, hours: string) => {
    const plan = await p.operationsPlan();
    const position = await adminCreate("plan_salaried_positions", {
      id: randomUUID(),
      plan_id: plan,
      key: randomUUID(),
      name: "Director",
      annual_salary_cents: cents(money) * 2080,
      paid_hours_per_year: 2080,
    });
    await adminCreate("plan_salaried_bookings", {
      id: randomUUID(),
      plan_id: plan,
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
    await p.offering(p.areaPlan(area), await p.product("program", area), cents(money), Number(sailors));
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
  await p.offering(p.areaPlan(area), await p.product("program", area), cents(money), 1);
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
  await p.offering(p.areaPlan(area), await p.product("program", area), 1_000_000, 1, 100_000);
  await p.offering(p.areaPlan(area), await p.product("program", area), 0, 1, 100_000);
});
Step("scholarships on the first offering only, which don't count toward the split", () =>
  p.charge("Scholarships", 0.02, "scholarships", ["program"], true),
);
Step("{money} of office costs shared by every offering", async (_, money: string) => {
  await p.line(
    await p.operationsPlan(),
    "office",
    { cost_center_type: "pool", cost_center_key: await p.pool() },
    cents(money),
  );
});
Step("every program's indirect cost rate is {percent}", (_, percent: string) => p.indirectCostRate(share(percent)));
Step("the second offering takes in twice as much", async () => {
  const offering = p.offerings[1]!;
  await (
    await admin()
  ).ok("PATCH", itemPath("plan_offerings", offering["id"]), { price_cents: Number(offering["price_cents"]) * 2 });
  await p.calculate();
});
Step("the first offering still pays {money} of the office costs", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("office")))).toBe(cents(money));
});
Step("no offering pays the office costs", async () => {
  const office = await p.account("office");
  expect(p.total((l) => l.cost_center_type === "offering" && l.account_id === office)).toBe(0);
});
Step("the planner is warned that a program has no indirect cost rate", () => {
  expect(p.warned("no_indirect_cost_rate")).toBe(true);
});
Step("the offering pays {money} of the office costs", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("office")))).toBe(cents(money));
});
Step("the full rate, which would allocate every shared cost, is {percent}", (_, percent: string) => {
  expect(p.out.organization.indirect.full_recovery_rate).toBe(share(percent));
});
Step("the organization's totals show {money} of unallocated indirect costs", (_, money: string) => {
  expect(p.out.organization.indirect.unrecovered_cents).toBe(cents(money));
});

Step("the Operations Plan buys a {money} coach boat", async (_, money: string) => {
  await p.line(await p.operationsPlan(), "coachBoats", { cost_center_type: "org" }, cents(money));
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
    p.areaPlan(area),
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
  await p.offering(p.areaPlan(area), await p.product("program", area), cents(revenue), 1, cents(costs));
});
Step("donations of {money}, which cost {money} to raise", async (_, raised: string, cost: string) => {
  const plan = await p.operationsPlan();
  await p.line(plan, "donations", { cost_center_type: "org" }, cents(raised));
  await p.line(plan, "costs", { cost_center_type: "org" }, cents(cost), { function: "fundraising" });
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

// Pay, bonuses, closed days, and frozen P&Ls, which step 12c builds.
parameter("counted", ["after shared costs", "before shared costs"]);
pattern("times", /\d+(?:am|pm) to (?:noon|\d+(?:am|pm))/);
/** The first `weekday` (0 = Sunday) on or after `from`. */
function next(weekday: number, from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The director's bonus: who owns it, and in which plan.
let earner: { owner: string; plan: string; area: string } | undefined;
let position: string | undefined;
onEachScenario(() => {
  earner = undefined;
  position = undefined;
});
const bonusTotal = (prefix = "bonus:") => p.total((l) => l.line_key.startsWith(prefix));

/** A new program area's director, earning `rate` of the net of the products the Operations Plan gives them. */
async function directorWithBonus(rate: number, extra: Row = {}): Promise<void> {
  const area = await p.area();
  const plan = await p.operationsPlan();
  earner = { owner: await p.bonus(plan, rate, [], extra), plan, area };
}
/** A program of the director's area, which the bonus counts, with an offering in the area's plan. */
async function bonusProgram(price: number, costs: number, extra: Row = {}): Promise<Item> {
  const product = await p.product("program", earner!.area);
  await p.owns(earner!.owner, earner!.plan, product);
  return p.offering(p.areaPlan(earner!.area), product, price, 1, costs, extra);
}

Step("the Operations Plan pays a program area's director {percent} of its programs' net", (_, percent: string) =>
  directorWithBonus(share(percent)),
);
Step("its programs make {money} after their costs and shared costs", (_, money: string) =>
  bonusProgram(cents(money), 0),
);
Step("the director's bonus is {money}", (_, money: string) => {
  expect(bonusTotal()).toBe(cents(money));
});

// Bonuses by term.
const byNet = async (term: string | null, net: number) => {
  const extra = { term_key: await termKey(term) };
  return net < 0 ? bonusProgram(0, -net, extra) : bonusProgram(net, 0, extra);
};
Step(
  "its programs make {money} in {string} and lose {money} in {string}",
  async (_, made: string, first: string, lost: string, second: string) => {
    await byNet(first, cents(made));
    await byNet(second, -cents(lost));
  },
);
Step(
  "its programs make {money} in {string} and {money} in no term",
  async (_, made: string, term: string, none: string) => {
    await byNet(term, cents(made));
    await byNet(null, cents(none));
  },
);
Step(
  "its programs make {money} in {string} and {money} in {string}",
  async (_, made: string, first: string, more: string, second: string) => {
    await byNet(first, cents(made));
    await byNet(second, cents(more));
  },
);
Step("the director's bonus for each term is:", (_, table: { term: string; net: string; bonus: string }[]) => {
  const mine = p.out.bonuses.filter((b) => b.program_area_id === earner!.area);
  expect(mine.map((b) => ({ term: termNamed(b.term_key), net: b.net_cents, bonus: b.bonus_cents }))).toEqual(
    table.map((r) => ({ term: r.term, net: cents(r.net), bonus: cents(r.bonus) })),
  );
});
Step("the program area's P&L for {string} includes {money} of bonus", async (_, term: string, money: string) => {
  const bonus = await p.account("bonus");
  expect((await areaTerm(term))?.by_account.find((a) => a.account_id === bonus)?.amount_cents).toBe(cents(money));
});

const COUNTED: Record<string, Row> = {
  "after shared costs": { basis: "after_shared_costs" },
  "before shared costs": { basis: "before_shared_costs" },
};
Step("a director who earns {percent} of their programs' net {counted}", (_, percent: string, counted: string) =>
  directorWithBonus(share(percent), COUNTED[counted]),
);
Step(
  "their programs take in {money} and cost {money}, with an indirect cost rate of {percent}",
  async (_, revenue: string, costs: string, percent: string) => {
    await bonusProgram(cents(revenue), cents(costs));
    await p.line(
      await p.operationsPlan(),
      "office",
      { cost_center_type: "pool", cost_center_key: await p.pool() },
      cents(costs),
    );
    await p.indirectCostRate(share(percent));
  },
);
parameter("tax", ["Social Security", "Medicare", "WA unemployment", "L&I"]);
Step("a payroll tax of {percent} of wages", (_, percent: string) =>
  p.operationsRow("plan_payroll_taxes", { name: "Payroll tax", wage_share: share(percent) }),
);
Step("{tax} of {percent} of wages", (_, tax: string, percent: string) =>
  p.operationsRow("plan_payroll_taxes", { name: tax, wage_share: share(percent) }),
);
Step("{tax} of {money} for each hour worked", (_, tax: string, money: string) =>
  p.operationsRow("plan_payroll_taxes", { name: tax, hourly_cents: cents(money) }),
);
const taxOf = async (tax: string) => {
  const account = await p.account("payrollTax");
  return p.total((l) => onOffering(first(), account)(l) && l.line_name === tax);
};
Step("the offering pays {money} of {tax}", async (_, money: string, tax: string) => {
  expect(await taxOf(tax)).toBe(cents(money));
});
Step("the offering pays no {tax}", async (_, tax: string) => {
  expect(await taxOf(tax)).toBe(0);
});
Step("a director whose bonus is {money}", async (_, money: string) => {
  await directorWithBonus(0.5);
  await bonusProgram(cents(money) * 2, 0);
});
Step("the organization pays {money} of payroll tax on the bonus", (_, money: string) => {
  expect(bonusTotal("bonus_payroll_tax:")).toBe(cents(money));
});
Step("a director's bonus, with its payroll tax, on the first offering only", async () => {
  await p.operationsRow("plan_payroll_taxes", { name: "Payroll tax", wage_share: 0.1 });
  await p.bonus(await p.operationsPlan(), 0.5, [p.offerings[0]!["product_id"] as string]);
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
  await p.offering(p.areaPlan(area), product, cents(money) * 2, 1);
  await p.bonus(await p.operationsPlan(), 0.5, [product], { position_key: position });
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
  const offering = await p.offering(p.areaPlan(area), await p.product("program", area), 0, 1);
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
parameter("boats", ["Sailqubes", "Optis", "RIBs", "FJs"]);
parameter("staff", ["one coach", "two coaches"]);
parameter("day", ["July 1", "August 1"]);
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
const DAYS: Record<string, string> = { "July 1": `${PLAN_YEAR}-07-01`, "August 1": `${PLAN_YEAR}-08-01` };
const juneDays = (n: number) =>
  Array.from({ length: n }, (_, i) => `${PLAN_YEAR}-06-${String(i + 1).padStart(2, "0")}`);

/** The scenario's programs, staff levels and boat classes, by the names the steps use. */
let programs: Record<string, string> = {};
let levels: Record<string, Item> = {};
let staffRole: string | undefined;
let classes: Record<string, string> = {};
/** Offerings that share a block whose activities a later step adds, and the block. */
let pending: { offerings: Item[]; block: string } | undefined;
onEachScenario(() => {
  programs = {};
  levels = {};
  staffRole = undefined;
  classes = {};
  pending = undefined;
});

/** The scenario's program area: every program and block in a scenario is in one Program Plan. */
const theArea = async () => p.areas[0] ?? (await p.area());
async function programNamed(name: string): Promise<string> {
  programs[name] ??= await p.product("program", await theArea());
  return programs[name];
}
/** A staff level, with its rate in the Operations Plan of `rate` cents an hour. */
async function level(name: string, rate = 2000): Promise<Item> {
  staffRole ??= (await adminCreate("staff_roles", { id: randomUUID(), name: `Role ${key("role")}`, sort: 1 }))["id"];
  const role = staffRole;
  levels[name] ??= await (async () => {
    const staffLevel = await adminCreate("staff_levels", {
      id: randomUUID(),
      name: `${name} ${key("level")}`,
      role_id: role,
      grade: "standard",
    });
    return adminCreate("plan_staff_levels", {
      id: randomUUID(),
      plan_id: await p.operationsPlan(),
      staff_level_id: staffLevel.id,
      hourly_rate_cents: rate,
    });
  })();
  return levels[name];
}
/** A boat class by its plural name. RIBs are coach boats: they take no sailors, and book to coach boats. */
async function boatClass(name: string, sailors = name === "Optis" ? 1 : 2): Promise<string> {
  classes[name] ??=
    name === "RIBs"
      ? await p.boatClass(name, 0, { account_id: await p.account("ribs") })
      : await p.boatClass(name, sailors);
  return classes[name];
}
const kindOf = (boats: string) => (boats === "RIBs" ? "powerboat" : "sailboat");
/** A class's boat rate in the Operations Plan, with `fields` such as its fuel. */
const boatRate = async (boats: string, fields: Row) =>
  p.operationsRow("plan_boat_rates", {
    boat_class_id: await boatClass(boats),
    maintenance_per_boat_hour_cents: 0,
    ...fields,
  });
const staffAt = async (name: string, count: number, rate?: number) => ({
  staff_level_id: (await level(name, rate))["staff_level_id"],
  count,
});

/** What a block is given. */
interface Given {
  staff?: Row[];
  boats?: Row[];
}
/** An offering of `program`, or of a new program, with `sailors` sailors expected. */
async function offeringOf(program: string | undefined, sailors: number, extra: Row = {}, price = 0): Promise<Item> {
  const area = await theArea();
  const product = program === undefined ? await p.product("program", area) : await programNamed(program);
  return p.offering(p.areaPlan(area), product, price, sailors, 0, extra);
}
/** An offering of `program` for up to `max` sailors, expecting `expected`. */
const upTo = (program: string | undefined, max: string, expected = max, price = 0) =>
  offeringOf(program, Number(expected), { capacity: Number(max) }, price);
/** A block on `date` holding a practice of each offering at `times`, given `given`. Returns the block. */
async function blockOf(offerings: Item[], times: string, given: Given, date = JUNE, name = "A block"): Promise<string> {
  const plan = offerings[0]!["plan_id"] as string;
  const block = await p.block(plan, date, name);
  for (const o of offerings) {
    // A practice with boats is on the water.
    const sails = (given.boats ?? []).length > 0;
    await p.activities(o, [date], ...span(times), { block_id: block, uses_boats: sails });
  }
  for (const s of given.staff ?? []) await p.given("plan_block_staff", plan, block, s);
  for (const b of given.boats ?? []) await p.given("plan_block_boats", plan, block, b);
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
    staff_level_id: (await level("Coach"))["staff_level_id"],
    sailors_per_coach: Number(sailors),
  });
});
Step(
  "Guppies have a coach for every {count} sailors, and Minnows a coach for every {count}",
  async (_, guppies: string, minnows: string) => {
    const coach = (await level("Coach"))["staff_level_id"];
    for (const [program, sailors] of [
      ["Guppies", guppies],
      ["Minnows", minnows],
    ] as const) {
      await p.programSettings(await theArea(), await programNamed(program), {
        staff_level_id: coach,
        sailors_per_coach: Number(sailors),
      });
    }
  },
);
for (const text of ["{boats} take {count} sailor each", "{boats} take {count} sailors each"]) {
  Step(text, (_, boats: string, sailors: string) => boatClass(boats, Number(sailors)));
}
Step("{boats} that cost {money} an hour on the water in upkeep", (_, boats: string, money: string) =>
  boatRate(boats, { maintenance_per_boat_hour_cents: cents(money) }),
);
Step(
  "{boats} that cost {money} an hour in fuel and {money} an hour in upkeep",
  (_, boats: string, fuel: string, upkeep: string) =>
    boatRate(boats, { fuel_per_hour_cents: cents(fuel), maintenance_per_boat_hour_cents: cents(upkeep) }),
);
Step("{boats} that charter for {money} a day", (_, boats: string, money: string) =>
  boatRate(boats, { charter_per_day_cents: cents(money) }),
);
Step("the organization has {count} {boats}", async (_, count: string, boats: string) => {
  await p.boats(await boatClass(boats), Number(count), kindOf(boats));
});
Step(
  "the organization has {count} {boats}, and gets {count} more on {day}",
  async (_, count: string, boats: string, more: string, day: string) => {
    await p.boats(await boatClass(boats), Number(count), kindOf(boats));
    await p.boats(await boatClass(boats), Number(more), kindOf(boats), { acquired_on: DAYS[day] });
  },
);
Step(
  "the organization has {count} {boats}, and disposes of {count} on {day}",
  async (_, count: string, boats: string, gone: string, day: string) => {
    await p.boats(await boatClass(boats), Number(count) - Number(gone), kindOf(boats));
    await p.boats(await boatClass(boats), Number(gone), kindOf(boats), { disposed_on: DAYS[day] });
  },
);

// Defined below `times`, which a step needs before it can use it. The plan is for PLAN_YEAR, 2027, and
// the winter starts the December before it.
let winter: Item | undefined;
Step(
  "a winter offering in the 2027 plan, from December 2026 to March 2027, that takes in {money}",
  async (_, money: string) => {
    const area = await p.area();
    winter = await p.offering(p.areaPlan(area), await p.product("program", area), cents(money), 1, 0, {
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

// What the P&L costs.
Step(
  "an offering with a practice from {times}, in a block with {count} coaches paid {money} an hour",
  async (_, times: string, count: string, money: string) => {
    await blockOf([await offeringOf(undefined, 1)], times, await coachesPaid(count, money));
  },
);
Step(
  "an offering with a practice from {times}, in a block with {count} of the organization's {boats}",
  async (_, times: string, count: string, boats: string) => {
    await blockOf([await offeringOf(undefined, 1)], times, {
      boats: [{ boat_class_id: await boatClass(boats), count: Number(count) }],
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
  const plan = offerings[0]!["plan_id"] as string;
  const block = await p.block(plan, JUNE);
  await p.given("plan_block_staff", plan, block, (await coachesPaid(count, money)).staff[0]!);
  pending = { offerings, block };
});
Step("one practices from {times} and the other from {times}", async (_, one: string, other: string) => {
  const { offerings, block } = pending!;
  await p.activities(offerings[0]!, [JUNE], ...span(one), { block_id: block });
  await p.activities(offerings[1]!, [JUNE], ...span(other), { block_id: block });
});
Step(
  "a {program} offering for up to {count} sailors that expects {count}, with a practice from {times}, in a block with {count} coaches paid {money} an hour",
  async (_, program: string, max: string, expected: string, times: string, count: string, money: string) => {
    await blockOf([await upTo(program, max, expected)], times, await coachesPaid(count, money));
  },
);
Step(
  "a {program} offering for up to {count} sailors that expects {count}, with a practice from {times}, in a block the director coaches with a coach paid {money} an hour",
  async (_, program: string, max: string, expected: string, times: string, money: string) => {
    await blockOf([await upTo(program, max, expected)], times, {
      staff: [{ position_key: position, count: 1 }, await staffAt("Coach", 1, cents(money))],
    });
  },
);
Step(
  "an offering for up to {count} sailors that expects {count}, with a practice from {times}, in a block with {count} of the organization's {boats}",
  async (_, max: string, expected: string, times: string, count: string, boats: string) => {
    await blockOf([await upTo(undefined, max, expected)], times, {
      boats: [{ boat_class_id: await boatClass(boats), count: Number(count) }],
    });
  },
);
Step(
  "an offering for up to {count} sailors that expects {count}, with a practice from {times}, in a block with {count} chartered {boats}",
  async (_, max: string, expected: string, times: string, count: string, boats: string) => {
    await blockOf([await upTo(undefined, max, expected)], times, {
      boats: [{ boat_class_id: await boatClass(boats), count: 0, chartered: Number(count) }],
    });
  },
);
Step("the first offering pays {money} of coaches' wages", async (_, money: string) => {
  expect(await wagesOf(p.offerings[0]!)).toBe(cents(money));
});
Step("the second offering pays {money} of coaches' wages", async (_, money: string) => {
  expect(await wagesOf(p.offerings[1]!)).toBe(cents(money));
});
Step("the two offerings pay {money} of coaches' wages between them", async (_, money: string) => {
  expect((await wagesOf(p.offerings[0]!)) + (await wagesOf(p.offerings[1]!))).toBe(cents(money));
});
Step("the offering pays {money} for coach boats", async (_, money: string) => {
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
  const plan = offering["plan_id"] as string;
  for (const date of juneDays(practices)) {
    const block = await p.block(plan, date);
    await p.activities(offering, [date], "16:00", `${16 + hours}:00`, { block_id: block });
    await p.given("plan_block_staff", plan, block, { position_key: position, count: 1, pay });
    for (const s of extra) await p.given("plan_block_staff", plan, block, s);
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
Step(
  "two blocks on the morning of July 13, with {count} {boats} and {count} {boats}",
  async (_, n: string, boats: string, m: string) => {
    for (const count of [n, m]) {
      await blockOf(
        [await offeringOf(undefined, 1)],
        MORNING,
        { boats: [{ boat_class_id: await boatClass(boats), count: Number(count) }] },
        JULY_13,
      );
    }
  },
);
Step(
  "a block on the morning of July 13 with {count} of the organization's {boats} and {count} chartered {boats}",
  async (_, own: string, boats: string, chartered: string) => {
    await blockOf(
      [await offeringOf(undefined, 1)],
      MORNING,
      { boats: [{ boat_class_id: await boatClass(boats), count: Number(own), chartered: Number(chartered) }] },
      JULY_13,
    );
  },
);
Step(
  "a block with {count} chartered RIB on the morning of July 13, and another with {count} that afternoon",
  async (_, morning: string, afternoon: string) => {
    for (const [times, n] of [
      [MORNING, morning],
      ["1pm to 4pm", afternoon],
    ] as const) {
      await blockOf(
        [await offeringOf(undefined, 1)],
        times,
        { boats: [{ boat_class_id: await boatClass("RIBs"), count: 0, chartered: Number(n) }] },
        JULY_13,
      );
    }
  },
);
Step("the offering pays {money} for boat charters", async (_, money: string) => {
  expect(p.total(onOffering(first(), await p.account("boatCharters")))).toBe(cents(money));
});
Step("the two offerings pay {money} for boat charters between them", async (_, money: string) => {
  const charters = await p.account("boatCharters");
  const paid = (o: Item) => p.total(onOffering(o["key"] as string, charters));
  expect(paid(p.offerings[0]!) + paid(p.offerings[1]!)).toBe(cents(money));
});

// Boats for a full program.
Step(
  "the organization has {count} {boats} and {count} {boats}",
  async (_, n: string, one: string, m: string, other: string) => {
    await p.boats(await boatClass(one), Number(n), kindOf(one));
    await p.boats(await boatClass(other), Number(m), kindOf(other));
  },
);
Step(
  "a {program} offering for up to {count} sailors that expects {count}, in a block with {count} {boats} on the morning of July 13",
  async (_, program: string, max: string, expected: string, count: string, boats: string) => {
    await blockOf(
      [await upTo(program, max, expected)],
      MORNING,
      { boats: [{ boat_class_id: await boatClass(boats), count: Number(count) }] },
      JULY_13,
    );
  },
);
Step(
  "a {program} offering for up to {count} sailors that expects {count}, in a block with {count} {boats} and {count} {boats} on the morning of July 13",
  async (_, program: string, max: string, expected: string, n: string, one: string, m: string, other: string) => {
    await blockOf(
      [await upTo(program, max, expected)],
      MORNING,
      {
        boats: [
          { boat_class_id: await boatClass(one), count: Number(n) },
          { boat_class_id: await boatClass(other), count: Number(m) },
        ],
      },
      JULY_13,
    );
  },
);
Step(
  "a {program} offering for up to {count} sailors that expects {count}, in a block on the morning of July 13 with {count} of the organization's {boats} and {count} that sailors bring",
  async (_, program: string, max: string, expected: string, count: string, boats: string, theirs: string) => {
    await blockOf(
      [await upTo(program, max, expected)],
      MORNING,
      { boats: [{ boat_class_id: await boatClass(boats), count: Number(count), sailor_owned: Number(theirs) }] },
      JULY_13,
    );
  },
);
Step(
  "the planner is warned that on July 13 {program} needs {count} {boats} when it's full, but the organization has {count}",
  (_, _program: string, needs: string, _boats: string, have: string) => {
    const found = warning("short_of_boats");
    expect(found).toMatchObject({ category: "allocation", date: JULY_13 });
    expect(found?.message).toMatch(
      new RegExp(
        // Each test's boat class has a name of its own, such as "Sailqubes boat-1".
        `^.+ needs ${needs} .+ out at once when it's full, but .+ has only ${have}, so it's ${Number(needs) - Number(have)} short$`,
      ),
    );
  },
);
Step("the planner isn't warned that the organization hasn't enough {boats}", () => {
  expect(p.warned("short_of_boats")).toBe(false);
});
Step(
  "a {program} offering for up to {count} sailors that expects {count}, in a block with one coach and enough boats for {count}",
  async (_, program: string, max: string, expected: string, boats: string) => {
    await blockOf([await upTo(program, max, expected)], MORNING, {
      staff: [await staffAt("Coach", 1)],
      boats: await enoughBoats(Number(boats)),
    });
  },
);
Step(
  "a {program} offering for up to {count} sailors, in a block with {count} coaches and {count} {boats}",
  async (_, program: string, max: string, coaches: string, count: string, boats: string) => {
    await blockOf([await upTo(program, max)], MORNING, {
      staff: [await staffAt("Coach", Number(coaches))],
      boats: [{ boat_class_id: await boatClass(boats), count: Number(count) }],
    });
  },
);
Step(
  "a block for up to {count} Guppies and up to {count} Minnows, with three coaches and boats for {count} sailors",
  async (_, guppies: string, minnows: string, sailors: string) => {
    const offerings = [await upTo("Guppies", guppies), await upTo("Minnows", minnows)];
    await blockOf(offerings, MORNING, {
      staff: [await staffAt("Coach", 3)],
      boats: await enoughBoats(Number(sailors)),
    });
  },
);
const pnlOf = (offering: Item) => p.out.pnl.find((x) => x.level === "offering" && x.key === offering["key"]);
const offeringOfProgram = (program: string) => p.offerings.find((o) => o["product_id"] === programs[program])!;
Step("the offering's block can take {count} sailors", (_, sailors: string) => {
  expect(pnlOf(p.offerings[0]!)?.allocation_holds).toBe(Number(sailors));
});
Step("the {program} offering's block can take {count} sailors", (_, program: string, sailors: string) => {
  expect(pnlOf(offeringOfProgram(program))?.allocation_holds).toBe(Number(sailors));
});

// The fewest sailors at which an offering pays for itself.
Step(
  "an offering for up to {count} sailors at {money} a sailor, with {money} of its own costs",
  async (_, max: string, price: string, costs: string) => {
    const offering = await upTo(undefined, max, max, cents(price));
    await p.line(
      offering["plan_id"] as string,
      "costs",
      { cost_center_type: "offering", cost_center_key: offering["key"] },
      cents(costs),
    );
  },
);
Step(
  "a {program} offering for up to {count} sailors at {money} a sailor, with {money} of its own costs and a practice from {times} in a block with {count} coaches paid {money} an hour",
  async (
    _,
    program: string,
    max: string,
    price: string,
    costs: string,
    times: string,
    count: string,
    money: string,
  ) => {
    const offering = await upTo(program, max, max, cents(price));
    await p.line(
      offering["plan_id"] as string,
      "costs",
      { cost_center_type: "offering", cost_center_key: offering["key"] },
      cents(costs),
    );
    await blockOf([offering], times, await coachesPaid(count, money));
  },
);
Step("the offering pays for itself at {count} sailors", (_, sailors: string) => {
  expect(pnlOf(p.offerings[0]!)?.breakeven_enrollment).toBe(Number(sailors));
});
Step("the offering doesn't pay for itself, even when it's full", () => {
  expect(pnlOf(p.offerings[0]!)?.breakeven_enrollment).toBeNull();
});
Step("the planner isn't warned about the block", () => {
  // The block's boats are the organization's own, but this example is about its coaches.
  expect(p.out.warnings.filter((w) => w.category === "allocation" && /coach/.test(w.message))).toEqual([]);
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
  await p.line(await p.operationsPlan(), "office", { cost_center_type: "pool", cost_center_key: pool }, cents(money), {
    name: "Office",
  });
});
// Financial Plans: each holds an Operations Plan and Program Plans, frozen together.
const NEEDS_OPERATIONS = "A Financial Plan needs an Operations Plan before it's frozen.";
const ONE_PER_AREA = "A Financial Plan holds one Operations Plan, and at most one Program Plan for each program area.";

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

/** A new Financial Plan for the year, as "they": for `parent`'s organization, or else the scenario's. */
async function theyStart(name: string, parent?: string): Promise<string> {
  const id = randomUUID();
  const organization = parent ? (await one("financial_plans", parent, "organization_id"))["organization_id"] : null;
  expectOk(
    await theyWrite("POST", "/items/financial_plans", {
      id,
      organization_id: organization ?? (await p.organization()),
      fiscal_year: PLAN_YEAR,
      name,
      ...(parent && { parent_id: parent }),
    }),
  );
  return id;
}

/** A new Financial Plan started from `parent`, as the admin, once its plans are copied in. */
async function adminStart(name: string, parent: string): Promise<string> {
  const set = await adminCreate("financial_plans", {
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
  const offering = await p.offering(p.areaPlan(area), await p.product("program", area), price, 10, 100_000, extra);
  return { area, offering };
}

/** The plans of a Financial Plan started from another, once they're copied in. */
const plansOf = async (set: string) => (await copied(set)).map((plan) => plan["id"]);

/** The copy of `offering` in a Financial Plan started from the one that holds it. */
async function copyOf(offering: Item, set: string): Promise<Row> {
  const [copy] = await read("plan_offerings", { plan_id: { _in: await plansOf(set) }, key: { _eq: offering["key"] } });
  expect(copy, "the offering's copy").toBeDefined();
  return copy!;
}

/** The office costs an offering pays in a frozen Financial Plan's results. */
async function officeIn(set: string, offering: unknown): Promise<number> {
  const office = await p.account("office");
  return (await financialPlanResults(set)).lines
    .filter((l) => l["account_id"] === office && l["cost_center_key"] === offering)
    .reduce((t, l) => t + Number(l["amount_cents"]), 0);
}

// What a Financial Plan holds.
Step("they start a Financial Plan for next year with only an Operations Plan", async () => {
  financialPlan = await theyStart(`Financial Plan ${runId}`);
  expectOk(
    await theyWrite("POST", "/items/plans", { id: randomUUID(), financial_plan_id: financialPlan, kind: "operations" }),
  );
});
Step("the Financial Plan is a draft, with the Operations Plan in it", async () => {
  expect(await one("financial_plans", financialPlan, "status")).toMatchObject({ status: "draft" });
  expect(await read("plans", { financial_plan_id: { _eq: financialPlan } }, "kind")).toEqual([{ kind: "operations" }]);
});
Step("a draft Financial Plan with a Program Plan but no Operations Plan", async () => {
  await p.area();
  financialPlan = await p.draftSet(undefined, { operations: false });
});
Step("they try to freeze the Financial Plan", async () => {
  await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { status: "frozen" });
});
Step("they're told that the Financial Plan needs an Operations Plan", () => expectTold(NEEDS_OPERATIONS));
Step("the Financial Plan is still a draft", async () => {
  expect(await one("financial_plans", financialPlan, "status")).toMatchObject({ status: "draft" });
});

Step("a draft Financial Plan with a Program Plan for Youth Racing", async () => {
  const area = await p.area();
  await (await admin()).ok("PATCH", itemPath("program_areas", area), { name: `Youth Racing ${runId}` });
  financialPlan = await p.draftSet();
});
Step("they try to add another Program Plan for Youth Racing to it", async () => {
  await theyWrite("POST", "/items/plans", {
    id: randomUUID(),
    financial_plan_id: financialPlan,
    kind: "program_area",
    program_area_id: p.areas[0],
  });
});
Step("they're told that the Financial Plan already has a Program Plan for Youth Racing", () => {
  expectTold(ONE_PER_AREA);
  expect(attempt?.body.errors?.[0]?.message).toContain("Youth Racing");
});

// Freezing a Financial Plan.
Step("a draft Financial Plan with an Operations Plan and two Program Plans", async () => {
  await p.area();
  await p.area();
  financialPlan = await p.draftSet();
});
Step("they freeze the Financial Plan", async () => {
  expectOk(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { status: "frozen" }));
});
Step("the Financial Plan is frozen, and none of its three plans can change", async () => {
  expect(await one("financial_plans", financialPlan, "status")).toEqual({ status: "frozen" });
  const plans = await read("plans", { financial_plan_id: { _eq: financialPlan } }, "id");
  expect(plans).toHaveLength(3);
  for (const plan of plans) {
    expectRefused(await theyWrite("PATCH", itemPath("plans", plan["id"]), { notes: ["Changed."] }));
  }
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
    "financial_plans",
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
  "a frozen Financial Plan named {string} with an offering at {money} a sailor",
  async (_, name: string, money: string) => {
    offering = (await programWithOffering(cents(money))).offering;
    // A staff level in its Operations Plan, for a draft an AI starts from it.
    await level("Coach");
    named[name] = await p.frozenSet(name);
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
  expect(await one("financial_plans", started, "parent_id")).toEqual({ parent_id: named[name] });
});
Step("they change the offering's price to {money} a sailor in the new Financial Plan", async (_, money: string) => {
  const copy = await copyOf(offering!, started!);
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", copy["id"]), { price_cents: cents(money) }));
});
Step("{string} still has the offering at {money} a sailor", async (_, _name: string, money: string) => {
  expect(await one("plan_offerings", offering!["id"], "price_cents")).toEqual({ price_cents: cents(money) });
});

// An offering's term, one of the Operations Plan's.
let term: string | undefined;
onEachScenario(() => {
  term = undefined;
});
async function draftWithTerm(name: string, inTerm: boolean): Promise<void> {
  term = await p.operationsRow("plan_terms", { name, starts_on: `${PLAN_YEAR}-06-01`, ends_on: `${PLAN_YEAR}-08-31` });
  offering = (await programWithOffering(100_000, inTerm ? { term_key: term } : {})).offering;
  financialPlan = await p.draftSet();
}
Step("a draft Financial Plan whose Operations Plan has a term named {string}, with an offering", (_, name: string) =>
  draftWithTerm(name, false),
);
Step("a draft Financial Plan whose offering is in a term", () => draftWithTerm(`Summer ${PLAN_YEAR}`, true));
Step("they put the offering in {string}", async () => {
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { term_key: term }));
});
Step("they take the offering out of its term", async () => {
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { term_key: null }));
});
Step("the offering is in {string}", async () => {
  expect(await one("plan_offerings", offering!["id"], "term_key")).toEqual({ term_key: term });
});
Step("the offering is in no term", async () => {
  expect(await one("plan_offerings", offering!["id"], "term_key")).toEqual({ term_key: null });
});

// An offering's activities, in a Financial Plan started from it.
let practice: Item | undefined;
onEachScenario(() => {
  practice = undefined;
});
Step("a frozen Financial Plan named {string} with a practice on June 6", async (_, name: string) => {
  ({ offering } = await programWithOffering());
  practice = await adminCreate("plan_activities", {
    id: randomUUID(),
    plan_id: offering["plan_id"],
    key: randomUUID(),
    offering_id: offering["id"],
    date: `${PLAN_YEAR}-06-06`,
    start_time: "09:00",
    end_time: "12:00",
    kind: "practice",
    uses_boats: true,
  });
  named[name] = await p.frozenSet(name);
});
Step("its practice on June 6 is the same practice as the one in {string}", async () => {
  const copy = await copyOf(offering!, started!);
  const [activity] = await read("plan_activities", { offering_id: { _eq: copy["id"] } });
  expect(activity).toMatchObject({ key: practice!["key"], date: `${PLAN_YEAR}-06-06`, plan_id: copy["plan_id"] });
  expect(activity!["id"]).not.toBe(practice!["id"]);
});

Step("a draft Financial Plan", async () => {
  await p.area();
  financialPlan = await p.draftSet();
});
// A frozen Financial Plan never changes, apart from its name and note.
Step("a frozen Financial Plan", async () => {
  ({ offering } = await programWithOffering());
  financialPlan = await p.frozenSet();
});
Step("they can't change the Financial Plan or any of its plans", async () => {
  expectRefused(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { fiscal_year: 2000 }));
  expectRefused(await theyWrite("PATCH", itemPath("plans", offering!["plan_id"]), { notes: ["Changed."] }));
  expectRefused(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { price_cents: 1 }));
});
Step("they can't turn the Financial Plan back into a draft", async () => {
  expectRefused(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { status: "draft" }));
  expect(await one("financial_plans", financialPlan, "status")).toEqual({ status: "frozen" });
});
Step("they can't delete the Financial Plan", async () => {
  const { status } = await (await theirSession()).request("DELETE", itemPath("financial_plans", financialPlan));
  expect(status).not.toBe(204);
  expect(await one("financial_plans", financialPlan, "id")).toEqual({ id: financialPlan });
});
Step("they can change its note to {string}", async (_, note: string) => {
  expectOk(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { note }));
  expect(await one("financial_plans", financialPlan, "note")).toEqual({ note });
});
let savedTotals: Row | undefined;
Step("they can change its name to {string}", async (_, name: string) => {
  savedTotals = (await financialPlanResults(financialPlan!)).totals;
  expectOk(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { name }));
  expect(await one("financial_plans", financialPlan, "name")).toEqual({ name });
});
Step("its P&L stays the same", async () => {
  expect((await financialPlanResults(financialPlan!)).totals).toEqual(savedTotals);
});

// A Financial Plan's P&L.
Step("a draft Financial Plan with two Program Plans whose offerings each take in {money}", async (_, money: string) => {
  // Each offering has 10 sailors.
  await programWithOffering(cents(money) / 10);
  await programWithOffering(cents(money) / 10);
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
  offering = await p.offering(p.areaPlan(area), await p.product("program", area), cents(money), 1);
  financialPlan = await p.draftSet();
});
Step("they change the offering to take in {money}", async (_, money: string) => {
  // The offering has one sailor, so its price is what it takes in.
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { price_cents: cents(money) }));
});
// A change to the catalog queues every draft on dev to be worked out again, one at a time, so under a
// whole run's writes a draft's new P&L can take well over a minute.
const DRAFT_RESULTS = { timeout: 180_000, interval: 1000 };
Step("they see that the Financial Plan's P&L shows the offering takes in {money}", async (_, money: string) => {
  // Through the items API, as an AI does over Directus's MCP server, which can't run the engine. A
  // draft's P&L is worked out again a moment after each change, so this waits for the new one.
  const they = await theirSession();
  const filter = encodeURIComponent(
    JSON.stringify({ financial_plan_id: { _eq: financialPlan }, level: { _eq: "offering" } }),
  );
  const revenue = async () => {
    const { status, body } = await they.request("GET", `/items/plan_result_pnl?limit=-1&filter=${filter}`);
    expect(status).toBe(200);
    const rows = (body as { data: Row[] }).data;
    return Number(rows.find((r) => r["subject_key"] === offering!["key"])?.["revenue_cents"]);
  };
  await expect.poll(revenue, DRAFT_RESULTS).toBe(cents(money));
});
Step("the Financial Plan's P&L shows that the offering takes in {money}", async (_, money: string) => {
  // A draft's P&L is worked out again a moment after each change, so this waits for the new one.
  const revenue = async () => {
    const { pnl } = await financialPlanResults(financialPlan!);
    const mine = pnl.find((r) => r["level"] === "offering" && r["subject_key"] === offering!["key"]);
    return Number(mine?.["revenue_cents"]);
  };
  await expect.poll(revenue, DRAFT_RESULTS).toBe(cents(money));
});
Step(
  "a draft Financial Plan that pays a director {percent} of an offering in {string} that takes in {money}",
  async (_, percent: string, term: string, money: string) => {
    await directorWithBonus(share(percent));
    offering = await bonusProgram(cents(money), 0, { term_key: await termKey(term) });
    financialPlan = await p.draftSet();
  },
);
Step(
  "the Financial Plan's P&L shows that the program area takes in {money} in {string}",
  async (_, money: string, term: string) => {
    const { pnl } = await financialPlanResults(financialPlan!);
    const row = pnl.find(
      (r) => r["level"] === "program_area_term" && r["subject_key"] === earner!.area && r["term_name"] === term,
    );
    expect(Number(row?.["revenue_cents"])).toBe(cents(money));
  },
);
Step(
  "the Financial Plan's P&L shows that the director's bonus for {string} is {money}",
  async (_, term: string, money: string) => {
    const { bonuses } = await financialPlanResults(financialPlan!);
    expect(Number(bonuses.find((r) => r["term_name"] === term)?.["bonus_cents"])).toBe(cents(money));
  },
);
Step(
  "a frozen Financial Plan named {string} whose offering pays {money} of office costs",
  async (_, name: string, money: string) => {
    ({ offering } = await programWithOffering(10_000));
    await p.line(
      await p.operationsPlan(),
      "office",
      { cost_center_type: "pool", cost_center_key: await p.pool() },
      cents(money),
    );
    // The offering takes in $1,000, 10 sailors at $100.
    await p.indirectCostRate(cents(money) / 100_000);
    named[name] = await p.frozenSet(name);
  },
);
Step(
  "a planner freezes a Financial Plan started from {string} with twice the indirect cost rate",
  async (_, name: string) => {
    const child = await adminStart(`From ${name} ${runId}`, named[name]!);
    const [settings] = await read("plan_programs", { plan_id: { _in: await plansOf(child) } });
    await (
      await admin()
    ).ok("PATCH", itemPath("plan_programs", settings!["id"]), {
      indirect_cost_rate: Number(settings!["indirect_cost_rate"]) * 2,
    });
    await p.freeze(child);
    await financialPlanResults(child);
  },
);
Step(
  "the P&L of {string} still shows that the offering pays {money} of office costs",
  async (_, name: string, money: string) => {
    expect(await officeIn(named[name]!, offering!["key"])).toBe(cents(money));
  },
);
Step("the Financial Plan's P&L names the offering's share of the office {string}", async (_, lineName: string) => {
  const { lines } = await financialPlanResults(financialPlan!);
  const share = lines.find(
    (l) => l["cost_center_key"] === offering!["key"] && l["account_id"] === p.lines["office"]!["account_id"],
  );
  expect(share?.["line_name"]).toBe(lineName);
});
Step("they can't change a frozen Financial Plan's P&L", async () => {
  await planRows();
  const [results] = await read("plan_results", { financial_plan_id: { _eq: row["financial_plans@frozen"] } }, "id");
  expectRefused(await theyWrite("PATCH", itemPath("plan_results", results!["id"]), { total_cents: 1 }));
});
Step("they can't add a P&L to a draft Financial Plan", async () => {
  await planRows();
  expectRefused(
    await theyWrite("POST", "/items/plan_results", {
      id: randomUUID(),
      financial_plan_id: row["financial_plans@draft"],
      total_cents: 0,
    }),
  );
});

// A plan's notes: the planner's own short notes, which a frozen Financial Plan keeps.
const SHORT_NOTES = "Each note is one line of at most 280 characters.";
Step("they can write a Program Plan's notes", async () => {
  expectOk(
    await theyWrite("PATCH", itemPath("plans", p.areaPlan(p.areas[0]!)), {
      notes: ["Practice on Mondays and Fridays.", "No practice on school holidays."],
    }),
  );
});
Step("a frozen Financial Plan whose Program Plan has notes", async () => {
  const area = await p.area();
  await (await admin()).ok("PATCH", itemPath("plans", p.areaPlan(area)), { notes: ["Practice on Wednesdays."] });
  financialPlan = await p.frozenSet();
});
Step("they can't change the Program Plan's notes", async () => {
  expectRefused(
    await theyWrite("PATCH", itemPath("plans", p.areaPlan(p.areas[0]!)), { notes: ["Practice every day."] }),
  );
});
Step("they try to give a Program Plan a note longer than 280 characters", async () => {
  await theyWrite("PATCH", itemPath("plans", p.areaPlan(p.areas[0]!)), { notes: ["Practice. ".repeat(29)] });
});
Step("they're told that each note is one line of at most 280 characters", () => expectTold(SHORT_NOTES));

// Who can do what with a Financial Plan.
Step("a draft Financial Plan someone else started", () => planRows());
Step("they can see the Financial Plan and its P&L", async () => {
  await planRows();
  const they = await theirSession();
  expect((await they.request("GET", itemPath("financial_plans", row["financial_plans@frozen"]))).status).toBe(200);
  const filter = encodeURIComponent(JSON.stringify({ financial_plan_id: { _eq: row["financial_plans@frozen"] } }));
  const { status, body } = await they.request("GET", `/items/plan_results?filter=${filter}`);
  expect(status).toBe(200);
  expect(body.data).toHaveLength(1);
});
Step("they can't start, freeze, or make a Financial Plan active", async () => {
  await planRows();
  expectRefused(
    await theyWrite("POST", "/items/financial_plans", {
      id: randomUUID(),
      organization_id: row["organizations"],
      fiscal_year: PLAN_YEAR,
      name: "Refused",
    }),
  );
  expectRefused(
    await theyWrite("PATCH", itemPath("financial_plans", row["financial_plans@draft"]), { status: "frozen" }),
  );
  expectRefused(
    await theyWrite("PATCH", itemPath("financial_plans", row["financial_plans@frozen"]), {
      effective_from: `${PLAN_YEAR}-05-01`,
    }),
  );
});

// A program's settings and notes in a Financial Plan started from another.
let settings: string | undefined;
onEachScenario(() => {
  settings = undefined;
});
Step(
  "a frozen Financial Plan named {string} where {program} have a coach for every {count} sailors",
  async (_, name: string, program: string, sailors: string) => {
    settings = await p.programSettings(await theArea(), await programNamed(program), {
      staff_level_id: (await level("Coach"))["staff_level_id"],
      sailors_per_coach: Number(sailors),
    });
    named[name] = await p.frozenSet(name);
  },
);
Step(
  "they change {program} to a coach for every {count} sailors in the new Financial Plan",
  async (_, _program: string, sailors: string) => {
    const original = await one("plan_programs", settings, "key");
    const inCopies = { plan_id: { _in: await plansOf(started!) }, key: { _eq: original["key"] } };
    const [copy] = await read("plan_programs", inCopies, "id");
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
Step("they can write the notes for one of a Program Plan's programs", async () => {
  const area = p.areas[0]!;
  const id = await p.programSettings(area, await p.product("program", area), {});
  expectOk(
    await theyWrite("PATCH", itemPath("plan_programs", id), {
      notes: ["If there are more than 12 Guppies, add a Junior Instructor."],
    }),
  );
});

Step("they can't set the indirect cost rate of one of a Program Plan's programs", async () => {
  const area = p.areas[0]!;
  const id = await p.programSettings(area, await p.product("program", area), {});
  expectRefused(await theyWrite("PATCH", itemPath("plan_programs", id), { indirect_cost_rate: 0.1 }));
});
Step("they can set the indirect cost rate of one of a Program Plan's programs", async () => {
  const area = p.areas[0]!;
  const id = await p.programSettings(area, await p.product("program", area), {});
  expectOk(await theyWrite("PATCH", itemPath("plan_programs", id), { indirect_cost_rate: 0.1 }));
});

// A draft the planner's AI filled in, which the planner keeps or deletes.
const AI_NOTE = "Gave the June 6 practice a block with two coaches. Nothing is left to warn about.";
let aiBlock: string | undefined;
onEachScenario(() => {
  aiBlock = undefined;
});
Step("a frozen Financial Plan named {string}", async (_, name: string) => {
  ({ offering } = await programWithOffering());
  // The staff level the AI gives its blocks, copied into the draft with the rest.
  await level("Coach");
  named[name] = await p.frozenSet(name);
});
Step(
  "a draft their AI started from {string}, with its blocks filled in and a note of what it changed",
  async (_, name: string) => {
    // As the planner's AI does it over Directus's MCP server, with the planner's own policy.
    started = await theyStart(`AI allocations ${runId}`, named[name]);
    const { id: offeringCopy, plan_id: copy } = await copyOf(offering!, started);
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
      ["plan_block_staff", { id: randomUUID(), block_id: aiBlock, staff_level_id: coach["staff_level_id"], count: 2 }],
    ] as const) {
      expectOk(await theyWrite("POST", `/items/${collection}`, { plan_id: copy, key: randomUUID(), ...data }));
    }
    expectOk(await theyWrite("PATCH", itemPath("financial_plans", started), { note: AI_NOTE }));
  },
);
Step("they freeze the draft", async () => {
  expectOk(await theyWrite("PATCH", itemPath("financial_plans", started), { status: "frozen" }));
});
Step("the draft is frozen with its blocks, its note, and its P&L", async () => {
  expect(await one("financial_plans", started, "status,note")).toEqual({ status: "frozen", note: AI_NOTE });
  expect(await one("plan_activity_blocks", aiBlock, "id")).toEqual({ id: aiBlock });
  expect((await financialPlanResults(started!)).totals).toBeDefined();
});
Step("they delete the draft", async () => {
  const { status } = await (await theirSession()).request("DELETE", itemPath("financial_plans", started));
  expect(status).toBe(204);
});
Step("the draft is gone", async () => {
  expect(await read("financial_plans", { id: { _eq: started } }, "id")).toEqual([]);
});

// A frozen Financial Plan's warnings.
Step("a draft Financial Plan whose Program Plan has a practice on August 2 with no staff", async () => {
  ({ offering } = await programWithOffering());
  await p.activities(offering, [AUGUST_2], "09:00", "12:00");
  financialPlan = await p.draftSet();
});
Step("the Financial Plan's warnings say that the practice on August 2, in its Program Plan, has no staff", async () => {
  const planner = (await userFor({ policies: ["Plan Reader"] })).session;
  const filter = encodeURIComponent(
    JSON.stringify({ financial_plan_id: { _eq: financialPlan }, code: { _eq: "unallocated_activity" } }),
  );
  // The hook writes a frozen Financial Plan's results just after the freeze answers.
  const warnings = async () =>
    planner.ok("GET", `/items/plan_result_warnings?filter=${filter}&fields=plan_id,date,category`);
  await expect
    .poll(warnings, { timeout: 60_000, interval: 1000 })
    .toEqual([{ plan_id: offering!["plan_id"], date: AUGUST_2, category: "allocation" }]);
});

// What a Plan Writer and a Plan Admin can do, and the date a Financial Plan is active from.
const ONE_PER_DATE = "Another Financial Plan for the year is already active from that date.";
const IN_FORCE_NOT_ARCHIVED = "The plan in force can't be archived";
const BONUS_IN_OPERATIONS = "A bonus goes in the Operations Plan.";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
pattern("when", new RegExp(`(?:${MONTHS.join("|")}) \\d{1,2}|today|next month|last month`));
/** A day the features name, as `YYYY-MM-DD`: a date in the plan year, or one from the database's today, in UTC. */
function dayOf(when: string): string {
  const fromToday = { today: 0, "next month": 30, "last month": -30 }[when];
  if (fromToday !== undefined) return new Date(Date.now() + fromToday * 86_400_000).toISOString().slice(0, 10);
  const [month, day] = when.split(" ");
  return `${PLAN_YEAR}-${String(MONTHS.indexOf(month!) + 1).padStart(2, "0")}-${day!.padStart(2, "0")}`;
}
/** The Financial Plan the scenario named first, which later ones start from, since a plan is in only one. */
let firstSet: string | undefined;
onEachScenario(() => {
  firstSet = undefined;
});
/** A Financial Plan named `name`, the first frozen, and each one after started from it, as the admin. */
async function aFinancialPlan(name: string, { frozen = true } = {}): Promise<string> {
  if (firstSet === undefined) {
    await p.area();
    named[name] = frozen ? await p.frozenSet(name) : await p.draftSet(name);
    firstSet = named[name];
  } else {
    named[name] = await adminStart(name, firstSet);
  }
  return named[name]!;
}
const activeFrom = async (set: string, when: string) =>
  (await admin()).ok("PATCH", itemPath("financial_plans", set), { effective_from: dayOf(when) });
/** The scenario's organization's Financial Plan in force on `when`. */
async function inForce(when: string): Promise<unknown> {
  const sets = await read(
    "financial_plans",
    { organization_id: { _eq: await p.organization() }, fiscal_year: { _eq: PLAN_YEAR } },
    "id,effective_from",
  );
  return planInForce(sets as { id: unknown; effective_from: string | null }[], dayOf(when))?.id;
}

for (const text of ["a Financial Plan named {string}, active from {when}", "one named {string}, active from {when}"]) {
  Step(text, async (_, name: string, when: string) => activeFrom(await aFinancialPlan(name), when));
}
for (const text of ["a Financial Plan named {string}, in force today", "one named {string}, in force today"]) {
  Step(text, async (_, name: string) => activeFrom(await aFinancialPlan(name), "today"));
}
Step("a draft Financial Plan named {string}", async (_, name: string) => {
  await aFinancialPlan(name, { frozen: false });
});
Step("{string} is in force on {when}", async (_, name: string, when: string) => {
  expect(await inForce(when)).toBe(named[name]);
});
Step("{string} is still in force today", async (_, name: string) => {
  expect(await inForce("today")).toBe(named[name]);
});
Step("{string} is in force from {when}", async (_, name: string, when: string) => {
  expect(await one("financial_plans", named[name], "effective_from")).toEqual({ effective_from: dayOf(when) });
  expect(await inForce(when)).toBe(named[name]);
});
Step("they make {string} active from {when}", async (_, name: string, when: string) => {
  await theyWrite("PATCH", itemPath("financial_plans", named[name]), { effective_from: dayOf(when) });
});
Step("they're told that another Financial Plan for the year is active from that date", () => expectTold(ONE_PER_DATE));

Step("a draft Financial Plan in force today, with an offering at {money} a sailor", async (_, money: string) => {
  ({ offering } = await programWithOffering(cents(money)));
  financialPlan = await p.draftSet();
  await activeFrom(financialPlan, "today");
});
Step("a draft Financial Plan in force today", async () => {
  await p.area();
  financialPlan = await p.draftSet();
  await activeFrom(financialPlan, "today");
});
Step("they change the offering's price to {money} a sailor", async (_, money: string) => {
  expectOk(await theyWrite("PATCH", itemPath("plan_offerings", offering!["id"]), { price_cents: cents(money) }));
});
Step("the draft is still in force, and its P&L has the offering at {money} a sailor", async (_, money: string) => {
  expect(await inForce("today")).toBe(financialPlan);
  // A draft's P&L is worked out again a moment after each change. The offering has 10 sailors.
  const revenue = async () => {
    const { pnl } = await financialPlanResults(financialPlan!);
    const mine = pnl.find((r) => r["level"] === "offering" && r["subject_key"] === offering!["key"]);
    return Number(mine?.["revenue_cents"]);
  };
  await expect.poll(revenue, DRAFT_RESULTS).toBe(cents(money) * 10);
});
Step("they freeze it", async () => {
  await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { status: "frozen" });
});
Step("it's frozen, and still in force", async () => {
  expectOk(attempt);
  expect(await one("financial_plans", financialPlan, "status")).toEqual({ status: "frozen" });
  expect(await inForce("today")).toBe(financialPlan);
});

Step("a frozen Financial Plan active from {when}", async (_, when: string) => {
  await p.area();
  financialPlan = await p.frozenSet();
  await activeFrom(financialPlan, when);
});
Step("they change its date to {when}", async (_, when: string) => {
  await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { effective_from: dayOf(when) });
});
Step("it's in force from {when}", async (_, when: string) => {
  expectOk(attempt);
  expect(await one("financial_plans", financialPlan, "effective_from")).toEqual({ effective_from: dayOf(when) });
});

for (const text of ["they try to archive {string}", "they archive {string}"]) {
  Step(text, async (_, name: string) => {
    await theyWrite("PATCH", itemPath("financial_plans", named[name]), { archived_at: new Date().toISOString() });
  });
}
Step("they're told that the plan in force can't be archived", () => expectTold(IN_FORCE_NOT_ARCHIVED));
Step("{string} is archived", async (_, name: string) => {
  expectOk(attempt);
  expect((await one("financial_plans", named[name], "archived_at"))["archived_at"]).not.toBeNull();
});

// What each kind of planner can change. The run's draft holds a Program Plan and an Operations Plan.
const OPERATIONS_ROWS = new Set(OPERATIONS_PLAN_ROWS);
Step("they can start a Financial Plan from another", async () => {
  await planRows();
  started = await theyStart(`Started ${runId}`, row["financial_plans@frozen"]);
  expect(await copied(started)).toHaveLength(2);
});
Step("they can change its Program Plans", async () => {
  for (const collection of PLAN_ROWS.filter((c) => !OPERATIONS_ROWS.has(c))) {
    expectOk(await theyWrite("PATCH", itemPath(collection, row[`${collection}@draft`]), change(collection)));
  }
  expectOk(await theyWrite("PATCH", itemPath("plans", row["plans@draft"]), { notes: ["Changed."] }));
});
Step("they can't change its Operations Plan", async () => {
  for (const collection of OPERATIONS_PLAN_ROWS) {
    expectRefused(await theyWrite("PATCH", itemPath(collection, row[`${collection}@draft`]), change(collection)));
  }
  expectRefused(await theyWrite("PATCH", itemPath("plans", row["plans@draft-operations"]), { notes: ["No."] }));
});
Step("they can change its Operations Plan", async () => {
  for (const collection of OPERATIONS_PLAN_ROWS) {
    expectOk(await theyWrite("PATCH", itemPath(collection, row[`${collection}@draft`]), change(collection)));
  }
  expectOk(await theyWrite("PATCH", itemPath("plans", row["plans@draft-operations"]), { notes: ["Yes."] }));
});
Step("they can't freeze it, make it active, or archive it", async () => {
  for (const write of [
    { status: "frozen" },
    { effective_from: `${PLAN_YEAR}-05-01` },
    { archived_at: new Date().toISOString() },
  ]) {
    expectRefused(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), write));
  }
  expect(await one("financial_plans", financialPlan, "status,effective_from,archived_at")).toEqual({
    status: "draft",
    effective_from: null,
    archived_at: null,
  });
});
Step("they can make it active from a date, and freeze it", async () => {
  expectOk(
    await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { effective_from: `${PLAN_YEAR}-05-01` }),
  );
  expectOk(await theyWrite("PATCH", itemPath("financial_plans", financialPlan), { status: "frozen" }));
});
Step("they can archive a Financial Plan that isn't active", async () => {
  const other = await adminStart(`Not active ${runId}`, financialPlan!);
  expectOk(await theyWrite("PATCH", itemPath("financial_plans", other), { archived_at: new Date().toISOString() }));
});

Step("they add a bonus to one of its Program Plans", async () => {
  await theyWrite("POST", "/items/plan_bonus_owners", {
    id: randomUUID(),
    plan_id: p.areaPlan(p.areas[0]!),
    key: randomUUID(),
    role_name: "Director",
    bonus_rate: 0.1,
    account_id: await p.account("bonus"),
  });
});
Step("they're told that bonuses go in the Operations Plan", () => expectTold(BONUS_IN_OPERATIONS));

// A Program Plan line that moves a cost off the area's programs, for a Plan Admin to look over.
const SHIFTS: Record<string, (area: string) => Promise<Row>> = {
  "left out of the split of shared costs": async (area) => ({
    cost_center_type: "program_area",
    cost_center_key: area,
    in_mtdc: false,
  }),
  "charged to the shared costs": async () => ({ cost_center_type: "pool", cost_center_key: await p.pool() }),
  "charged to the organization": async () => ({ cost_center_type: "org", cost_center_key: null }),
  "for capital": async () => ({ cost_center_type: "org", cost_center_key: null }),
};
parameter("shift", Object.keys(SHIFTS));
Step("a draft Financial Plan whose Program Plan has a line {shift}", async (_, shift: string) => {
  const area = await p.area();
  const account = shift === "for capital" ? "coachBoats" : "storage";
  await p.line(p.areaPlan(area), account, await SHIFTS[shift]!(area), 100_000);
});
Step("the planner is warned that the line moves a cost off the area's programs", () => {
  expect(p.warned("cost_off_programs")).toBe(true);
});
Step("a draft Financial Plan whose Operations Plan has a line left out of the split of shared costs", async () => {
  await p.area();
  await p.line(
    await p.operationsPlan(),
    "storage",
    { cost_center_type: "pool", cost_center_key: await p.pool() },
    100_000,
    { in_mtdc: false },
  );
});
Step("the planner isn't warned about the line", () => {
  expect(p.warned("cost_off_programs")).toBe(false);
});

describeAccessFeature("planning.feature");
