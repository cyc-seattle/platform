import winston from "winston";
import { type ContactRow, isValidEmail, normalizeEmail, type PersonRow } from "../../model/crm/index.ts";
import { type CrewMemberRow, type CrewTermRow, isCurrentTerm, seattleDate } from "../../model/crew/index.ts";
import {
  type CampRow,
  type ClassRow,
  type ParticipantRow,
  type RegistrationEntryRow,
  type RegistrationRow,
} from "../../model/clubspot/index.ts";
import { type DirectusClient } from "../runtime/index.ts";
import { isCampActive } from "./camps.ts";

/** The fields of a Crew term the Google sync reads: never its pay. */
export type ProgramTermRow = Pick<CrewTermRow, "crew_member_id" | "program_id" | "starts_on" | "ends_on">;

/** The rows a program-group membership plan reads. See `run.ts` for where these come from. */
export interface MembershipTables {
  classes: readonly ClassRow[];
  camps: readonly CampRow[];
  registrationEntries: readonly RegistrationEntryRow[];
  registrations: readonly RegistrationRow[];
  participants: readonly Pick<ParticipantRow, "id" | "person_id">[];
  people: readonly PersonRow[];
  contacts: readonly ContactRow[];
  /** Crew's terms, each for a program or none. Someone with a current one for a program is in its group. */
  crewTerms: readonly ProgramTermRow[];
  crewMembers: readonly Pick<CrewMemberRow, "id" | "person_id">[];
}

/** Crew's terms and members, as the Google sync may read them: never a term's pay. */
export function readCrew(
  directus: DirectusClient,
): Promise<[ProgramTermRow[], Pick<CrewMemberRow, "id" | "person_id">[]]> {
  return Promise.all([
    directus.readItems<ProgramTermRow>("crew_terms", {
      fields: ["crew_member_id", "program_id", "starts_on", "ends_on"],
      limit: -1,
    }),
    directus.readItems<Pick<CrewMemberRow, "id" | "person_id">>("crew_members", {
      fields: ["id", "person_id"],
      limit: -1,
    }),
  ]);
}

/** Each crew member's person. */
function personOfCrewMember(tables: Pick<MembershipTables, "crewMembers">): Map<string, string> {
  return new Map(tables.crewMembers.map((member) => [member.id, member.person_id]));
}

/** The people with a current term for `programId`. */
function currentTermHolders(programId: string, tables: MembershipTables, now: Date): Set<string> {
  const personOf = personOfCrewMember(tables);
  return new Set(
    tables.crewTerms
      .filter((term) => term.program_id === programId && isCurrentTerm(term, now))
      .flatMap((term) => personOf.get(term.crew_member_id) ?? []),
  );
}

/**
 * The people whose last term for `programId` has ended: they had one that ended before today, and
 * have none current. A term that hasn't started yet doesn't count either way.
 */
export function programLeavers(programId: string, tables: MembershipTables, now: Date): PersonRow[] {
  const personOf = personOfCrewMember(tables);
  const today = seattleDate(now);
  const current = currentTermHolders(programId, tables, now);
  const ended = new Set(
    tables.crewTerms
      .filter((term) => term.program_id === programId && term.ends_on != null && term.ends_on < today)
      .flatMap((term) => personOf.get(term.crew_member_id) ?? [])
      .filter((personId) => !current.has(personId)),
  );
  return tables.people.filter((person) => person.id && ended.has(person.id));
}

export interface PlanProgramMembersOptions {
  /** Count every class's participants, whether or not its camp is active: the `all` plan the audit
   * finds stale members with (see `plannedGroupMembers`). Crew terms are unaffected. */
  includeInactiveCamps?: boolean;
}

function addEmail(emails: Set<string>, raw: string): void {
  if (isValidEmail(raw)) {
    emails.add(normalizeEmail(raw));
  }
}

