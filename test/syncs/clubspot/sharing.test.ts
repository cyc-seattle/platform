import { describe, expect, it } from "vitest";
import {
  type GuardianLink,
  planSharingBackfill,
  type SharingParticipant,
  sharingTargets,
} from "../../../src/syncs/clubspot/sharing.ts";

const REGISTERED = "2026-06-01T12:00:00.000Z";

const child = (overrides: Partial<SharingParticipant> = {}): SharingParticipant => ({
  person_id: "child",
  date_of_birth: "2014-03-01",
  guardian_1_name: "Pat Parent",
  guardian_2_name: null,
  ...overrides,
});

const link = (contactId: string, order: number, subjectId = "child"): GuardianLink => ({
  subject_id: subjectId,
  contact_id: contactId,
  contact_order: order,
  relationship_type: "guardian",
});

describe("sharingTargets", () => {
  it("is the sailor themselves when they're an adult on the day they register", () => {
    expect(sharingTargets(child({ person_id: "adult", date_of_birth: "1990-01-01" }), REGISTERED, [])).toEqual([
      "adult",
    ]);
  });

  it("counts someone who turns 18 after registering as a child", () => {
    expect(sharingTargets(child({ date_of_birth: "2008-06-02" }), REGISTERED, [link("parent-1", 1)])).toEqual([
      "parent-1",
    ]);
  });

  it("is the guardians a child's form names, not every guardian the CRM has", () => {
    const links = [link("parent-1", 1), link("parent-2", 2), link("other-child's-parent", 1, "other")];
    expect(sharingTargets(child(), REGISTERED, links)).toEqual(["parent-1"]);
    expect(sharingTargets(child({ guardian_2_name: "Sam Parent" }), REGISTERED, links)).toEqual([
      "parent-1",
      "parent-2",
    ]);
  });

  it("counts a sailor with no date of birth on file as a child", () => {
    expect(sharingTargets(child({ date_of_birth: null }), REGISTERED, [link("parent-1", 1)])).toEqual(["parent-1"]);
  });

  it("is no one when the participant has no person yet", () => {
    expect(sharingTargets(child({ person_id: null }), REGISTERED, [link("parent-1", 1)])).toEqual([]);
  });
});

describe("planSharingBackfill", () => {
  const participants = [
    { id: "p-child", ...child() },
    { id: "p-adult", ...child({ person_id: "adult", date_of_birth: "1990-01-01" }) },
  ];
  const links = [link("parent-1", 1)];

  it("fills a blank answer from the newest registration that answered", () => {
    const registrations = [
      { participant_id: "p-child", registered_at: "2025-06-01T00:00:00.000Z", share_contact: false },
      { participant_id: "p-child", registered_at: "2026-06-01T00:00:00.000Z", share_contact: true },
      { participant_id: "p-child", registered_at: "2026-07-01T00:00:00.000Z", share_contact: null },
    ];
    const people = [{ id: "parent-1", share_contact: null }];
    expect(planSharingBackfill(registrations, participants, links, people)).toEqual([
      { id: "parent-1", patch: { share_contact: true } },
    ]);
  });

  it("never replaces an answer the person already has", () => {
    const registrations = [{ participant_id: "p-adult", registered_at: REGISTERED, share_contact: true }];
    expect(planSharingBackfill(registrations, participants, links, [{ id: "adult", share_contact: false }])).toEqual(
      [],
    );
  });
});
