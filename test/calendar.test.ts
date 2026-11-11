import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

interface Field {
  collection: string;
  field: string;
  meta: { options: { choices?: { value: string }[] } | null };
}

interface Relation {
  collection: string;
  field: string;
  schema: { on_delete: string } | null;
}

const calendar = yaml.load(fs.readFileSync(path.join(import.meta.dirname, "../schemas/calendar.yaml"), "utf8")) as {
  fields: Field[];
  relations: Relation[];
};

describe("the calendar", () => {
  it("stores only confirmed and cancelled events, since projected and last year's are worked out on read", () => {
    const status = calendar.fields.find(({ collection, field }) => collection === "events" && field === "status")!;
    expect(status.meta.options?.choices?.map(({ value }) => value)).toEqual(["confirmed", "cancelled"]);
  });

  it("keeps a row from being deleted while the calendar refers to it, but drops an event's boat classes with it", () => {
    const onDelete = Object.fromEntries(
      calendar.relations.map((relation) => [`${relation.collection}.${relation.field}`, relation.schema?.on_delete]),
    );
    expect(onDelete).toEqual({
      "calendar_dates.calendar_id": "RESTRICT",
      "events.organizer_id": "RESTRICT",
      "events.series_id": "RESTRICT",
      "events.venue_id": "RESTRICT",
      "event_series.organizer_id": "RESTRICT",
      "events_boat_classes.boat_class_id": "RESTRICT",
      "events_boat_classes.event_id": "CASCADE",
    });
  });
});
