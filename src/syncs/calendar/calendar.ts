import type { GoogleSpreadsheetRow } from "google-spreadsheet";
import type { Auth } from "googleapis";
import { DateTime } from "luxon";
import winston from "winston";
import {
  type Calendar,
  CalendarClient,
  type CalendarEvent,
  getOrCreateWorksheet,
  loadSpreadsheet,
  type Worksheet,
} from "./google.ts";

/** A row of the Calendars worksheet. */
type CalendarRow = {
  Name: string;
  ID: string;
};

/** A row of the Events worksheet. */
type EventRow = {
  "Event ID": string;
  "Start Date": string;
  "End Date": string;
  Calendar: string;
  Labels: string;
  Title: string;
  Location: string;
  Description: string;
};

/** `["Camp", "Session A"]` and "Event Name" make "[Camp] [Session A] Event Name". */
function formatTitleWithLabels(title: string, labels?: string): string {
  const labelArray = (labels ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
  return labelArray.length === 0 ? title : `${labelArray.map((label) => `[${label}]`).join(" ")} ${title}`;
}

class CalendarEventData {
  readonly eventRow: GoogleSpreadsheetRow<EventRow>;
  readonly event: CalendarEvent;
  readonly calendarName: string;

  constructor(eventRow: GoogleSpreadsheetRow<EventRow>) {
    this.eventRow = eventRow;
    const startTime = DateTime.fromFormat(eventRow.get("Start Date"), "M/d/yyyy");
    const endDate = eventRow.get("End Date");
    // A blank End Date is a one-day event. An all-day event's end is exclusive: midnight after.
    const endTime = (endDate && endDate.trim() !== "" ? DateTime.fromFormat(endDate, "M/d/yyyy") : startTime).plus({
      days: 1,
    });

    this.calendarName = eventRow.get("Calendar");
    this.event = {
      id: eventRow.get("Event ID") || "",
      title: formatTitleWithLabels(eventRow.get("Title"), eventRow.get("Labels")),
      startTime,
      endTime,
      allDay: true,
      description: eventRow.get("Description"),
      location: eventRow.get("Location"),
    };
  }
}

export interface SyncResult {
  created: number;
  updated: number;
}

/** Loads the spreadsheet's two worksheets, creating either that's missing. */
export async function loadCalendarSync(
  auth: Auth.GoogleAuth,
  spreadsheetId: string,
  calendarsWorksheet = "Calendars",
  eventsWorksheet = "Events",
): Promise<CalendarSync> {
  const spreadsheet = await loadSpreadsheet(auth, spreadsheetId);
  winston.info("Spreadsheet loaded", { title: spreadsheet.title });
  const calendarSheet = await getOrCreateWorksheet<CalendarRow>(spreadsheet, calendarsWorksheet, ["Name", "ID"]);
  const eventsSheet = await getOrCreateWorksheet<EventRow>(spreadsheet, eventsWorksheet, [
    "Event ID",
    "Start Date",
    "End Date",
    "Calendar",
    "Labels",
    "Title",
    "Location",
    "Description",
  ]);
  return new CalendarSync(new CalendarClient(auth), calendarSheet, eventsSheet);
}

/** Syncs a spreadsheet's events, one way, into the calendars it names. */
export class CalendarSync {
  private readonly calendarClient: CalendarClient;
  private readonly calendarSheet: Worksheet<CalendarRow>;
  private readonly eventsSheet: Worksheet<EventRow>;

  constructor(calendarClient: CalendarClient, calendarSheet: Worksheet<CalendarRow>, eventsSheet: Worksheet<EventRow>) {
    this.calendarClient = calendarClient;
    this.calendarSheet = calendarSheet;
    this.eventsSheet = eventsSheet;
  }

  /** The Calendars worksheet's calendars, by name. */
  private async listCalendars(): Promise<Map<string, Calendar>> {
    const calendars = new Map<string, Calendar>();
    for (const row of await this.calendarSheet.getRows()) {
      const name = row.get("Name");
      const id = row.get("ID");
      if (name && id) {
        calendars.set(name, this.calendarClient.loadCalendar(id));
      }
    }
    winston.info(`Found ${calendars.size} calendars in spreadsheet`);
    return calendars;
  }

  private async listEvents(): Promise<CalendarEventData[]> {
    const events: CalendarEventData[] = [];
    for (const row of await this.eventsSheet.getRows()) {
      const startDate = row.get("Start Date");
      const title = row.get("Title");
      const calendar = row.get("Calendar");
      // A blank Start Date marks a tentative event.
      if (!startDate || startDate.trim() === "") {
        winston.debug("Skipping tentative event (blank Start Date)", { title });
        continue;
      }
      if (!title || !calendar) {
        winston.debug("Skipping event with missing title or calendar", { title, calendar });
        continue;
      }
      events.push(new CalendarEventData(row));
    }
    winston.info(`Found ${events.length} events in spreadsheet`);
    return events;
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };
    const calendars = await this.listCalendars();
    const events = await this.listEvents();
    if (calendars.size === 0) {
      winston.warn("No calendars found in Calendars worksheet");
      return result;
    }

    for (const eventData of events) {
      const calendar = calendars.get(eventData.calendarName);
      if (!calendar) {
        winston.warn("Calendar not found for event", { calendar: eventData.calendarName, event: eventData.event.id });
        continue;
      }
      await this.syncEvent(calendar, eventData, result);
    }

    winston.info("Sync operation completed", { result });
    return result;
  }

  private async syncEvent(calendar: Calendar, eventData: CalendarEventData, result: SyncResult): Promise<void> {
    const { event } = eventData;
    if (event.id.trim() !== "" && (await calendar.getEvent(event.id))) {
      await calendar.updateEvent(event);
      result.updated++;
      return;
    }
    // A blank Event ID is a new event. An ID the calendar doesn't have is recreated, under the new ID
    // Google mints, so write it back, or every later sync would create the event again.
    const created = await calendar.createEvent(event);
    eventData.eventRow.set("Event ID", created.id);
    await eventData.eventRow.save();
    result.created++;
  }
}
