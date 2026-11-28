import { describe, expect, it } from "vitest";
import { type CrmRegistrationRow, type OfferingRow } from "../../../src/model/crm/index.ts";
import {
  apply,
  clubspotOfferings,
  findClassesWithoutOffering,
  findOfferingDifferences,
  type Mirrors,
  offeringIdsByKey,
  planClassPrograms,
  planConfirmedCounts,
  planRegistrations,
} from "../../../src/syncs/clubspot/offerings.ts";
import { type DirectusClient } from "../../../src/syncs/runtime/index.ts";

const empty: Mirrors = {
  camps: [{ id: "camp-1", name: "Summer", start_date: "2026-06-01", end_date: "2026-08-31", archived: false }],
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

/** A catalog offering, linked to Clubspot unless the overrides say otherwise. */
function offering(overrides: Partial<OfferingRow> & Pick<OfferingRow, "id">): OfferingRow {
  return {
    product_id: "product-guppies",
    starts_on: "2026-06-15",
    ends_on: "2026-06-19",
    capacity: null,
    clubspot_class_id: "guppies",
    clubspot_session_id: "week-1",
    confirmed_count: 0,
    archived_at: null,
    ...overrides,
  };
}

describe("clubspotOfferings", () => {
  it("reads each session of a class, with its cap", () => {
    const found = clubspotOfferings(
      mirrors({
        classes: [{ id: "guppies", camp_id: "camp-1", name: "guppies", program_id: null }],
        sessionClasses: inBothWeeks("guppies"),
        entryCaps: [{ class_id: "guppies", session_id: "week-1", cap: 12 }],
      }),
    );

    expect(Object.fromEntries(found)).toEqual({
      "guppies:week-1": { starts_on: "2026-06-15", ends_on: "2026-06-19", capacity: 12 },
      "guppies:week-2": { starts_on: "2026-06-22", ends_on: "2026-06-26", capacity: null },
    });
  });

  it("reads a class in each of its sessions, at each session's larger cap, even when a cap covers every session", () => {
    const found = clubspotOfferings(
      mirrors({
        classes: [{ id: "j-pod", camp_id: "camp-1", name: "j-pod", program_id: null }],
        sessionClasses: inBothWeeks("j-pod"),
        entryCaps: [
          { class_id: "j-pod", session_id: null, cap: 16 },
          { class_id: "j-pod", session_id: "week-2", cap: 6 },
          { class_id: "j-pod", session_id: "week-2", cap: 8 },
        ],
      }),
    );

    expect(Object.fromEntries(found)).toEqual({
      "j-pod:week-1": { starts_on: "2026-06-15", ends_on: "2026-06-19", capacity: null },
      "j-pod:week-2": { starts_on: "2026-06-22", ends_on: "2026-06-26", capacity: 8 },
    });
  });

  it("reads nothing for a class with no sessions, and leaves out an archived session", () => {
    const found = clubspotOfferings(
      mirrors({
        sessions: [empty.sessions[0]!, { ...empty.sessions[1]!, archived: true }],
        classes: [
          { id: "k-pod", camp_id: "camp-1", name: "k-pod", program_id: null },
          { id: "guppies", camp_id: "camp-1", name: "guppies", program_id: null },
        ],
        sessionClasses: inBothWeeks("guppies"),
      }),
    );

    expect([...found.keys()]).toEqual(["guppies:week-1"]);
  });
});

describe("offeringIdsByKey", () => {
  it("finds each linked offering by its class and session, and skips one not linked to both yet", () => {
    const ids = offeringIdsByKey([
      offering({ id: "o-1" }),
      offering({ id: "o-2", clubspot_class_id: "j-pod", clubspot_session_id: null }),
      offering({ id: "o-3", clubspot_class_id: null, clubspot_session_id: null }),
    ]);

    expect(Object.fromEntries(ids)).toEqual({ "guppies:week-1": "o-1" });
  });
});

describe("planClassPrograms", () => {
  const programOf = new Map([
    ["product-guppies", "program-guppies"],
    ["product-j-pod", "program-j-pod"],
  ]);

  it("gives a class its offerings' product's program, and none when they disagree or there are none", () => {
    const patches = planClassPrograms(
      [
        { id: "guppies", program_id: null },
        { id: "mixed", program_id: "program-guppies" },
        { id: "unlinked", program_id: "program-old" },
        { id: "same", program_id: "program-j-pod" },
      ],
      [
        offering({ id: "o-1" }),
        offering({ id: "o-2", clubspot_session_id: "week-2" }),
        offering({ id: "o-3", clubspot_class_id: "mixed" }),
        offering({ id: "o-4", clubspot_class_id: "mixed", clubspot_session_id: "week-2", product_id: "product-j-pod" }),
        offering({ id: "o-5", clubspot_class_id: "same", product_id: "product-j-pod" }),
      ],
      programOf,
    );

    expect(patches).toEqual([
      { id: "guppies", patch: { program_id: "program-guppies" } },
      { id: "mixed", patch: { program_id: null } },
      { id: "unlinked", patch: { program_id: null } },
    ]);
  });

  it("gives none to a class whose offerings' product isn't a program", () => {
    const patches = planClassPrograms(
      [{ id: "charter", program_id: "program-guppies" }],
      [offering({ id: "o-1", clubspot_class_id: "charter", product_id: "product-charter" })],
      programOf,
    );

    expect(patches).toEqual([{ id: "charter", patch: { program_id: null } }]);
  });
});

describe("planConfirmedCounts", () => {
  it("counts only confirmed sailors, and writes only a count that changed", () => {
    const patches = planConfirmedCounts(
      [
        offering({ id: "o-1", confirmed_count: 1 }),
        offering({ id: "o-2", confirmed_count: 1 }),
        offering({ id: "o-3" }),
      ],
      [
        { offering_id: "o-1", status: "confirmed" },
        { offering_id: "o-1", status: "confirmed" },
        { offering_id: "o-1", status: "waitlist" },
        { offering_id: "o-2", status: "confirmed" },
        { offering_id: "o-3", status: "cancelled" },
      ],
    );

    expect(patches).toEqual([{ id: "o-1", patch: { confirmed_count: 2 } }]);
  });
});

describe("findClassesWithoutOffering", () => {
  const entry = (id: string, classId: string, sessionId: string, status = "confirmed") => ({
    id,
    registration_id: "signup-1",
    session_id: sessionId,
    class_id: classId,
    status,
  });

  it("reports a class with sign-ups in no offering, once, with how many", () => {
    const findings = findClassesWithoutOffering(
      mirrors({
        classes: [
          { id: "guppies", camp_id: "camp-1", name: "Guppies", program_id: null },
          { id: "j-pod", camp_id: "camp-1", name: "J Pod", program_id: null },
        ],
        entries: [
          entry("e-1", "guppies", "week-1"),
          entry("e-2", "guppies", "week-2"),
          entry("e-3", "guppies", "week-2", "cancelled"),
          entry("e-4", "j-pod", "week-1"),
        ],
      }),
      new Map([["j-pod:week-1", "offering-j-pod"]]),
      "2026-06-01",
    );

    expect(findings).toEqual([
      {
        source: "clubspot-sync",
        kind: "class_without_offering",
        subject: "guppies",
        detail: 'Class "Guppies" in "Summer" (guppies): 2 sign-ups in no offering',
      },
    ]);
  });

  it("leaves out a class in a camp that's over or archived", () => {
    const classes = [{ id: "guppies", camp_id: "camp-1", name: "Guppies", program_id: null }];
    const entries = [entry("e-1", "guppies", "week-1")];
    expect(findClassesWithoutOffering(mirrors({ classes, entries }), new Map(), "2026-09-01")).toEqual([]);
    const archived = [{ ...empty.camps[0]!, archived: true }];
    expect(findClassesWithoutOffering(mirrors({ camps: archived, classes, entries }), new Map(), "2026-06-01")).toEqual(
      [],
    );
  });
});

describe("findOfferingDifferences", () => {
  const fromClubspot = new Map([
    ["guppies:week-1", { starts_on: "2026-06-15", ends_on: "2026-06-19", capacity: 12 }],
    ["guppies:week-2", { starts_on: "2026-06-22", ends_on: "2026-06-26", capacity: 12 }],
  ]);

  it("reports an offering whose dates or limit differ, or whose class and session Clubspot doesn't have", () => {
    const findings = findOfferingDifferences(
      [
        offering({ id: "o-1", capacity: 12 }),
        offering({
          id: "o-2",
          clubspot_session_id: "week-2",
          starts_on: "2026-06-22",
          ends_on: "2026-06-26",
          capacity: 10,
        }),
        offering({ id: "o-3", clubspot_session_id: "week-3" }),
      ],
      fromClubspot,
      "2026-06-01",
    );

    expect(findings).toEqual([
      {
        source: "clubspot-sync",
        kind: "offering_differs",
        subject: "o-2",
        detail: "Offering o-2: capacity is 10 here and 12 in Clubspot",
      },
      {
        source: "clubspot-sync",
        kind: "offering_differs",
        subject: "o-3",
        detail: "Offering o-3: Clubspot has no such class and session",
      },
    ]);
  });

  it("leaves out one not linked yet, archived, or over", () => {
    const findings = findOfferingDifferences(
      [
        offering({ id: "o-1", clubspot_class_id: null, clubspot_session_id: null }),
        offering({ id: "o-2", capacity: 3, archived_at: "2026-05-01T00:00:00Z" }),
        offering({ id: "o-3", capacity: 3 }),
      ],
      fromClubspot,
      "2026-07-01",
    );

    expect(findings).toEqual([]);
  });
});

describe("planRegistrations", () => {
  const linked: Partial<Mirrors> = {
    classes: [
      { id: "guppies", camp_id: "camp-1", name: "guppies", program_id: "program-guppies" },
      { id: "j-pod", camp_id: "camp-1", name: "j-pod", program_id: "program-j-pod" },
      { id: "unmapped", camp_id: "camp-1", name: "unmapped", program_id: null },
    ],
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
    ["j-pod:week-2", "offering-j-pod"],
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

  it("follows a cancelled entry, and keeps a registration whose class lost its link, in the offering it had", () => {
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
        clubspot_entry_id: "entry-4",
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
      existing,
    );

    expect(plan).toEqual({
      toCreate: [],
      toUpdate: [{ id: "r-1", patch: { status: "cancelled" } }],
      toDelete: [],
    });
  });

  it("moves a registration to the offering its class is linked to now", () => {
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
        ],
      }),
      new Map([["guppies:week-1", "offering-guppies-new"]]),
      [
        {
          id: "r-1",
          person_id: "person-1",
          offering_id: "offering-guppies-1",
          status: "confirmed",
          clubspot_entry_id: "entry-1",
        },
      ],
    );

    expect(plan).toEqual({
      toCreate: [],
      toUpdate: [{ id: "r-1", patch: { offering_id: "offering-guppies-new" } }],
      toDelete: [],
    });
  });

  it("leaves a registration whose Clubspot rows were made after the mirrors were read", () => {
    const registration = (id: string, entry: string): CrmRegistrationRow => ({
      id,
      person_id: "person-1",
      offering_id: "offering-new",
      status: "confirmed",
      clubspot_entry_id: entry,
    });
    const plan = planRegistrations(
      mirrors({
        ...linked,
        entries: [
          {
            id: "new-class",
            registration_id: "signup-1",
            session_id: "week-1",
            class_id: "k-pod",
            status: "confirmed",
          },
          {
            id: "new-signup",
            registration_id: "signup-9",
            session_id: "week-1",
            class_id: "guppies",
            status: "confirmed",
          },
        ],
      }),
      offerings,
      [registration("r-1", "new-entry"), registration("r-2", "new-class"), registration("r-3", "new-signup")],
    );

    expect(plan).toEqual({ toCreate: [], toUpdate: [], toDelete: [] });
  });
});

