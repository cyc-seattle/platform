import { describe, expect, it } from "vitest";
import {
  type NewAnswers,
  planNewAnswers,
  planSharingBackfill,
  recordAnswer,
} from "../../../src/syncs/clubspot/sharing.ts";

describe("planSharingBackfill", () => {
  const participants = [
    { id: "p-child", person_id: "child" },
    { id: "p-sibling", person_id: "sibling" },
    { id: "p-unlinked", person_id: null },
  ];
  const people = [
    { id: "child", household_id: "home" },
    { id: "sibling", household_id: "home" },
    { id: "parent", household_id: "home" },
  ];

  it("fills a blank household from the newest registration of any sailor in it", () => {
    const registrations = [
      { participant_id: "p-child", registered_at: "2025-06-01T00:00:00.000Z", share_contact: false },
      { participant_id: "p-sibling", registered_at: "2026-06-01T00:00:00.000Z", share_contact: true },
      { participant_id: "p-child", registered_at: "2026-07-01T00:00:00.000Z", share_contact: null },
    ];
    expect(planSharingBackfill(registrations, participants, people, [{ id: "home", share_contact: null }])).toEqual([
      { id: "home", patch: { share_contact: true } },
    ]);
  });

  it("never replaces an answer the household already has", () => {
    const registrations = [{ participant_id: "p-child", registered_at: "2026-06-01", share_contact: true }];
    expect(planSharingBackfill(registrations, participants, people, [{ id: "home", share_contact: false }])).toEqual(
      [],
    );
  });

  it("skips a registration whose sailor has no person or no household", () => {
    const registrations = [
      { participant_id: "p-unlinked", registered_at: "2026-06-01", share_contact: true },
      { participant_id: "p-missing", registered_at: "2026-06-01", share_contact: true },
    ];
    expect(planSharingBackfill(registrations, participants, people, [{ id: "home", share_contact: null }])).toEqual([]);
  });
});

describe("planNewAnswers", () => {
  const people = [
    { id: "child", household_id: "home" },
    { id: "sibling", household_id: "home" },
    { id: "loner", household_id: null },
  ];

  it("replaces a household's answer with a new one from a sailor who just joined it", () => {
    const answers: NewAnswers = new Map();
    recordAnswer(answers, "sibling", "2026-06-01", false);
    expect(planNewAnswers(answers, people, [{ id: "home", share_contact: true }])).toEqual([
      { id: "home", patch: { share_contact: false } },
    ]);
  });

  it("takes the newest registration's answer when two sailors in one household answered, whatever the order", () => {
    const answers: NewAnswers = new Map();
    recordAnswer(answers, "child", "2026-07-01", true);
    recordAnswer(answers, "sibling", "2026-06-01", false);
    recordAnswer(answers, "child", "2026-05-01", false);
    expect(planNewAnswers(answers, people, [{ id: "home", share_contact: null }])).toEqual([
      { id: "home", patch: { share_contact: true } },
    ]);
  });

  it("writes nothing when the household already holds the answer, or the sailor has no household", () => {
    const answers: NewAnswers = new Map([
      ["child", { at: "2026-06-01", value: true }],
      ["loner", { at: "2026-06-01", value: false }],
    ]);
    expect(planNewAnswers(answers, people, [{ id: "home", share_contact: true }])).toEqual([]);
  });
});