/**
 * The people `planProgramMembers` draws its emails from - participants, their guardians, and
 * current term holders - before any email is checked. The audit uses this to report the unusable
 * addresses that are actually keeping someone out of a group, and nobody else.
 */
export function planProgramMemberPeople(
  programId: string,
  tables: MembershipTables,
  now: Date,
  options: PlanProgramMembersOptions = {},
): PersonRow[] {
  const campById = new Map(tables.camps.filter((row) => row.id).map((row) => [row.id as string, row]));
  const classIds = new Set(
    tables.classes
      .filter((cls) => cls.program_id === programId)
      .filter((cls) => {
        if (options.includeInactiveCamps) {
          return true;
        }
        const camp = campById.get(cls.camp_id);
        return camp != null && isCampActive(camp, now);
      })
      .map((cls) => cls.id),
  );
  const registrationById = new Map(tables.registrations.filter((row) => row.id).map((row) => [row.id as string, row]));
  const personIdByParticipantId = new Map(
    tables.participants
      .filter((row) => row.id && row.person_id)
      .map((row) => [row.id as string, row.person_id as string]),
  );
  const personById = new Map(tables.people.filter((row) => row.id).map((row) => [row.id as string, row]));

  const registrationParticipantIds = new Set(
    tables.registrationEntries
      .filter((entry) => classIds.has(entry.class_id) && entry.status === "confirmed")
      .map((entry) => registrationById.get(entry.registration_id)?.participant_id)
      .filter((participantId): participantId is string => participantId != null),
  );

  const personIds = new Set<string>();
  let unlinkedParticipants = 0;
  for (const participantId of registrationParticipantIds) {
    const personId = personIdByParticipantId.get(participantId);
    if (!personId) {
      unlinkedParticipants++;
      continue;
    }
    personIds.add(personId);
  }
  if (unlinkedParticipants > 0) {
    winston.warn(`Skipped ${unlinkedParticipants} confirmed participants with no resolved person`, {
      programId,
      unlinkedParticipants,
    });
  }

  const people = new Map<string, PersonRow>();
  const include = (personId: string): void => {
    const person = personById.get(personId);
    if (person?.id && person.email) {
      people.set(person.id, person);
    }
  };

  for (const personId of personIds) {
    include(personId);
    for (const contact of tables.contacts) {
      if (contact.subject_id === personId && contact.relationship_type === "guardian") {
        include(contact.contact_id);
      }
    }
  }

  for (const personId of currentTermHolders(programId, tables, now)) {
    include(personId);
  }

  return [...people.values()];
}

/**
 * The member emails one program's Google Group should have: participants with a confirmed
 * `clubspot_registration_entries` row for one of the program's classes (`classes.program_id`), their
 * guardians, the participant's own email when set - which is what makes an adult with no guardian
 * row work with no special case - and every person with a current Crew term for the program. Each
 * is a plain `MEMBER`; there's no separate manager mapping. Never emergency contacts. Deduped by lowercased, trimmed email, since a family commonly shares one.
 *
 * This is who belongs, not what to write: the membership task diffs these people against live
 * membership and `google_group_memberships` (see `planMembershipWrites`). It takes out only someone
 * whose term ended (see `planProgramGroupRemovals`).
 *
 * A class only contributes participants while its camp is current or upcoming (see `isCampActive`,
 * cyc-seattle/isthmia#265), unless `options.includeInactiveCamps` is set. A class whose camp can't be found doesn't
 * contribute. Terms have their own `starts_on`/`ends_on` instead, and must keep working for a
 * program with no active camp at all (cyc-seattle/isthmia#149).
 */
export function planProgramMembers(
  programId: string,
  tables: MembershipTables,
  now: Date,
  options: PlanProgramMembersOptions = {},
): string[] {
  const emails = new Set<string>();
  for (const person of planProgramMemberPeople(programId, tables, now, options)) {
    addEmail(emails, person.email as string);
  }
  return [...emails].sort();
}
