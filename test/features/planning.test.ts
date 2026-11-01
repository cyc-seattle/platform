import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, parameter, pattern, Step, theirSession } from "./steps/index.ts";
import { notBuilt } from "./steps/logins.ts";
import type { CostLine } from "../../src/planning/index.ts";
import { cents, PnlPlan, share } from "./pnl.ts";
import {
  admin,
  adminCreate,
  adminSave,
  created,
  fixture,
  itemPath,
  newRow,
  PLAN_ROWS,
  planRows,
  row,
  saving,
  runRows,
  type Row,
} from "./steps/rows.ts";

// The active version for a program area and year, or for the Operations Plan, is the last
// activation across those plans (docs/planning-schema.md).

let planId: string | undefined;
let versionIds: string[] = [];
onEachScenario(() => {
  planId = undefined;
  versionIds = [];
});

/** A new plan for the run's product, made by the admin, with `saved` saved versions and then a draft. */
async function aPlan(saved: number, draft: boolean): Promise<void> {
  await runRows();
  planId = (await adminCreate("plans", await newRow("plans"))).id;
  for (let i = 0; i < saved; i++) {
    const { id } = await adminCreate("plan_versions", await newRow("plan_versions", { plan_id: planId }));
    await adminSave(id);
    versionIds.push(id);
  }
  if (draft) {
    const { id } = await adminCreate("plan_versions", await newRow("plan_versions", { plan_id: planId }));
    versionIds.push(id);
  }
}

async function versionsOf(plan: string, status: string): Promise<Row[]> {
  const filter = encodeURIComponent(JSON.stringify({ plan_id: { _eq: plan }, status: { _eq: status } }));
  return (await admin()).ok("GET", `/items/plan_versions?filter=${filter}&fields=id,status`);
}

async function activeVersion(plan: string): Promise<unknown> {
  const filter = encodeURIComponent(JSON.stringify({ plan_id: { _eq: plan } }));
  const [newest] = await (
    await admin()
  ).ok("GET", `/items/plan_activations?filter=${filter}&sort=-sequence&limit=1&fields=version_id`);
  return newest?.version_id;
}

/** Makes a saved version active as "they", and checks it's now the plan's active one. */
async function activate(versionId: string): Promise<void> {
  const id = randomUUID();
  const { status, body } = await (
    await theirSession()
  ).request("POST", "/items/plan_activations", { id, version_id: versionId });
  if (status < 300) {
    created.push({ collection: "plan_activations", id });
  }
  expect(status, JSON.stringify(body)).toBe(200);
  expect(await activeVersion(body.data.plan_id)).toBe(versionId);
}

Step("they start a plan for a program area", async () => {
  await runRows();
  const plan = await newRow("plans");
  const draft = { id: randomUUID(), status: "draft" };
  const { status, body } = await (await theirSession()).request("POST", "/items/plans", { ...plan, versions: [draft] });
  if (status < 300) {
    // Cleanup deletes the newest first, so the draft goes after its plan.
    created.push({ collection: "plans", id: plan["id"] }, { collection: "plan_versions", id: draft.id });
  }
  expect(status, JSON.stringify(body)).toBe(200);
  planId = plan["id"] as string;
});
Step("the plan has a draft they can change", async () => {
  const [draft, ...others] = await versionsOf(planId!, "draft");
  expect(others).toEqual([]);
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", draft!["id"]), { message: "A first draft." });
  expect(status, JSON.stringify(body)).toBe(200);
});
Step("the plan has no saved versions yet", async () => {
  expect(await versionsOf(planId!, "saved")).toEqual([]);
});

Step("a plan with two saved versions, the first of them active", async () => {
  await aPlan(2, false);
  await adminCreate("plan_activations", { id: randomUUID(), version_id: versionIds[0] });
  expect(await activeVersion(planId!)).toBe(versionIds[0]);
});
Step("they make the second version active", () => activate(versionIds[1]!));
Step("only the second version is active", async () => {
  expect(await activeVersion(planId!)).toBe(versionIds[1]);
});

// The run's plan, which the admin started.
Step("a plan someone else started", () => planRows());

Step("a plan with a draft", () => aPlan(0, true));
Step("they can save the draft as a version", async () => {
  const draft = versionIds[0]!;
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", draft), { ...(await saving()), message: "Ready for the board." });
  expect(status, JSON.stringify(body)).toBe(200);
  const saved = await (await admin()).ok("GET", `${itemPath("plan_versions", draft)}?fields=status,saved_by,saved_at`);
  const me = await (await theirSession()).ok("GET", "/users/me?fields=id");
  expect(saved).toMatchObject({ status: "saved", saved_by: me.id, saved_at: expect.any(String) });
});
Step("they can make a saved version active", () => activate(versionIds[0]!));

Step("they can't copy a draft's changes into a saved version", async () => {
  await planRows();
  const user = await theirSession();
  for (const collection of PLAN_ROWS) {
    const draft = Object.fromEntries(
      Object.entries(fixture[`${collection}@draft`]!).filter(([field]) => !["id", "version_id", "key"].includes(field)),
    );
    const { status, body } = await user.request("PATCH", itemPath(collection, row[`${collection}@saved`]), draft);
    expect(status, `${collection}: ${JSON.stringify(body)}`).toBe(403);
  }
});
Step("they can't turn a saved version back into a draft", async () => {
  await planRows();
  const saved = row["plan_versions@saved"];
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", saved), { status: "draft" });
  expect(status, JSON.stringify(body)).toBe(403);
  expect(body.errors?.[0]?.message).toBe("A saved plan version can't be changed. Make a new draft from it.");
  const { status: now } = await (await admin()).ok("GET", `${itemPath("plan_versions", saved)}?fields=status`);
  expect(now).toBe("saved");
});

