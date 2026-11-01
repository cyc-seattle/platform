import { describe, expect, it } from "vitest";
import { type CrmRegistrationRow, type OfferingRow } from "@cyc-seattle/crm";
import { type Mirrors, planOfferings, planRegistrations } from "../src/offerings.ts";

const empty: Mirrors = {
  camps: [{ id: "camp-1", start_date: "2026-06-01", end_date: "2026-08-31" }],
  sessions: [
    { id: "week-1", camp_id: "camp-1", start_date: "2026-06-15", end_date: "2026-06-19", archived: false },
    { id: "week-2", camp_id: "camp-1", start_date: "2026-06-22", end_date: "2026-06-26", archived: false },
  ],
  classes: [],
  sessionClasses: [],
  entryCaps: [],
  entries: [],
  registrations: [],
  participants: [],
};

const inBothWeeks = (classId: string) => [
  { session_id: "week-1", class_id: classId },
  { session_id: "week-2", class_id: classId },
];

function mirrors(overrides: Partial<Mirrors>): Mirrors {
  return { ...empty, ...overrides };
}

/** A plan's new rows without their fresh ids. */
const withoutIds = <Row extends { id: string }>(rows: Row[]) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => field !== "id")));
const desired = (plan: { toCreate: OfferingRow[] }) => withoutIds(plan.toCreate);

describe("planOfferings", () => {
  it("makes one offering for each session of a class with a program", () => {
    const plan = planOfferings(
      mirrors({
        classes: [{ id: "guppies", camp_id: "camp-1", program_id: "program-guppies" }],
        sessionClasses: inBothWeeks("guppies"),
        entryCaps: [{ class_id: "guppies", session_id: "week-1", cap: 12 }],
      }),
      [],
    );

    expect(desired(plan)).toEqual([
      {
        program_id: "program-guppies",
        starts_on: "2026-06-15",
        ends_on: "2026-06-19",
        capacity: 12,
        clubspot_class_id: "guppies",
        clubspot_session_id: "week-1",
      },
      {
        program_id: "program-guppies",
        starts_on: "2026-06-22",
        ends_on: "2026-06-26",
        capacity: null,
        clubspot_class_id: "guppies",
        clubspot_session_id: "week-2",
      },
    ]);
  });

  it("makes one offering for a class whose cap covers every session", () => {
    const plan = planOfferings(
      mirrors({
        classes: [{ id: "j-pod", camp_id: "camp-1", program_id: "program-j-pod" }],
        sessionClasses: inBothWeeks("j-pod"),
        entryCaps: [{ class_id: "j-pod", session_id: null, cap: 8 }],
      }),
      [],
    );

    expect(desired(plan)).toEqual([
      {
        program_id: "program-j-pod",
        starts_on: "2026-06-15",
        ends_on: "2026-06-26",
        capacity: 8,
        clubspot_class_id: "j-pod",
        clubspot_session_id: null,
      },
    ]);
  });

  it("dates a class with no sessions by its camp", () => {
    const plan = planOfferings(
      mirrors({ classes: [{ id: "k-pod", camp_id: "camp-1", program_id: "program-k-pod" }] }),
      [],
    );

    expect(desired(plan)).toMatchObject([
      { starts_on: "2026-06-01", ends_on: "2026-08-31", clubspot_session_id: null },
    ]);
  });

  it("makes nothing for a class with no program, or for an archived session", () => {
    const plan = planOfferings(
      mirrors({
        sessions: [empty.sessions[0]!, { ...empty.sessions[1]!, archived: true }],
        classes: [
          { id: "guppies", camp_id: "camp-1", program_id: "program-guppies" },
          { id: "unmapped", camp_id: "camp-1", program_id: null },
        ],
        sessionClasses: [...inBothWeeks("guppies"), ...inBothWeeks("unmapped")],
      }),
      [],
    );

    expect(desired(plan)).toMatchObject([{ clubspot_class_id: "guppies", clubspot_session_id: "week-1" }]);
  });

  it("keeps an unchanged offering, changes a changed one, and deletes one whose class lost its program", () => {
    const existing: OfferingRow[] = [
      {
        id: "o-1",
        program_id: "program-guppies",
        starts_on: "2026-06-15",
        ends_on: "2026-06-19",
        capacity: null,
        clubspot_class_id: "guppies",
        clubspot_session_id: "week-1",
      },
      {
        id: "o-2",
        program_id: "program-old",
        starts_on: "2026-06-22",
        ends_on: "2026-06-26",
        capacity: null,
        clubspot_class_id: "guppies",
        clubspot_session_id: "week-2",
      },
      {
        id: "o-3",
        program_id: "program-old",
        starts_on: null,
        ends_on: null,
        capacity: null,
        clubspot_class_id: "unmapped",
        clubspot_session_id: null,
      },
    ];
    const plan = planOfferings(
      mirrors({
        classes: [
          { id: "guppies", camp_id: "camp-1", program_id: "program-guppies" },
          { id: "unmapped", camp_id: "camp-1", program_id: null },
        ],
        sessionClasses: inBothWeeks("guppies"),
      }),
      existing,
    );

    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([{ id: "o-2", patch: { program_id: "program-guppies" } }]);
    expect(plan.toDelete).toEqual(["o-3"]);
    expect([...plan.idByKey.values()]).toEqual(["o-1", "o-2"]);
  });
});

