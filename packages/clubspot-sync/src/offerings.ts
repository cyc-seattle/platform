import { randomUUID } from "node:crypto";
import {
  type CampRow,
  type ClassRow,
  type EntryCapRow,
  type ParticipantRow,
  type RegistrationEntryRow,
  type RegistrationRow,
  type SessionClassRow,
  type SessionRow,
} from "@cyc-seattle/clubspot";
import { type CrmRegistrationRow, type OfferingRow } from "@cyc-seattle/crm";
import { type DirectusClient } from "@cyc-seattle/directus";

/**
 * The offerings and registrations pass (cyc-seattle/isthmia#241): makes the CRM's own `offerings`
 * and `registrations` from the Clubspot mirrors, after the camp loop. It reads every camp, archived
 * ones too, so a class linked to a program late, or a past season, still gets its offerings.
 */

export interface Mirrors {
  camps: readonly Pick<CampRow, "id" | "start_date" | "end_date">[];
  sessions: readonly Pick<SessionRow, "id" | "camp_id" | "start_date" | "end_date" | "archived">[];
  classes: readonly Pick<ClassRow, "id" | "camp_id" | "program_id">[];
  sessionClasses: readonly Pick<SessionClassRow, "session_id" | "class_id">[];
  entryCaps: readonly Pick<EntryCapRow, "class_id" | "session_id" | "cap">[];
  entries: readonly Pick<RegistrationEntryRow, "id" | "registration_id" | "session_id" | "class_id" | "status">[];
  registrations: readonly Pick<RegistrationRow, "id" | "participant_id">[];
  participants: readonly Pick<ParticipantRow, "id" | "person_id">[];
}

export interface RowPlan<Row extends { id: string }> {
  toCreate: Row[];
  toUpdate: { id: string; patch: Partial<Row> }[];
  toDelete: string[];
}

const offeringKey = (classId: string, sessionId: string | null) => `${classId}:${sessionId ?? ""}`;

function earliest(dates: (string | null)[]): string | null {
  const known = dates.filter((date): date is string => date !== null).sort();
  return known[0] ?? null;
}

function latest(dates: (string | null)[]): string | null {
  const known = dates.filter((date): date is string => date !== null).sort();
  return known[known.length - 1] ?? null;
}

/** Keeps only `desired`'s fields that differ from `existing`. */
function changes<Row extends object>(existing: Row, desired: Row): Partial<Row> {
  return Object.fromEntries(
    Object.entries(desired).filter(([field, value]) => (existing as Record<string, unknown>)[field] !== value),
  ) as Partial<Row>;
}

function reconcile<Row extends { id: string }>(
  existing: readonly Row[],
  desired: Map<string, Omit<Row, "id">>,
  keyOf: (row: Row) => string,
): RowPlan<Row> & { idByKey: Map<string, string> } {
  const plan: RowPlan<Row> = { toCreate: [], toUpdate: [], toDelete: [] };
  const idByKey = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of existing) {
    const key = keyOf(row);
    const want = desired.get(key);
    // A second row for the same key is left over from a crash between a create and its read back.
    if (want === undefined || seen.has(key)) {
      plan.toDelete.push(row.id);
      continue;
    }
    seen.add(key);
    idByKey.set(key, row.id);
    const patch = changes(row, { ...want, id: row.id } as Row);
    if (Object.keys(patch).length > 0) plan.toUpdate.push({ id: row.id, patch });
  }
  for (const [key, want] of desired) {
    if (seen.has(key)) continue;
    const row = { ...want, id: randomUUID() } as Row;
    idByKey.set(key, row.id);
    plan.toCreate.push(row);
  }
  return { ...plan, idByKey };
}

/**
 * One offering for each class with a program and each of its sessions. A class whose cap covers
 * every session (a cap with no session) is one offering, from its first session to its last.
 * Archived sessions are left out: Clubspot archives a session it no longer offers.
 */
export function planOfferings(
  mirrors: Mirrors,
  existing: readonly OfferingRow[],
): RowPlan<OfferingRow> & { idByKey: Map<string, string> } {
  const campById = new Map(mirrors.camps.map((camp) => [camp.id, camp]));
  const sessionById = new Map(mirrors.sessions.filter((s) => !s.archived).map((session) => [session.id, session]));
  const desired = new Map<string, Omit<OfferingRow, "id">>();

  for (const cls of mirrors.classes) {
    if (cls.program_id === null) continue;
    const sessions = mirrors.sessionClasses
      .filter((join) => join.class_id === cls.id)
      .map((join) => sessionById.get(join.session_id))
      .filter((session) => session !== undefined);
    const caps = mirrors.entryCaps.filter((cap) => cap.class_id === cls.id);
    const classWide = caps.find((cap) => cap.session_id === null);

    if (classWide !== undefined || sessions.length === 0) {
      const camp = campById.get(cls.camp_id);
      desired.set(offeringKey(cls.id, null), {
        program_id: cls.program_id,
        starts_on: earliest(sessions.length > 0 ? sessions.map((s) => s.start_date) : [camp?.start_date ?? null]),
        ends_on: latest(sessions.length > 0 ? sessions.map((s) => s.end_date) : [camp?.end_date ?? null]),
        capacity: classWide?.cap ?? null,
        clubspot_class_id: cls.id,
        clubspot_session_id: null,
      });
      continue;
    }
    for (const session of sessions) {
      desired.set(offeringKey(cls.id, session.id), {
        program_id: cls.program_id,
        starts_on: session.start_date,
        ends_on: session.end_date,
        capacity: caps.find((cap) => cap.session_id === session.id)?.cap ?? null,
        clubspot_class_id: cls.id,
        clubspot_session_id: session.id,
      });
    }
  }

  return reconcile(existing, desired, (row) => offeringKey(row.clubspot_class_id, row.clubspot_session_id));
}

