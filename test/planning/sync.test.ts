import { describe, expect, it } from "vitest";
import {
  catalogDifference,
  scheduleOf,
  type SyncActivity,
  type SyncInput,
  type SyncOffering,
} from "../../src/planning/index.ts";

// The plan-to-catalog sync's difference (cyc-seattle/platform#395). Every figure is made up.

const offering = (id: string, fields: Partial<SyncOffering> = {}): SyncOffering => ({
  id,
  product_id: "guppies",
  name: "Week 1",
  registration_form_id: "summer-form",
  starts_on: "2027-06-21",
  ends_on: "2027-06-25",
  capacity: 12,
  price_cents: 39_500,
  archived_at: null,
  confirmed_count: 0,
  ...fields,
});

type PlanActivityRow = SyncInput["planActivities"][number];
const practice = (date: string, start: string | null = "09:00", end: string | null = "12:00"): PlanActivityRow => ({
  id: `practice-${date}-${start}`,
  offering_id: "plan-week-1",
  date,
  start_time: start,
  end_time: end,
  kind: "practice",
});
const catalogActivity = (date: string, fields: Partial<SyncActivity> = {}): SyncActivity => ({
  id: `activity-${date}`,
  offering_id: "week-1",
  date,
  start_time: "09:00:00",
  end_time: "12:00:00",
  archived_at: null,
  ...fields,
});

function input(fields: Partial<SyncInput> = {}): SyncInput {
  return {
    financialPlan: { id: "budget", status: "frozen" },
    planOfferings: [
      {
        id: "plan-week-1",
        offering_id: "week-1",
        starts_on: "2027-06-21",
        ends_on: "2027-06-25",
        capacity: 12,
        price_cents: 39_500,
      },
    ],
    planActivities: [],
    offerings: [offering("week-1")],
    schedule: [],
    activities: [],
    ...fields,
  };
}

const differenceOf = (fields: Partial<SyncInput>) => {
  const out = catalogDifference(input(fields));
  if (out.refused) throw new Error("refused");
  return out;
};

describe("the plan-to-catalog sync", () => {
  it("refuses a draft, so the catalog never takes numbers the board didn't approve", () => {
    expect(catalogDifference(input({ financialPlan: { id: "draft", status: "draft" } }))).toEqual({ refused: "draft" });
  });

  it("shows nothing when the catalog has what the plan plans", () => {
    expect(differenceOf({})).toEqual({ offerings: [], archives: [] });
  });

  it("shows each of an offering's dates, capacity and price the plan gives another value", () => {
    const out = differenceOf({ offerings: [offering("week-1", { price_cents: 35_000, capacity: null })] });
    expect(out.offerings[0]!.fields).toEqual([
      { field: "capacity", plan: 12, catalog: null },
      { field: "price_cents", plan: 39_500, catalog: 35_000 },
    ]);
  });

  it("adds the plan's activities the catalog hasn't, changes an end time, and archives one the plan dropped", () => {
    const out = differenceOf({
      planActivities: [practice("2027-06-21"), practice("2027-06-22", "09:00", "13:00"), practice("2027-06-23")],
      activities: [
        catalogActivity("2027-06-22"),
        catalogActivity("2027-06-24"),
        catalogActivity("2027-06-23", { archived_at: "2027-01-01T00:00:00Z" }),
      ],
    });
    const [week] = out.offerings;
    expect(week!.adds).toEqual([
      {
        plan_activity_id: "practice-2027-06-21-09:00",
        date: "2027-06-21",
        start_time: "09:00:00",
        end_time: "12:00:00",
      },
    ]);
    expect(week!.changes).toEqual([
      {
        activity_id: "activity-2027-06-22",
        date: "2027-06-22",
        start_time: "09:00:00",
        end_time: { catalog: "12:00:00", plan: "13:00:00" },
        restore: false,
      },
      // An archived catalog activity the plan still has comes back.
      {
        activity_id: "activity-2027-06-23",
        date: "2027-06-23",
        start_time: "09:00:00",
        end_time: { catalog: "12:00:00", plan: "12:00:00" },
        restore: true,
      },
    ]);
    expect(week!.archives).toEqual([
      { activity_id: "activity-2027-06-24", date: "2027-06-24", start_time: "09:00:00" },
    ]);
  });

  it("lists a plan activity with no start or end time as skipped", () => {
    const out = differenceOf({ planActivities: [practice("2027-06-21", null, "12:00")] });
    expect(out.offerings[0]!.skipped).toEqual([{ plan_activity_id: "practice-2027-06-21-null", date: "2027-06-21" }]);
    expect(out.offerings[0]!.adds).toEqual([]);
  });

  it("shows the plan's schedule beside the catalog's when they differ", () => {
    const out = differenceOf({
      planActivities: [practice("2027-06-21"), practice("2027-06-23")],
      schedule: [{ id: "s", offering_id: "week-1", weekday: 1, start_time: "09:00:00", end_time: "12:00:00" }],
      activities: [catalogActivity("2027-06-21"), catalogActivity("2027-06-23")],
    });
    expect(out.offerings[0]!.schedule).toEqual({
      plan: [
        { weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
        { weekday: 3, start_time: "09:00:00", end_time: "12:00:00" },
      ],
      catalog: [{ weekday: 1, start_time: "09:00:00", end_time: "12:00:00" }],
    });
  });

  it("archives a catalog offering another of the year's Financial Plans plans, and leaves an archived one", () => {
    const out = differenceOf({
      offerings: [
        offering("week-1"),
        offering("week-9", { confirmed_count: 3 }),
        offering("gone", { archived_at: "x" }),
      ],
    });
    expect(out.archives.map((o) => [o.id, o.confirmed_count])).toEqual([["week-9", 3]]);
  });
});

describe("an offering's schedule from its plan activities", () => {
  it("takes each weekday with an activity in at least half the weeks that have any", () => {
    // Tuesdays and Thursdays for four weeks, a Saturday in two of them, and a Sunday in one.
    const days = ["06-01", "06-03", "06-08", "06-10", "06-15", "06-17", "06-22", "06-24", "06-05", "06-19", "06-27"];
    expect(scheduleOf(days.map((d) => practice(`2027-${d}`, "16:15", "19:30"))).map((d) => d.weekday)).toEqual([
      2, 4, 6,
    ]);
  });

  it("takes the start and end most of a weekday's activities share, the earlier on a tie", () => {
    const tuesdays = [
      practice("2027-06-01", "16:00", "19:00"),
      practice("2027-06-08", "16:15", "19:30"),
      practice("2027-06-15", "16:15", "19:30"),
    ];
    expect(scheduleOf(tuesdays)).toEqual([{ weekday: 2, start_time: "16:15:00", end_time: "19:30:00" }]);
    expect(scheduleOf(tuesdays.slice(0, 2))).toEqual([{ weekday: 2, start_time: "16:00:00", end_time: "19:00:00" }]);
  });

  it("leaves out travel days, and activities with no times", () => {
    expect(scheduleOf([{ ...practice("2027-06-01"), kind: "travel" }, practice("2027-06-02", null, null)])).toEqual([]);
  });
});
