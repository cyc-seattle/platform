import { describe, it, expect } from "vitest";
import { directusEditTimes, type FieldRevision } from "../../../src/syncs/clubspot/edit-times.ts";

function revision(id: number, user: string | null, timestamp: string, delta: Record<string, unknown>): FieldRevision {
  return { id, delta, activity: { user, timestamp } };
}

describe("directusEditTimes", () => {
  it("dates each field by its latest revision, when someone other than the sync made it", () => {
    const times = directusEditTimes(
      [
        revision(2, "staff", "2026-02-01T00:00:00.000Z", { city: "Seattle" }),
        revision(1, "staff", "2026-01-01T00:00:00.000Z", { city: "Tacoma", phone: "+12065550100" }),
      ],
      "sync",
    );

    expect(Object.fromEntries(times)).toEqual({
      city: "2026-02-01T00:00:00.000Z",
      phone: "2026-01-01T00:00:00.000Z",
    });
  });

  it("leaves out a field the sync wrote last, even though staff edited it before", () => {
    const times = directusEditTimes(
      [
        revision(1, "staff", "2026-01-01T00:00:00.000Z", { city: "Seattle" }),
        revision(2, "sync", "2026-02-01T00:00:00.000Z", { city: "Tacoma" }),
      ],
      "sync",
    );

    expect(times.has("city")).toBe(false);
  });

  it("counts an edit with no user, such as a flow's, as not the sync's", () => {
    const times = directusEditTimes([revision(1, null, "2026-01-01T00:00:00.000Z", { city: "Seattle" })], "sync");

    expect(times.get("city")).toBe("2026-01-01T00:00:00.000Z");
  });
});