// A plan's rules: the planner's own words, which a saved version keeps.
Step("they can write the draft's rules", async () => {
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", versionIds[0]), { rules: "Practice on Mondays and Fridays." });
  expect(status, JSON.stringify(body)).toBe(200);
});
Step("a plan with a saved version that has rules", async () => {
  await aPlan(1, false);
  const { rules } = await (await admin()).ok("GET", `${itemPath("plan_versions", versionIds[0])}?fields=rules`);
  expect(rules).toBeTruthy();
});
Step("they can't change the saved version's rules", async () => {
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", versionIds[0]), { rules: "Practice every day." });
  expect(status, JSON.stringify(body)).toBe(403);
});

/** Two plans for one program area and year, each with a saved version, the first of them active. */
let rivals: { plans: string[]; versions: string[] } = { plans: [], versions: [] };
Step("two plans for a program area this year, the first of them active", async () => {
  await runRows();
  const area = await adminCreate("program_areas", await newRow("program_areas"));
  rivals = { plans: [], versions: [] };
  for (let i = 0; i < 2; i++) {
    const plan = await adminCreate("plans", await newRow("plans", { program_area_id: area.id }));
    const { id } = await adminCreate("plan_versions", await newRow("plan_versions", { plan_id: plan.id }));
    await adminSave(id);
    rivals.plans.push(plan.id);
    rivals.versions.push(id);
  }
  await adminCreate("plan_activations", { id: randomUUID(), version_id: rivals.versions[0] });
});
Step("they make a saved version of the second plan active", () => activate(rivals.versions[1]!));

/** The newest activation across the program area's plans for the year. */
async function areaActivation(): Promise<Row | undefined> {
  const filter = encodeURIComponent(JSON.stringify({ plan_id: { _in: rivals.plans } }));
  const [newest] = await (
    await admin()
  ).ok("GET", `/items/plan_activations?filter=${filter}&sort=-sequence&limit=1&fields=plan_id,version_id`);
  return newest;
}
Step("the second plan is the program area's plan for the year", async () => {
  expect(await areaActivation()).toEqual({ plan_id: rivals.plans[1], version_id: rivals.versions[1] });
});
Step("the first plan has no active version", async () => {
  expect((await areaActivation())?.["plan_id"]).not.toBe(rivals.plans[0]);
});

// The P&L examples' plans, made fresh for each one.
let p = new PnlPlan();
onEachScenario(() => {
  p = new PnlPlan();
});
const first = () => p.offerings[0]!["key"];
const second = () => p.offerings[1]!["key"];
const onOffering = (key: unknown, account: string) => (l: CostLine) =>
  l.cost_center_type === "offering" && l.cost_center_key === key && l.account_id === account;

Step("a plan for a program area", () => p.area());
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
Step("the club-wide totals include {money} of merchandise sales", async (_, money: string) => {
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
Step("the club-wide totals show {money} of capital", (_, money: string) => {
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
Step("the club-wide totals are:", (_, table: { line: string; amount: string }[]) => {
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
parameter("coaches", ["half a coach", "a whole coach"]);
pattern("times", /\d+(?:am|pm) to (?:noon|\d+(?:am|pm))/);
for (const text of [
  "a program area's plan that pays its director {percent} of its programs' net",
  "its programs make {money} after their costs and shared costs",
  "the director's bonus is {money}",
  "a program area's plan that pays its director a bonus on a program from another program area",
  "the planner is warned that the bonus is on another program area's program",
  "the other area's program doesn't count toward the bonus",
  "a director who earns {percent} of their programs' net {counted}",
  "their programs take in {money} and cost {money}, plus {money} of shared costs",
  "payroll tax at {percent} of wages",
  "a director whose bonus is {money}",
  "the club pays {money} of payroll tax on the bonus",
  "a director's bonus, with its payroll tax, on the first offering only",
  "a salaried director paid {money} an hour",
  "an offering they coach, with {count} practices of {count} hours",
  "the offering pays {money} of the director's salary",
  "a director on a {money} salary",
  "an offering they coach for {money} an hour, with {count} practices of {count} hours",
  "the offering pays {money} of coaches' wages",
  "the offering pays none of the director's salary",
  "a bonus for the director that comes to {money}",
  "the director's pay for the year is:",
  "a salaried director who coaches two groups that don't share coaches",
  "both groups practice from {times} on the same day",
  "one group practices from {times} and the other from {times} on the same day",
  "the planner is warned that the director is coaching two groups at once",
  "the planner isn't warned about the director",
  "two offerings of {count} sailors each, with a coach for every {count} sailors, that share coaches on Wednesdays",
  "one practices from {times} and the other from {times} on the same Wednesday",
  "each offering pays for {coaches}",
  "the Operations Plan closes the club on Labor Day",
  "an offering with a practice on Labor Day",
  "the planner is warned that the practice is on a day the club is closed",
  "a draft of a program area's plan whose offering takes in {money}",
  "they save the draft as a version",
  "the saved version's P&L shows that the offering takes in {money}",
  "a saved version of a program area's plan whose offering pays {money} of office costs",
  "a planner saves an Operations Plan with {money} of office costs, and makes it active",
  "the saved version's P&L still shows that the offering pays {money} of office costs",
  "another program area's active plan, with the same direct costs as this area's draft",
  "the saved version's P&L shows that the offering pays {money} of the office costs",
  "they can't change a saved version's P&L",
  "they can't add a P&L to a draft",
]) {
  Step(text, () => notBuilt("12c"));
}

describeAccessFeature("planning.feature");