/**
 * One registration for each registration entry in an offering, for the person its participant is
 * linked to. An entry whose participant has no person yet waits for the match.
 */
export function planRegistrations(
  mirrors: Mirrors,
  offeringIdByKey: ReadonlyMap<string, string>,
  existing: readonly CrmRegistrationRow[],
): RowPlan<CrmRegistrationRow> {
  const participantByRegistration = new Map(mirrors.registrations.map((r) => [r.id, r.participant_id]));
  const personByParticipant = new Map(mirrors.participants.map((p) => [p.id, p.person_id]));
  const desired = new Map<string, Omit<CrmRegistrationRow, "id">>();

  for (const entry of mirrors.entries) {
    const participantId = participantByRegistration.get(entry.registration_id);
    const personId = participantId === undefined ? null : (personByParticipant.get(participantId) ?? null);
    const offeringId =
      offeringIdByKey.get(offeringKey(entry.class_id, null)) ??
      offeringIdByKey.get(offeringKey(entry.class_id, entry.session_id));
    if (personId === null || offeringId === undefined) continue;
    desired.set(entry.id, {
      person_id: personId,
      offering_id: offeringId,
      status: entry.status as CrmRegistrationRow["status"],
      clubspot_entry_id: entry.id,
    });
  }

  const { toCreate, toUpdate, toDelete } = reconcile(existing, desired, (row) => row.clubspot_entry_id);
  return { toCreate, toUpdate, toDelete };
}

export interface OfferingSyncCounts {
  offeringsWritten: number;
  registrationsWritten: number;
}

async function apply<Row extends { id: string }>(
  directus: DirectusClient,
  collection: string,
  plan: RowPlan<Row>,
): Promise<number> {
  // Deletes first, so a registration whose offering goes away goes with it before anything new lands.
  for (const id of plan.toDelete) await directus.deleteItem(collection, id);
  if (plan.toCreate.length > 0) await directus.createItems<Row>(collection, plan.toCreate);
  for (const { id, patch } of plan.toUpdate) await directus.updateItem<Row>(collection, id, patch);
  return plan.toCreate.length + plan.toUpdate.length + plan.toDelete.length;
}

/** Reads the mirrors, then brings `offerings` and `registrations` in line with them. */
export async function syncOfferings(directus: DirectusClient): Promise<OfferingSyncCounts> {
  const all = { limit: -1 } as const;
  const [camps, sessions, classes, sessionClasses, entryCaps, entries, registrations, participants] = await Promise.all(
    [
      directus.readItems<Mirrors["camps"][number]>("clubspot_camps", {
        ...all,
        fields: ["id", "start_date", "end_date"],
      }),
      directus.readItems<Mirrors["sessions"][number]>("clubspot_sessions", {
        ...all,
        fields: ["id", "camp_id", "start_date", "end_date", "archived"],
      }),
      directus.readItems<Mirrors["classes"][number]>("clubspot_classes", {
        ...all,
        fields: ["id", "camp_id", "program_id"],
      }),
      directus.readItems<Mirrors["sessionClasses"][number]>("clubspot_session_classes", {
        ...all,
        fields: ["session_id", "class_id"],
      }),
      directus.readItems<Mirrors["entryCaps"][number]>("clubspot_entry_caps", {
        ...all,
        fields: ["class_id", "session_id", "cap"],
      }),
      directus.readItems<Mirrors["entries"][number]>("clubspot_registration_entries", {
        ...all,
        fields: ["id", "registration_id", "session_id", "class_id", "status"],
      }),
      directus.readItems<Mirrors["registrations"][number]>("clubspot_registrations", {
        ...all,
        fields: ["id", "participant_id"],
      }),
      directus.readItems<Mirrors["participants"][number]>("clubspot_participants", {
        ...all,
        fields: ["id", "person_id"],
      }),
    ],
  );
  const mirrors: Mirrors = {
    camps,
    sessions,
    classes,
    sessionClasses,
    entryCaps,
    entries,
    registrations,
    participants,
  };

  const offerings = planOfferings(mirrors, await directus.readItems<OfferingRow>("offerings", all));
  const offeringsWritten = await apply(directus, "offerings", offerings);
  const plan = planRegistrations(
    mirrors,
    offerings.idByKey,
    await directus.readItems<CrmRegistrationRow>("registrations", all),
  );
  const registrationsWritten = await apply(directus, "registrations", plan);
  return { offeringsWritten, registrationsWritten };
}