describe("planRegistrations", () => {
  const linked: Partial<Mirrors> = {
    registrations: [
      { id: "signup-1", participant_id: "participant-1" },
      { id: "signup-2", participant_id: "participant-2" },
    ],
    participants: [
      { id: "participant-1", person_id: "person-1" },
      { id: "participant-2", person_id: null },
    ],
  };
  const offerings = new Map([
    ["guppies:week-1", "offering-guppies-1"],
    ["j-pod:", "offering-j-pod"],
  ]);

  it("registers each entry's person in its offering, waiting for a person to be matched", () => {
    const plan = planRegistrations(
      mirrors({
        ...linked,
        entries: [
          {
            id: "entry-1",
            registration_id: "signup-1",
            session_id: "week-1",
            class_id: "guppies",
            status: "confirmed",
          },
          { id: "entry-2", registration_id: "signup-1", session_id: "week-2", class_id: "j-pod", status: "waitlist" },
          {
            id: "entry-3",
            registration_id: "signup-2",
            session_id: "week-1",
            class_id: "guppies",
            status: "confirmed",
          },
          {
            id: "entry-4",
            registration_id: "signup-1",
            session_id: "week-2",
            class_id: "unmapped",
            status: "confirmed",
          },
        ],
      }),
      offerings,
      [],
    );

    expect(withoutIds(plan.toCreate)).toEqual([
      { person_id: "person-1", offering_id: "offering-guppies-1", status: "confirmed", clubspot_entry_id: "entry-1" },
      { person_id: "person-1", offering_id: "offering-j-pod", status: "waitlist", clubspot_entry_id: "entry-2" },
    ]);
  });

  it("follows a cancelled entry, and deletes a registration whose entry no longer has an offering", () => {
    const existing: CrmRegistrationRow[] = [
      {
        id: "r-1",
        person_id: "person-1",
        offering_id: "offering-guppies-1",
        status: "confirmed",
        clubspot_entry_id: "entry-1",
      },
      {
        id: "r-2",
        person_id: "person-1",
        offering_id: "offering-gone",
        status: "confirmed",
        clubspot_entry_id: "entry-9",
      },
    ];
    const plan = planRegistrations(
      mirrors({
        ...linked,
        entries: [
          {
            id: "entry-1",
            registration_id: "signup-1",
            session_id: "week-1",
            class_id: "guppies",
            status: "cancelled",
          },
        ],
      }),
      offerings,
      existing,
    );

    expect(plan).toEqual({
      toCreate: [],
      toUpdate: [{ id: "r-1", patch: { status: "cancelled" } }],
      toDelete: ["r-2"],
    });
  });
});
