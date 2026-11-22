import { describe, expect, it, vi } from "vitest";
import winston from "winston";
import { type ContactRow, type PersonRow } from "../../../src/model/crm/index.ts";
import {
  type CampRow,
  type ClassRow,
  type ParticipantRow,
  type RegistrationEntryRow,
  type RegistrationRow,
} from "../../../src/model/clubspot/index.ts";
import {
  type MembershipTables,
  planProgramMemberPeople,
  planProgramMembers,
  programLeavers,
  type ProgramTermRow,
} from "../../../src/syncs/gsuite/membership.ts";

const now = new Date("2026-06-15T00:00:00Z");

function person(id: string, email: string | null): PersonRow {
  return {
    id,
    first_name: id,
    last_name: null,
    email,
    phone: null,
    date_of_birth: null,
    gender: null,
    street: null,
    city: null,
    state: null,
    postal_code: null,
  };
}

function registration(id: string): RegistrationRow {
  return {
    id,
    participant_id: `participant-${id}`,
    last_sync_run_id: null,
    camp_id: "camp-1",
    registered_at: "2026-01-01T00:00:00Z",
    status: "confirmed",
    waiver_status: null,
    archived: false,
  };
}

/** The `clubspot_participants` row `registration(id)` links to, resolved to `personId`. */
function linkedParticipant(id: string, personId: string): Pick<ParticipantRow, "id" | "person_id"> {
  return { id: `participant-${id}`, person_id: personId };
}

function entry(id: string, registrationId: string, classId: string, status: string): RegistrationEntryRow {
  return {
    id,
    registration_id: registrationId,
    session_id: "session-1",
    class_id: classId,
    status,
  };
}

function contact(
  id: string,
  subjectId: string,
  contactId: string,
  relationshipType: ContactRow["relationship_type"],
): ContactRow {
  return {
    id,
    subject_id: subjectId,
    contact_id: contactId,
    relationship_type: relationshipType,
    contact_order: 1,
    relationship_detail: null,
  };
}

function cls(id: string, programId: string | null): ClassRow {
  return { id, camp_id: "camp-1", name: id, program_id: programId };
}

function camp(id: string, endDate: string | null, archived = false): CampRow {
  return { id, name: id, start_date: null, end_date: endDate, archived, clubspot_sales_account: null };
}

/** A person's term for a program, as Crew holds it: through their crew member. */
function term(personId: string, overrides: Partial<ProgramTermRow> = {}): ProgramTermRow & { person_id: string } {
  return {
    crew_member_id: `crew-${personId}`,
    program_id: "program-1",
    starts_on: null,
    ends_on: null,
    ...overrides,
    person_id: personId,
  };
}

/** The Crew tables for `terms`, with a crew member for each person. */
function crew(
  ...terms: (ProgramTermRow & { person_id: string })[]
): Pick<MembershipTables, "crewTerms" | "crewMembers"> {
  return {
    crewTerms: terms.map(({ crew_member_id, program_id, starts_on, ends_on }) => ({
      crew_member_id,
      program_id,
      starts_on,
      ends_on,
    })),
    crewMembers: [...new Set(terms.map((row) => row.person_id))].map((id) => ({ id: `crew-${id}`, person_id: id })),
  };
}

const PROGRAM_ID = "program-1";
const CLASS_ID = "class-1";

function tables(overrides: Partial<MembershipTables>): MembershipTables {
  return {
    classes: [cls(CLASS_ID, PROGRAM_ID)],
    camps: [camp("camp-1", null)],
    registrationEntries: [],
    registrations: [],
    participants: [],
    people: [],
    contacts: [],
    crewTerms: [],
    crewMembers: [],
    ...overrides,
  };
}

