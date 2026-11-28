import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { catalogDifference, type CatalogDifference } from "../../src/planning/index.ts";
import { cents, PnlPlan } from "./pnl.ts";
import { describeAccessFeature, onEachScenario, Step } from "./steps/index.ts";
import { admin, adminCreate, type Item, key, PLAN_YEAR, type Row } from "./steps/rows.ts";

// The plan-to-catalog sync's difference (cyc-seattle/platform#395), from the rows a scenario makes in Directus.

let p = new PnlPlan();
let offering: Item | undefined;
let others: string[] = [];
let difference: CatalogDifference | undefined;
onEachScenario(() => {
  p = new PnlPlan();
  offering = undefined;
  others = [];
  difference = undefined;
});

const day = (monthDay: string) => `${PLAN_YEAR}-${monthDay}`;
const june = (date: number) => day(`06-${String(date).padStart(2, "0")}`);

const read = async (collection: string, filter: object, fields = "*"): Promise<Row[]> =>
  (await admin()).ok(
    "GET",
    `/items/${collection}?limit=-1&fields=${fields}&filter=${encodeURIComponent(JSON.stringify(filter))}`,
  );

async function planned(price: number): Promise<Item> {
  const area = await p.area();
  offering = await p.offering(p.areaPlan(area), await p.product("program", area), price, 10, 0, {
    starts_on: day("06-01"),
    ends_on: day("06-30"),
  });
  return offering;
}

async function practices(dates: string[], times: [string | null, string | null] = ["09:00", "12:00"]) {
  for (const date of dates) {
    await adminCreate("plan_activities", {
      id: randomUUID(),
      plan_id: offering!["plan_id"],
      offering_id: offering!["id"],
      date,
      start_time: times[0],
      end_time: times[1],
      kind: "practice",
      uses_boats: false,
    });
  }
}

Step("a frozen Financial Plan that plans an offering at {money} a sailor", async (_, money: string) => {
  await planned(cents(money));
  await p.frozenSet();
});
Step("a draft Financial Plan that plans an offering at {money} a sailor", async (_, money: string) => {
  await planned(cents(money));
  await p.draftSet();
});
Step("its catalog offering is {money} a sailor", async (_, money: string) => {
  await (await admin()).ok("PATCH", `/items/offerings/${offering!["offering_id"]}`, { price_cents: cents(money) });
});
Step(
  "a frozen Financial Plan that plans an offering with practices on June {int} and June {int}",
  async (_, d1: number, d2: number) => {
    await planned(39_500);
    await practices([june(d1), june(d2)]);
    await p.frozenSet();
  },
);
Step(
  "a frozen Financial Plan that plans an offering with a practice on June {int} with no times",
  async (_, date: number) => {
    await planned(39_500);
    await practices([june(date)], [null, null]);
    await p.frozenSet();
  },
);
Step(
  "a frozen Financial Plan that plans an offering with practices every Tuesday and Thursday for four weeks",
  async () => {
    await planned(39_500);
    // The first Tuesday of June, and the three after it.
    const first = new Date(Date.UTC(PLAN_YEAR, 5, 1));
    first.setUTCDate(1 + ((2 - first.getUTCDay() + 7) % 7));
    const dates = [0, 7, 14, 21].flatMap((weeks) =>
      [0, 2].map((plus) => {
        const d = new Date(first);
        d.setUTCDate(first.getUTCDate() + weeks + plus);
        return d.toISOString().slice(0, 10);
      }),
    );
    await practices(dates, ["16:15", "19:30"]);
  },
);
Step("a practice on one Saturday", async () => {
  const saturday = new Date(Date.UTC(PLAN_YEAR, 5, 1));
  saturday.setUTCDate(1 + ((6 - saturday.getUTCDay() + 7) % 7));
  await practices([saturday.toISOString().slice(0, 10)], ["10:00", "14:00"]);
  await p.frozenSet();
});
Step("its catalog offering has a practice on June {int}", async (_, date: number) => {
  await adminCreate("activities", {
    id: randomUUID(),
    offering_id: offering!["offering_id"],
    date: june(date),
    start_time: "09:00",
    end_time: "12:00",
  });
});
Step("another of the year's Financial Plans plans another offering", async () => {
  const other = await adminCreate("offerings", {
    id: randomUUID(),
    product_id: offering!["product_id"],
    name: `Week ${key("week")}`,
  });
  const set = await adminCreate("financial_plans", {
    id: randomUUID(),
    organization_id: await p.organization(),
    fiscal_year: PLAN_YEAR,
    name: `Another ${key("set")}`,
  });
  const plan = await adminCreate("plans", { id: randomUUID(), financial_plan_id: set.id, kind: "operations" });
  await adminCreate("plan_offerings", {
    id: randomUUID(),
    plan_id: plan.id,
    offering_id: other.id,
    starts_on: day("07-01"),
    ends_on: day("07-05"),
  });
  others.push(other.id);
});

