import { expect } from "vitest";
import { describeAccessFeature, expectRefusal, onEachScenario, parameter, Step } from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, newRow, runRows, type Row } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

/** An event's details, in calendar.feature's words. */
const DETAILS: Record<string, string> = { "start date": "starts_on", organizer: "organizer_id" };
parameter("eventDetail", Object.keys(DETAILS));

/** Adds `data` as an event, and expects the calendar to refuse it as invalid. */
async function addsEvent(data: Row): Promise<void> {
  const { status } = await (await admin()).request("POST", "/items/events", data);
  if (status < 300) {
    created.push({ collection: "events", id: data["id"] });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
}

Step("an admin adds an event with no {eventDetail}", async (_, detail: string) => {
  await runRows();
  await addsEvent({ ...(await newRow("events")), [DETAILS[detail]!]: null });
});
Step("an admin adds an event marked as projected", async () => {
  await runRows();
  await addsEvent(await newRow("events", { status: "projected" }));
});

let target: { collection: string; id: string } | undefined;
let eventId: string | undefined;
let boatClassId: string | undefined;
onEachScenario(() => {
  target = undefined;
  eventId = undefined;
  boatClassId = undefined;
});

const event = async (fixed: Row = {}) => (await adminCreate("events", await newRow("events", fixed))).id;

/** Each thing in use, and how to make it, with what uses it, so it's this scenario's own. */
const IN_USE: Record<string, () => Promise<{ collection: string; id: string }>> = {
  "an organizer that runs an event": async () => {
    const id = (await adminCreate("organizations", await newRow("organizations"))).id;
    await event({ organizer_id: id });
    return { collection: "organizations", id };
  },
  "a venue an event is sailed at": async () => {
    const id = (await adminCreate("venues", await newRow("venues"))).id;
    await event({ venue_id: id });
    return { collection: "venues", id };
  },
  "a series with an event in it": async () => {
    const id = (await adminCreate("event_series", await newRow("event_series"))).id;
    await event({ series_id: id });
    return { collection: "event_series", id };
  },
  "a boat class an event is for": async () => {
    const id = (await adminCreate("boat_classes", await newRow("boat_classes"))).id;
    await adminCreate("events_boat_classes", await newRow("events_boat_classes", { boat_class_id: id }));
    return { collection: "boat_classes", id };
  },
  "a calendar with a date on it": async () => {
    const id = (await adminCreate("calendars", await newRow("calendars"))).id;
    await adminCreate("calendar_dates", await newRow("calendar_dates", { calendar_id: id }));
    return { collection: "calendars", id };
  },
};
parameter("inUse", Object.keys(IN_USE));

Step("{inUse}", async (_, thing: string) => {
  await runRows();
  target = await IN_USE[thing]!();
});
// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes it", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath(target!.collection, target!.id));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("it's still there", async () => {
  await (await admin()).ok("GET", itemPath(target!.collection, target!.id));
});

Step("an event for a boat class", async () => {
  await runRows();
  boatClassId = (await adminCreate("boat_classes", await newRow("boat_classes"))).id;
  eventId = await event();
  await adminCreate(
    "events_boat_classes",
    await newRow("events_boat_classes", { event_id: eventId, boat_class_id: boatClassId }),
  );
});
Step("an admin deletes the event", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("events", eventId));
  expect(status).toBe(204);
});
Step("the event is gone", async () => {
  const { status } = await (await admin()).request("GET", itemPath("events", eventId));
  expect(status).toBe(403);
});
Step("the boat class is still in the catalog", async () => {
  await (await admin()).ok("GET", itemPath("boat_classes", boatClassId));
});

describeAccessFeature("calendar.feature");
