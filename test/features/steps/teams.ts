import { randomUUID } from "node:crypto";
import { adminCreate, key, newRow, runId } from "./rows.ts";

// Programs, and sailors signed up for them, as Clubspot's mirrors and the CRM's own offerings and
// registrations both hold them. Each offering and registration is the one clubspot-sync would make
// from the mirrors, so a sync run during the tests leaves them be.

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** When a camp ran, as days from today: running now, ended a month ago, or ended 13 months ago. */
export const SEASONS = {
  running: [-7, 7],
  ended: [-60, -30],
  lapsed: [-430, -400],
} as const;
export type Season = keyof typeof SEASONS;

export interface Camp {
  id: string;
  sessionId: string;
  startsOn: string;
  endsOn: string;
}

export interface Program {
  camp: Camp;
  programId: string;
  classId: string;
  offeringId: string;
}

export async function newCamp(season: Season): Promise<Camp> {
  const [start, end] = SEASONS[season];
  const startsOn = daysFromNow(start);
  const endsOn = daysFromNow(end);
  const { id } = await adminCreate("clubspot_camps", {
    id: key("camp"),
    name: `Camp ${runId}`,
    start_date: startsOn,
    end_date: endsOn,
  });
  const session = await adminCreate("clubspot_sessions", { id: key("session"), camp_id: id });
  return { id, sessionId: session.id, startsOn, endsOn };
}

/** A program's class in `camp`, and its offering. A team is a program the club marks as one. */
export async function newProgram(camp: Camp, { team = false, programId }: { team?: boolean; programId?: string } = {}) {
  const program =
    programId ??
    (await adminCreate("programs", await newRow("programs", { name: `Program ${key("program")}`, team }))).id;
  const { id: classId } = await adminCreate("clubspot_classes", {
    id: key("class"),
    name: `Class ${runId}`,
    camp_id: camp.id,
    program_id: program,
  });
  // A class with no sessions of its own is one offering, over its camp's dates.
  const offering = await adminCreate("offerings", {
    id: randomUUID(),
    program_id: program,
    starts_on: camp.startsOn,
    ends_on: camp.endsOn,
    capacity: null,
    clubspot_class_id: classId,
    clubspot_session_id: null,
  });
  return { camp, programId: program, classId, offeringId: offering.id } satisfies Program;
}

export interface SignUp {
  registrationId: string;
  entryId: string;
  participantId: string;
}

/** Confirms `personId` in `on`, with their answer to Clubspot's sharing question. */
export async function signUp(personId: string, on: Program, share: boolean | null = null): Promise<SignUp> {
  const participant = await adminCreate("clubspot_participants", { id: key("participant"), person_id: personId });
  const registration = await adminCreate("clubspot_registrations", {
    id: key("registration"),
    camp_id: on.camp.id,
    registered_at: new Date().toISOString(),
    status: "confirmed",
    participant_id: participant.id,
    share_contact: share,
  });
  const entry = await adminCreate("clubspot_registration_entries", {
    id: key("entry"),
    registration_id: registration.id,
    session_id: on.camp.sessionId,
    class_id: on.classId,
    status: "confirmed",
  });
  await adminCreate("registrations", {
    id: randomUUID(),
    person_id: personId,
    offering_id: on.offeringId,
    status: "confirmed",
    clubspot_entry_id: entry.id,
  });
  return { registrationId: registration.id, entryId: entry.id, participantId: participant.id };
}

/** Signs `personId` up for a team of their own, in `season`. */
export async function onATeam(personId: string, season: Season = "running"): Promise<void> {
  await signUp(personId, await newProgram(await newCamp(season), { team: true }));
}