describe("apply", () => {
  const vanished = (id: string) =>
    new Error(
      `POST /items/registrations -> 400: {"errors":[{"message":"Invalid foreign key \\"${id}\\"","extensions":{"code":"INVALID_FOREIGN_KEY"}}]}`,
    );

  /** A client whose writes fail for any row linking to an entry in `gone`. */
  function client(gone: Set<string>) {
    const created: string[] = [];
    const updated: string[] = [];
    const fake = {
      deleteItem: async () => {},
      createItems: async (_: string, rows: CrmRegistrationRow[]) => {
        const bad = rows.find((row) => gone.has(row.clubspot_entry_id));
        if (bad) throw vanished(bad.clubspot_entry_id);
        created.push(...rows.map((row) => row.id));
      },
      updateItem: async (_: string, id: string, patch: Partial<CrmRegistrationRow>) => {
        if (patch.clubspot_entry_id !== undefined && gone.has(patch.clubspot_entry_id)) {
          throw vanished(patch.clubspot_entry_id);
        }
        updated.push(id);
      },
    };
    return { directus: fake as unknown as DirectusClient, created, updated };
  }

  const registration = (id: string): CrmRegistrationRow => ({
    id,
    person_id: "person-1",
    offering_id: "offering-1",
    status: "confirmed",
    clubspot_entry_id: `entry-${id}`,
  });

  it("skips a row whose Clubspot entry was deleted during the run, and writes the rest", async () => {
    const { directus, created, updated } = client(new Set(["entry-2", "entry-9"]));
    const written = await apply(directus, "registrations", {
      toCreate: [registration("1"), registration("2"), registration("3")],
      toUpdate: [
        { id: "8", patch: { status: "waitlist" } },
        { id: "9", patch: { clubspot_entry_id: "entry-9" } },
      ],
      toDelete: [],
    });
    expect(created).toEqual(["1", "3"]);
    expect(updated).toEqual(["8"]);
    expect(written).toBe(3);
  });

  it("updates a registration another writer created since the read, and creates the rest", async () => {
    const duplicate = (entry: string) =>
      new Error(
        `POST /items/registrations -> 400: {"errors":[{"message":"Value \\"${entry}\\" has to be unique.","extensions":{"collection":"registrations","field":"clubspot_entry_id","value":"${entry}","code":"RECORD_NOT_UNIQUE"}}]}`,
      );
    const created: string[] = [];
    const updatedByQuery: unknown[] = [];
    const directus = {
      createItems: async (_: string, rows: CrmRegistrationRow[]) => {
        if (rows.some((row) => row.clubspot_entry_id === "entry-2")) throw duplicate("entry-2");
        created.push(...rows.map((row) => row.id));
      },
      updateItemsByQuery: async (_: string, filter: unknown, patch: unknown) => {
        updatedByQuery.push({ filter, patch });
        return [patch];
      },
    } as unknown as DirectusClient;

    const written = await apply(directus, "registrations", {
      toCreate: [registration("1"), registration("2"), registration("3")],
      toUpdate: [],
      toDelete: [],
    });

    expect(created).toEqual(["1", "3"]);
    expect(updatedByQuery).toEqual([
      {
        filter: { clubspot_entry_id: { _eq: "entry-2" } },
        patch: { person_id: "person-1", offering_id: "offering-1", status: "confirmed", clubspot_entry_id: "entry-2" },
      },
    ]);
    expect(written).toBe(3);
  });

  it("still fails on any other error", async () => {
    const directus = {
      createItems: async () => {
        throw new Error("POST /items/registrations -> 500: boom");
      },
    } as unknown as DirectusClient;
    await expect(
      apply(directus, "registrations", { toCreate: [registration("1")], toUpdate: [], toDelete: [] }),
    ).rejects.toThrow("500");
  });
});
