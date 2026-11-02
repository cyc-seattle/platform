import { describe, it, expect, vi } from "vitest";
import { CalendarSync } from "../../../src/syncs/calendar/calendar.ts";
import type { Calendar, CalendarClient, CalendarEvent, Row, Worksheet } from "../../../src/syncs/calendar/google.ts";

type EventRowData = {
  "Event ID": string;
  "Start Date": string;
  "End Date": string;
  Calendar: string;
  Labels: string;
  Title: string;
  Location: string;
  Description: string;
};

/**
 * Minimal stand-in for a GoogleSpreadsheetRow: get/set backed by a plain object,
 * with a spyable save().
 */
function makeEventRow(data: EventRowData) {
  const store: Record<string, string> = { ...data };
  return {
    store,
    get: (key: string) => store[key] ?? "",
    set: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeWorksheet<T extends Row>(rows: unknown[]): Worksheet<T> {
  return {
    getRows: vi.fn().mockResolvedValue(rows),
  } as unknown as Worksheet<T>;
}

describe("CalendarSync.sync", () => {
  it("writes the new event ID back to the sheet when the stored ID is missing from the calendar", async () => {
    const calendarId = "cal-1";

    // A row whose Event ID points at an event that no longer exists in the calendar.
    const staleId = "stale-dead-id";
    const eventRow = makeEventRow({
      "Event ID": staleId,
      "Start Date": "7/1/2026",
      "End Date": "",
      Calendar: "Regatta",
      Labels: "",
      Title: "Race Day",
      Location: "",
      Description: "",
    });

    const newId = "freshly-minted-id";
    const createEvent = vi
      .fn()
      .mockImplementation(async (event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> => ({
        ...event,
        id: newId,
      }));
    const updateEvent = vi.fn();
    // getEvent returns null: the stored ID is not present in the calendar.
    const getEvent = vi.fn().mockResolvedValue(null);

    const calendar = {
      calendarId,
      getEvent,
      createEvent,
      updateEvent,
    } as unknown as Calendar;

    const calendarClient = {
      loadCalendar: vi.fn().mockReturnValue(calendar),
    } as unknown as CalendarClient;

    const calendarSheet = makeWorksheet([{ get: (k: string) => (k === "Name" ? "Regatta" : calendarId) }]);
    const eventsSheet = makeWorksheet([eventRow]);

    const sync = new CalendarSync(calendarClient, calendarSheet, eventsSheet);
    const result = await sync.sync();

    // Exactly one event created, none duplicated on this run.
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).not.toHaveBeenCalled();
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);

    // The sheet row was updated with the newly generated ID (the actual fix).
    expect(eventRow.set).toHaveBeenCalledWith("Event ID", newId);
    expect(eventRow.save).toHaveBeenCalledTimes(1);
    expect(eventRow.store["Event ID"]).toBe(newId);
  });

  it("updates an event the calendar has, and skips a tentative one with no start date", async () => {
    const existing = makeEventRow({
      "Event ID": "event-1",
      "Start Date": "7/1/2026",
      "End Date": "7/3/2026",
      Calendar: "Regatta",
      Labels: "Youth, Racing",
      Title: "Series",
      Location: "",
      Description: "",
    });
    const tentative = makeEventRow({ ...existing.store, "Event ID": "", "Start Date": "" } as EventRowData);
    const getEvent = vi.fn().mockResolvedValue({ id: "event-1" });
    const createEvent = vi.fn();
    const updateEvent = vi.fn().mockResolvedValue(undefined);
    const calendar = { calendarId: "cal-1", getEvent, createEvent, updateEvent } as unknown as Calendar;
    const calendarClient = { loadCalendar: vi.fn().mockReturnValue(calendar) } as unknown as CalendarClient;

    const sync = new CalendarSync(
      calendarClient,
      makeWorksheet([{ get: (k: string) => (k === "Name" ? "Regatta" : "cal-1") }]),
      makeWorksheet([existing, tentative]),
    );
    const result = await sync.sync();

    expect(result).toEqual({ created: 0, updated: 1 });
    expect(createEvent).not.toHaveBeenCalled();
    const [event] = updateEvent.mock.calls[0] as [CalendarEvent];
    expect(event.title).toBe("[Youth] [Racing] Series");
    // All-day, so the end is the morning after the last day.
    expect(event.endTime.toISODate()).toBe("2026-07-04");
    expect(existing.save).not.toHaveBeenCalled();
  });
});