describe("planProgramMembers", () => {
  it("skips an unusable guardian email and keeps everyone else", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [
          person("participant", "participant@example.com"),
          person("guardian", "206-965-5407"),
          person("other-guardian", "aimeekimball.gmail.com"),
        ],
        contacts: [
          contact("c1", "participant", "guardian", "guardian"),
          contact("c2", "participant", "other-guardian", "guardian"),
        ],
      }),
      now,
    );

    expect(result).toEqual(["participant@example.com"]);
  });

  it("includes a guardian and excludes an emergency contact", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [
          person("participant", null),
          person("guardian", "guardian@example.com"),
          person("emergency", "emergency@example.com"),
        ],
        contacts: [
          contact("c1", "participant", "guardian", "guardian"),
          contact("c2", "participant", "emergency", "emergency_contact"),
        ],
      }),
      now,
    );

    expect(result).toEqual(["guardian@example.com"]);
  });

  it("includes an adult participant's own email with no guardian row", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "adult")],
        people: [person("adult", "adult@example.com")],
        contacts: [],
      }),
      now,
    );

    expect(result).toEqual(["adult@example.com"]);
  });

  it("dedupes an email shared by a participant and their guardian", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "family@example.com"), person("guardian", "  Family@Example.com ")],
        contacts: [contact("c1", "participant", "guardian", "guardian")],
      }),
      now,
    );

    expect(result).toEqual(["family@example.com"]);
  });

  it("excludes a registration entry that isn't confirmed", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        registrationEntries: [entry("e1", "r1", CLASS_ID, "waitlist")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "waitlisted@example.com")],
        contacts: [],
      }),
      now,
    );

    expect(result).toEqual([]);
  });

  it("ignores a confirmed entry for a class outside the program", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        classes: [cls(CLASS_ID, PROGRAM_ID), cls("other-class", "other-program")],
        registrationEntries: [entry("e1", "r1", "other-class", "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "elsewhere@example.com")],
        contacts: [],
      }),
      now,
    );

    expect(result).toEqual([]);
  });

  it("reaches a participant through program -> classes -> registration_entries", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        classes: [cls("j-pod", PROGRAM_ID), cls("k-pod", PROGRAM_ID)],
        registrationEntries: [entry("e1", "r1", "k-pod", "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "participant@example.com")],
        contacts: [],
      }),
      now,
    );

    expect(result).toEqual(["participant@example.com"]);
  });

  it("includes a person with a current Crew term for the program", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        people: [person("coordinator", "coordinator@example.com")],
        ...crew(term("coordinator")),
      }),
      now,
    );

    expect(result).toEqual(["coordinator@example.com"]);
  });

  it("excludes a term that hasn't started", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        people: [person("coordinator", "coordinator@example.com")],
        ...crew(term("coordinator", { starts_on: "2026-08-01" })),
      }),
      now,
    );

    expect(result).toEqual([]);
  });

  it("excludes a term for a different program", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        people: [person("coordinator", "coordinator@example.com")],
        ...crew(term("coordinator", { program_id: "other-program" })),
      }),
      now,
    );

    expect(result).toEqual([]);
  });

  it("includes a term holder even when the program has no class at all", () => {
    // A program whose only activity is a term - off-season, or set up before its first class exists -
    // must still get its term holder (cyc-seattle/isthmia#149).
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        classes: [],
        camps: [],
        people: [person("coordinator", "coordinator@example.com")],
        ...crew(term("coordinator")),
      }),
      now,
    );

    expect(result).toEqual(["coordinator@example.com"]);
  });

  it("excludes a participant whose class's camp has ended", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        camps: [camp("camp-1", "2026-06-01")],
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "participant@example.com")],
      }),
      now,
    );

    expect(result).toEqual([]);
  });

  it("includes a participant whose class's camp is upcoming", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        camps: [camp("camp-1", "2026-08-01T00:00:00Z")],
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "participant@example.com")],
      }),
      now,
    );

    expect(result).toEqual(["participant@example.com"]);
  });

  it("excludes a participant whose class's camp is archived, even before it ends", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        camps: [camp("camp-1", "2026-08-01T00:00:00Z", true)],
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "participant@example.com")],
      }),
      now,
    );

    expect(result).toEqual([]);
  });

  it("counts inactive camps when includeInactiveCamps is set", () => {
    const result = planProgramMembers(
      PROGRAM_ID,
      tables({
        camps: [camp("camp-1", "2020-01-01T00:00:00Z", true)],
        registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed")],
        registrations: [registration("r1")],
        participants: [linkedParticipant("r1", "participant")],
        people: [person("participant", "participant@example.com")],
      }),
      now,
      { includeInactiveCamps: true },
    );

    expect(result).toEqual(["participant@example.com"]);
  });

  it("skips a confirmed participant with no resolved person, and warns once with the count", () => {
    const warn = vi.spyOn(winston, "warn").mockReturnThis();
    try {
      const result = planProgramMemberPeople(
        PROGRAM_ID,
        tables({
          registrationEntries: [entry("e1", "r1", CLASS_ID, "confirmed"), entry("e2", "r2", CLASS_ID, "confirmed")],
          registrations: [registration("r1"), registration("r2")],
          // participant-r1 is never linked to a person; participant-r2 resolves normally.
          participants: [linkedParticipant("r2", "participant-2")],
          people: [person("participant-2", "participant-2@example.com")],
        }),
        now,
      );

      expect(result.map((person) => person.id)).toEqual(["participant-2"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("1"),
        expect.objectContaining({ unlinkedParticipants: 1 }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("programLeavers", () => {
  it("are the people whose last term for the program ended before today", () => {
    const people = ["ended", "current", "both", "future", "elsewhere"].map((id) => person(id, `${id}@example.com`));
    const leavers = programLeavers(
      PROGRAM_ID,
      tables({
        people,
        ...crew(
          term("ended", { ends_on: "2026-06-10" }),
          term("current", { ends_on: "2026-06-14" }),
          term("both", { ends_on: "2026-01-01" }),
          term("both", { starts_on: "2026-01-02" }),
          term("future", { starts_on: "2026-07-01" }),
          term("elsewhere", { program_id: "other-program", ends_on: "2026-01-01" }),
        ),
      }),
      now,
    );

    expect(leavers.map((leaver) => leaver.id)).toEqual(["ended"]);
  });
});