Step("the sync compares the plan with the catalog", async () => {
  const [set] = await read("financial_plans", { id: { _eq: await setOf() } });
  const year = await read("financial_plans", {
    organization_id: { _eq: set!["organization_id"] },
    fiscal_year: { _eq: PLAN_YEAR },
  });
  const plans = await read("plans", { financial_plan_id: { _in: year.map((s) => s["id"]) } });
  const inForce = plans.filter((plan) => plan["financial_plan_id"] === set!["id"]).map((plan) => plan["id"]);
  const allPlanOfferings = await read("plan_offerings", { plan_id: { _in: plans.map((plan) => plan["id"]) } });
  const offeringIds = [...new Set(allPlanOfferings.map((o) => o["offering_id"]))];
  difference = catalogDifference({
    financialPlan: { id: set!["id"] as string, status: set!["status"] as "draft" | "frozen" },
    planOfferings: allPlanOfferings.filter((o) => inForce.includes(o["plan_id"])) as never,
    planActivities: (await read("plan_activities", { plan_id: { _in: inForce } })) as never,
    offerings: (await read("offerings", { id: { _in: offeringIds } })) as never,
    schedule: (await read("offering_schedule", { offering_id: { _in: offeringIds } })) as never,
    activities: (await read("activities", { offering_id: { _in: offeringIds } })) as never,
  });
});
async function setOf(): Promise<string> {
  const [plan] = await read("plans", { id: { _eq: offering!["plan_id"] } }, "financial_plan_id");
  return plan!["financial_plan_id"] as string;
}

const theOffering = () => {
  if (difference === undefined || difference.refused) throw new Error("The sync refused.");
  return difference.offerings.find((o) => o.offering.id === offering!["offering_id"])!;
};

Step("it shows the offering's price changing from {money} to {money}", (_, was: string, now: string) => {
  expect(theOffering().fields).toContainEqual({ field: "price_cents", plan: cents(now), catalog: cents(was) });
});
Step("it adds the practices on June {int} and June {int}", (_, d1: number, d2: number) => {
  expect(theOffering().adds.map((a) => a.date)).toEqual([june(d1), june(d2)]);
});
Step("it archives the practice on June {int}", (_, date: number) => {
  expect(theOffering().archives.map((a) => a.date)).toEqual([june(date)]);
});
Step("it skips the practice on June {int}", (_, date: number) => {
  expect(theOffering().skipped.map((a) => a.date)).toEqual([june(date)]);
  expect(theOffering().adds).toEqual([]);
});
Step("it shows the offering's schedule as Tuesdays and Thursdays", () => {
  expect(theOffering().schedule?.plan).toEqual([
    { weekday: 2, start_time: "16:15:00", end_time: "19:30:00" },
    { weekday: 4, start_time: "16:15:00", end_time: "19:30:00" },
  ]);
});
Step("it refuses, since the plan is a draft", () => {
  expect(difference).toEqual({ refused: "draft" });
});
Step("it archives the other offering", () => {
  if (difference === undefined || difference.refused) throw new Error("The sync refused.");
  expect(difference.archives.map((o) => o.id)).toEqual(others);
});

describeAccessFeature("plan-to-catalog.feature");
