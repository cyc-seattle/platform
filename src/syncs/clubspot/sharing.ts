import { type ParticipantRow, type RegistrationRow } from "../../model/clubspot/index.ts";
import { type ContactRow, type PersonRow } from "../../model/crm/index.ts";

/**
 * The per-person opt-in, `people.share_contact` (cyc-seattle/workplace#6 decision 10). Clubspot asks
 * the sharing question once per registration, so an answer counts for the sailor if they're an
 * adult, or for the guardians their form names if not. The latest answer counts: a new or changed
 * Clubspot answer replaces a family's or staff's edit, and an edit stands until the next answer.
 */

export type SharingParticipant = Pick<
  ParticipantRow,
  "person_id" | "date_of_birth" | "guardian_1_name" | "guardian_2_name"
>;
export type GuardianLink = Pick<ContactRow, "subject_id" | "contact_id" | "contact_order" | "relationship_type">;

/** Adult on the day they registered. A missing date of birth counts as a child. */
function adultOn(dateOfBirth: string | null, registeredAt: string): boolean {
  if (!dateOfBirth) return false;
  const eighteenth = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18);
  return eighteenth.getTime() <= new Date(registeredAt).getTime();
}

/** The people one registration's answer is for. */
export function sharingTargets(
  participant: SharingParticipant,
  registeredAt: string,
  guardianLinks: readonly GuardianLink[],
): string[] {
  const personId = participant.person_id;
  if (!personId) return [];
  if (adultOn(participant.date_of_birth, registeredAt)) return [personId];
  // A form's guardian slots are the child's guardian links with that contact_order.
  const named = new Set<number>();
  if (participant.guardian_1_name?.trim()) named.add(1);
  if (participant.guardian_2_name?.trim()) named.add(2);
  return guardianLinks
    .filter(
      (link) => link.subject_id === personId && link.relationship_type === "guardian" && named.has(link.contact_order),
    )
    .map((link) => link.contact_id);
}

export interface SharingPatch {
  id: string;
  patch: Pick<PersonRow, "share_contact">;
}

/**
 * Fills a person's blank `share_contact` from the newest registration that answered for them, so
 * people who answered before this pass existed get their answer. Never replaces a value.
 */
export function planSharingBackfill(
  registrations: readonly Pick<RegistrationRow, "participant_id" | "registered_at" | "share_contact">[],
  participants: readonly (SharingParticipant & { id: string })[],
  guardianLinks: readonly GuardianLink[],
  people: readonly Pick<PersonRow, "id" | "share_contact">[],
): SharingPatch[] {
  const blank = new Set(people.filter((person) => person.share_contact == null).map((person) => person.id));
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const newest = new Map<string, { at: string; value: boolean }>();
  for (const registration of registrations) {
    const participant = participantById.get(registration.participant_id);
    if (registration.share_contact == null || !participant) continue;
    for (const personId of sharingTargets(participant, registration.registered_at, guardianLinks)) {
      if (!blank.has(personId)) continue;
      const known = newest.get(personId);
      if (!known || registration.registered_at > known.at) {
        newest.set(personId, { at: registration.registered_at, value: registration.share_contact });
      }
    }
  }
  return [...newest].map(([id, { value }]) => ({ id, patch: { share_contact: value } }));
}
