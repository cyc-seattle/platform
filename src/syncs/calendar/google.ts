// The parts of gsuite-sdk's calendar.ts and spreadsheet.ts this sync uses, so gsuite-sdk can drop them.
import { GoogleSpreadsheet, type GoogleSpreadsheetRow, type GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { type Auth, type calendar_v3, google } from "googleapis";
import { DateTime } from "luxon";
import winston from "winston";
import { getHttpStatus, safeCall } from "@cyc-seattle/gsuite-sdk";

export type Row = Record<string, string>;

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: DateTime;
  endTime: DateTime;
  allDay: boolean;
  description?: string;
  location?: string;
}

export class CalendarClient {
  private readonly client: calendar_v3.Calendar;

  constructor(auth: Auth.GoogleAuth) {
    this.client = google.calendar({ version: "v3", auth });
  }

  loadCalendar(calendarId: string): Calendar {
    return new Calendar(this.client, calendarId);
  }
}

export class Calendar {
  private readonly client: calendar_v3.Calendar;
  readonly calendarId: string;

  constructor(client: calendar_v3.Calendar, calendarId: string) {
    this.client = client;
    this.calendarId = calendarId;
  }

  /** The event, or null if it doesn't exist or was cancelled. */
  async getEvent(eventId: string): Promise<CalendarEvent | null> {
    try {
      const { data } = await safeCall(() => this.client.events.get({ calendarId: this.calendarId, eventId }));
      return data.id && data.status !== "cancelled" ? fromGoogleEvent(data) : null;
    } catch (error) {
      if (getHttpStatus(error) === 404) {
        return null;
      }
      throw error;
    }
  }

  async createEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
    const { data } = await safeCall(() =>
      this.client.events.insert({ calendarId: this.calendarId, requestBody: toGoogleEvent(event) }),
    );
    if (!data.id) {
      throw new Error("Failed to create event: no ID returned");
    }
    winston.info("Created calendar event", { eventId: data.id });
    return fromGoogleEvent(data);
  }

  async updateEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const { data } = await safeCall(() =>
      this.client.events.update({ calendarId: this.calendarId, eventId: event.id, requestBody: toGoogleEvent(event) }),
    );
    if (!data.id) {
      throw new Error("Failed to update event: no ID returned");
    }
    winston.info("Updated calendar event", { eventId: data.id });
    return fromGoogleEvent(data);
  }
}

function fromGoogleEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  const allDay = !event.start?.dateTime;
  const calendarEvent: CalendarEvent = {
    id: event.id ?? "",
    title: event.summary ?? "Untitled Event",
    startTime: DateTime.fromISO((allDay ? event.start?.date : event.start?.dateTime) ?? ""),
    endTime: DateTime.fromISO((allDay ? event.end?.date : event.end?.dateTime) ?? ""),
    allDay,
  };
  if (event.description) {
    calendarEvent.description = event.description;
  }
  if (event.location) {
    calendarEvent.location = event.location;
  }
  return calendarEvent;
}

function toGoogleEvent(event: Omit<CalendarEvent, "id">): calendar_v3.Schema$Event {
  return {
    summary: event.title,
    description: event.description ?? null,
    location: event.location ?? null,
    start: event.allDay ? { date: event.startTime.toISODate() } : { dateTime: event.startTime.toISO() },
    end: event.allDay ? { date: event.endTime.toISODate() } : { dateTime: event.endTime.toISO() },
  };
}

export class Worksheet<T extends Row> {
  private readonly worksheet: GoogleSpreadsheetWorksheet;

  constructor(worksheet: GoogleSpreadsheetWorksheet) {
    this.worksheet = worksheet;
  }

  async getRows(): Promise<GoogleSpreadsheetRow<T>[]> {
    return safeCall(() => this.worksheet.getRows<T>());
  }
}

/** Loads a spreadsheet by its ID or its URL. */
export async function loadSpreadsheet(auth: Auth.GoogleAuth, urlOrId: string): Promise<GoogleSpreadsheet> {
  const spreadsheet = new GoogleSpreadsheet(spreadsheetId(urlOrId), auth);
  await safeCall(() => spreadsheet.loadInfo());
  return spreadsheet;
}

function spreadsheetId(urlOrId: string): string {
  if (!URL.canParse(urlOrId)) {
    return urlOrId;
  }
  // https://docs.google.com/spreadsheets/d/<id>/edit
  const id = new URL(urlOrId).pathname.split("/")[3];
  if (!id) {
    throw new Error(`Cannot extract spreadsheet ID from ${urlOrId}`);
  }
  return id;
}

export async function getOrCreateWorksheet<T extends Row>(
  spreadsheet: GoogleSpreadsheet,
  title: string,
  headerValues: Extract<keyof T, string>[],
): Promise<Worksheet<T>> {
  const worksheet =
    spreadsheet.sheetsByTitle[title] ??
    (await safeCall(() =>
      spreadsheet.addSheet({ title, headerValues, gridProperties: { rowCount: 1, columnCount: headerValues.length } }),
    ));
  return new Worksheet<T>(worksheet);
}
