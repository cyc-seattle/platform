import { type ParticipantRow, type RegistrationRow } from "../../model/clubspot/index.ts";
import { type HouseholdRow, type PersonRow } from "../../model/crm/index.ts";

/**
 * The opt-in, `households.share_contact`. Clubspot asks the sharing question once per
 * registration, and the answer counts for the sailor's whole household. The latest answer counts: a
 * new or changed Clubspot answer replaces a family's or staff's edit, and an edit stands until the
 * next answer.
 */

export interface SharingPatch {
  id: string;
  patch: Pick<HouseholdRow, "share_contact">;
}

/**
 * Fills a household's blank `share_contact` from the newest registration that answered for any
 * sailor in it, so a household made this run gets its answer. Never replaces a value.
 */
export function planSharingBackfill(
  registrations: readonly Pick<RegistrationRow, "participant_id" | "registered_at" | "share_contact">[],
  participants: readonly Pick<ParticipantRow, "id" | "person_id">[],
  people: readonly (Pick<PersonRow, "household_id"> & { id: string })[],
  households: readonly HouseholdRow[],
): SharingPatch[] {
  const blank = new Set(households.filter((household) => household.share_contact == null).map(({ id }) => id));
  const personById = new Map(people.map((person) => [person.id, person]));
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const newest = new Map<string, { at: string; value: boolean }>();
  for (const registration of registrations) {
    const personId = participantById.get(registration.participant_id)?.person_id;
    const householdId = personId ? personById.get(personId)?.household_id : undefined;
    if (registration.share_contact == null || !householdId || !blank.has(householdId)) continue;
    const known = newest.get(householdId);
    if (!known || registration.registered_at > known.at) {
      newest.set(householdId, { at: registration.registered_at, value: registration.share_contact });
    }
  }
  return [...newest].map(([id, { value }]) => ({ id, patch: { share_contact: value } }));
}

/** This run's new or changed Clubspot answers, by the sailor's person, each the newest they gave. */
export type NewAnswers = Map<string, { at: string; value: boolean }>;

/** Keeps `value` for `personId` unless the run already has a newer answer for them. */
export function recordAnswer(answers: NewAnswers, personId: string, at: string, value: boolean): void {
  const known = answers.get(personId);
  if (!known || at > known.at) answers.set(personId, { at, value });
}

/**
 * Applies this run's new answers after the households pass, so a sailor who had no household when
 * their registration synced still counts. A household takes its sailors' newest answer, by when
 * they registered, replacing whatever it held.
 */
export function planNewAnswers(
  answers: NewAnswers,
  people: readonly (Pick<PersonRow, "household_id"> & { id: string })[],
  households: readonly HouseholdRow[],
): SharingPatch[] {
  const current = new Map(households.map((household) => [household.id, household.share_contact]));
  const newest = new Map<string, { at: string; value: boolean }>();
  for (const person of people) {
    const answer = answers.get(person.id);
    if (!answer || !person.household_id || !current.has(person.household_id)) continue;
    const known = newest.get(person.household_id);
    if (!known || answer.at > known.at) newest.set(person.household_id, answer);
  }
  return [...newest]
    .filter(([id, { value }]) => current.get(id) !== value)
    .map(([id, { value }]) => ({ id, patch: { share_contact: value } }));
}
