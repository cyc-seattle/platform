import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, parameter, pattern, Step, theirSession } from "./steps/index.ts";
import type { CostLine } from "../../src/planning/index.ts";
import { cents, financialPlanResults, PnlPlan, share } from "./pnl.ts";
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

// Program settings, blocks, and their warnings, which the next platform PRs build: until then, each
// of these steps fails.
parameter("program", ["Guppies", "Minnows"]);
parameter("level", ["Level 1 Instructor", "Level 2 Instructor", "Junior Instructor"]);
parameter("boats", ["Sailqubes", "Optis"]);
parameter("staff", ["one coach", "two coaches"]);
for (const text of [
  "a saved Financial Plan named {string}",
  "a saved Financial Plan named {string} where {program} have a coach for every {count} sailors",
  "they change {program} to a coach for every {count} sailors in the new Financial Plan",
  "{string} still has {program} with a coach for every {count} sailors",
  "{program} have a coach for every {count} sailors",
  "{program} have a {level} for every {count} sailors",
  "Guppies have a coach for every {count} sailors, and Minnows a coach for every {count}",
  "a {level} is qualified for everything a {level} is",
  "{boats} take {count} sailor each",
  "{boats} take {count} sailors each",
  "{boats} that cost {money} an hour on the water in upkeep",
  "RIBs that cost {money} an hour on the water",
  "the Operations Plan says the organization has {count} {boats}",
  "the Operations Plan says the organization has {count} RIBs",
  "an offering with a practice from {times}, in a block with {count} coaches paid {money} an hour",
  "an offering with a practice from {times}, in a block with {count} RIBs",
  "an offering with a practice from {times}, in a block with {count} of the organization's {boats} and {count} {boats} that sailors bring",
  "a {program} offering of {count} sailors, with a practice from {times}, in a block with {count} coach paid {money} an hour",
  "two offerings, of {count} sailors and {count} sailors, in one block from {times} with {count} coach paid {money} an hour",
  "two offerings in one block with {count} coach paid {money} an hour",
  "one practices from {times} and the other from {times}",
  "the first offering pays {money} of coaches' wages",
  "the second offering pays {money} of coaches' wages",
  "the two offerings pay {money} of coaches' wages between them",
  "the offering pays {money} for RIBs",
  "the offering pays {money} of boat upkeep",
  "the offering pays no coaches' wages",
  "an offering with {count} practices of {count} hours, each in a block the director coaches",
  "an offering with {count} practices of {count} hours, each in a block the director coaches by the hour",
  "an offering with {count} practices of {count} hours, each in a block the director coaches by the hour with a coach paid {money} an hour",
  "a director on a {money} salary, with no hourly rate to coach",
  "the planner is warned that the director has no hourly rate to coach",
  "a salaried director who coaches two blocks",
  "a salaried director who coaches three blocks",
  "both blocks run from {times} on the same day",
  "all three blocks run from {times} on the same day",
  "one block runs from {times} and the other from {times} on the same day",
  "the planner is warned that the director is coaching two blocks at once",
  "the director's blocks need {count} hours of another coach",
  "a {program} block with {count} {boats} and a {program} block with {count}, both on the morning of July 13",
  "a {program} block with {count} {boats} on the morning of July 13, and a {program} block with {count} that afternoon",
  "a block with {count} of the organization's {boats} and {count} {boats} that sailors bring",
  "the planner is warned that July 13 has {count} {boats} out, but the organization has {count}",
  "the planner isn't warned about {boats}",
  "two blocks on the morning of July 13, with {count} RIBs and {count} RIBs",
  "the planner is warned that July 13 has {count} RIBs out, but the organization has {count}",
  "a {program} block of {count} sailors with one {level} and enough boats",
  "a {program} block of {count} sailors with one Junior Instructor, who isn't qualified to coach {program}, and enough boats",
  "a block of {count} Guppies and {count} Minnows, with {staff} and enough boats",
  "a {program} block of {count} sailors with enough staff and {count} {boats}",
  "a block of {count} sailors with enough staff, {count} of the organization's {boats}, and {count} {boats} that sailors bring",
  "the planner is warned that the block has {count} sailors, but its staff can take {count}",
  "the planner is warned that the block has {count} sailors, but its boats can take {count}",
  "the planner is warned that the block has more sailors than its staff can take",
  "the planner isn't warned about the block",
  "an offering with a practice on August 2 that's in no block",
  "an offering with a practice on August 2, in a block with boats but no staff",
  "the planner is warned that the practice on August 2 has no staff",
  "a draft Financial Plan whose Program Plan has a practice on August 2 with no staff",
  "the Financial Plan's warnings say that the practice on August 2, in its Program Plan, has no staff",
  "they can write the rules for one of a Program Plan's programs",
  "a draft their AI started from {string}, with its blocks filled in and a note of what it changed",
  "they save the draft",
  "the draft is saved with its blocks, its note, and its P&L",
  "they delete the draft",
  "the draft is gone",
]) {
  Step(text, () => {
    throw new Error("Not built yet: program settings and blocks");
  });
}

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

// An offering's catalog offering, and its activities, in a Financial Plan started from it.
Step(
  "a saved Financial Plan named {string} with an offering of {string}",
  async (_, name: string, catalogName: string) => {
    const area = await p.area();
    const product = await p.product("program", area);
    const [program] = await read("programs", { product_id: { _eq: product } }, "id");
    const catalog = await adminCreate("catalog_offerings", {
      id: randomUUID(),
      program_id: program!["id"],
      name: `${catalogName} ${runId}`,
    });
    offering = await p.offering(p.areaVersion(area), product, 100_000, 10, 0, { catalog_offering_id: catalog.id });
    named[name] = await p.savedSet(name);
  },
);
Step("the new Financial Plan's offering is of {string} too", async (_, catalogName: string) => {
  const copy = await copyOf(offering!, started!);
  expect(copy["catalog_offering_id"]).toBe(offering!["catalog_offering_id"]);
  expect(await one("catalog_offerings", copy["catalog_offering_id"], "name")).toEqual({
    name: `${catalogName} ${runId}`,
  });
});
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

describeAccessFeature("planning.feature");
