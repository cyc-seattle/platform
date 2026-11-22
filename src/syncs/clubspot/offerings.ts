import { randomUUID } from "node:crypto";
import winston from "winston";
import {
  type CampRow,
  type ClassRow,
  type EntryCapRow,
  type ParticipantRow,
  type RegistrationEntryRow,
  type RegistrationRow,
  type SessionClassRow,
  type SessionRow,
} from "../../model/clubspot/index.ts";
import { type CrmRegistrationRow, type OfferingRow } from "../../model/crm/index.ts";
import { type DirectusClient } from "../runtime/index.ts";
import { type ClubspotSyncAuditFinding } from "./audit.ts";

/**
 * The registrations pass (cyc-seattle/isthmia#241, cyc-seattle/platform#332): makes the CRM's
 * `registrations` from the Clubspot mirrors, after the camp loop, each in the catalog offering staff
 * linked its Clubspot class (and session) to. It reads every camp, archived ones too, so a class linked
 * late, or a past season, still gets its registrations. It also keeps each offering's confirmed count,
 * each class's program, and reports an offering whose dates or limit differ from Clubspot's.
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

/** What Clubspot says of a class in a session, or of a class whose cap covers every session. */
export interface ClubspotOffering {
  starts_on: string | null;
  ends_on: string | null;
  capacity: number | null;
}

/**
 * What Clubspot says of each class in each session, keyed as an offering links to it. A class whose cap
 * covers every session (a cap with no session) is one, from its first session to its last. Archived
 * sessions are left out: Clubspot archives a session it no longer offers.
 */
export function clubspotOfferings(mirrors: Mirrors): Map<string, ClubspotOffering> {
  const campById = new Map(mirrors.camps.map((camp) => [camp.id, camp]));
  const sessionById = new Map(mirrors.sessions.filter((s) => !s.archived).map((session) => [session.id, session]));
  const found = new Map<string, ClubspotOffering>();
  for (const cls of mirrors.classes) {
    const sessions = mirrors.sessionClasses
      .filter((join) => join.class_id === cls.id)
      .map((join) => sessionById.get(join.session_id))
      .filter((session) => session !== undefined);
    const caps = mirrors.entryCaps.filter((cap) => cap.class_id === cls.id);
    const classWide = caps.find((cap) => cap.session_id === null);
    if (classWide !== undefined || sessions.length === 0) {
      const camp = campById.get(cls.camp_id);
      found.set(offeringKey(cls.id, null), {
        starts_on: earliest(sessions.length > 0 ? sessions.map((s) => s.start_date) : [camp?.start_date ?? null]),
        ends_on: latest(sessions.length > 0 ? sessions.map((s) => s.end_date) : [camp?.end_date ?? null]),
        capacity: classWide?.cap ?? null,
      });
      continue;
    }
    for (const session of sessions) {
      found.set(offeringKey(cls.id, session.id), {
        starts_on: session.start_date,
        ends_on: session.end_date,
        capacity: caps.find((cap) => cap.session_id === session.id)?.cap ?? null,
      });
    }
  }
  return found;
}

/** Each linked offering's ID, by the Clubspot class and session it's linked to. */
export function offeringIdsByKey(offerings: readonly OfferingRow[]): Map<string, string> {
  return new Map(
    offerings
      .filter((offering) => offering.clubspot_class_id !== null)
      .map((offering) => [offeringKey(offering.clubspot_class_id!, offering.clubspot_session_id), offering.id]),
  );
}

/**
 * Each class's program, from the offerings linked to it: theirs when they agree, and none when there are
 * none or they disagree. gsuite-sync still reads it.
 */
export function planClassPrograms(
  classes: readonly Pick<ClassRow, "id" | "program_id">[],
  offerings: readonly OfferingRow[],
): { id: string; patch: Pick<ClassRow, "program_id"> }[] {
  const programs = new Map<string, Set<string>>();
  for (const offering of offerings) {
    if (offering.clubspot_class_id === null) continue;
    const held = programs.get(offering.clubspot_class_id) ?? new Set<string>();
    held.add(offering.program_id);
    programs.set(offering.clubspot_class_id, held);
  }
  return classes.flatMap((cls) => {
    const held = programs.get(cls.id);
    const program = held?.size === 1 ? [...held][0]! : null;
    return program === cls.program_id ? [] : [{ id: cls.id, patch: { program_id: program } }];
  });
}

/** Each offering's count of confirmed registrations, where it changed. */
export function planConfirmedCounts(
  offerings: readonly OfferingRow[],
  registrations: readonly Pick<CrmRegistrationRow, "offering_id" | "status">[],
): { id: string; patch: Pick<OfferingRow, "confirmed_count"> }[] {
  const confirmed = new Map<string, number>();
  for (const registration of registrations) {
    if (registration.status !== "confirmed") continue;
    confirmed.set(registration.offering_id, (confirmed.get(registration.offering_id) ?? 0) + 1);
  }
  return offerings.flatMap((offering) => {
    const count = confirmed.get(offering.id) ?? 0;
    return count === offering.confirmed_count ? [] : [{ id: offering.id, patch: { confirmed_count: count } }];
  });
}

/**
 * `offering_differs` findings: an offering, not archived and not over by `today`, whose Clubspot class
 * and session have other dates or another limit, or don't exist as linked. The catalog is right, so the
 * fix is in Clubspot, or in the link.
 */
export function findOfferingDifferences(
  offerings: readonly OfferingRow[],
  fromClubspot: ReadonlyMap<string, ClubspotOffering>,
  today: string,
): ClubspotSyncAuditFinding[] {
  const findings: ClubspotSyncAuditFinding[] = [];
  for (const offering of offerings) {
    if (offering.clubspot_class_id === null || offering.archived_at !== null) continue;
    if (offering.ends_on !== null && offering.ends_on < today) continue;
    const clubspot = fromClubspot.get(offeringKey(offering.clubspot_class_id, offering.clubspot_session_id));
    const differences =
      clubspot === undefined
        ? ["Clubspot has no such class and session"]
        : (["starts_on", "ends_on", "capacity"] as const)
            .filter((field) => clubspot[field] !== offering[field])
            .map((field) => `${field} is ${String(offering[field])} here and ${String(clubspot[field])} in Clubspot`);
    if (differences.length === 0) continue;
    findings.push({
      source: "clubspot-sync",
      kind: "offering_differs",
      subject: offering.id,
      detail: `Offering ${offering.id}: ${differences.join("; ")}`,
    });
  }
  return findings;
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

  const classIds = new Set(mirrors.classes.map((cls) => cls.id));
  const sessionIds = new Set(mirrors.sessions.map((session) => session.id));
  const entryById = new Map(mirrors.entries.map((entry) => [entry.id, entry]));
  // A registration made from Clubspot rows written after the read, by a test or an overlapping run, is left alone.
  const judged = existing.filter((row) => {
    const entry = entryById.get(row.clubspot_entry_id);
    if (entry === undefined || !classIds.has(entry.class_id) || !sessionIds.has(entry.session_id)) return false;
    const participantId = participantByRegistration.get(entry.registration_id);
    return participantId !== undefined && personByParticipant.has(participantId);
  });
  const { toCreate, toUpdate, toDelete } = reconcile(judged, desired, (row) => row.clubspot_entry_id);
  return { toCreate, toUpdate, toDelete };
}

export interface OfferingSyncResult {
  /** Offerings whose confirmed count changed. */
  offeringsWritten: number;
  registrationsWritten: number;
  findings: ClubspotSyncAuditFinding[];
}

/** Directus's answer when a row points at one that's gone, such as a mirror row deleted mid-run. */
const isVanishedLink = (error: unknown) => error instanceof Error && error.message.includes('"INVALID_FOREIGN_KEY"');

/** Runs `write`, or skips it if the row it links to was deleted since this pass read the mirrors. */
async function unlessVanished(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    if (isVanishedLink(error)) return false;
    throw error;
  }
}

/** The unique field and value a create collided on, when another writer made the same row first. */
function duplicateOf(error: unknown): { field: string; value: string } | undefined {
  if (!(error instanceof Error)) return undefined;
  const body = error.message.match(/-> \d+: (\{.*\})$/s)?.[1];
  if (body === undefined) return undefined;
  try {
    const { errors } = JSON.parse(body) as { errors?: { extensions?: Record<string, unknown> }[] };
    const found = errors?.find((e) => e.extensions?.["code"] === "RECORD_NOT_UNIQUE")?.extensions;
    return found === undefined ? undefined : { field: String(found["field"]), value: String(found["value"]) };
  } catch {
    return undefined;
  }
}

/**
 * Creates `row`, or, if another writer created it since this pass read, such as an overlapping run,
 * updates theirs to match.
 */
async function createOrUpdate<Row extends { id: string }>(
  directus: DirectusClient,
  collection: string,
  row: Row,
): Promise<void> {
  try {
    await directus.createItems<Row>(collection, [row]);
  } catch (error) {
    const duplicate = duplicateOf(error);
    if (duplicate === undefined) throw error;
    const fields: Partial<Row> = { ...row };
    delete fields.id;
    await directus.updateItemsByQuery<Row>(collection, { [duplicate.field]: { _eq: duplicate.value } }, fields);
  }
}

export async function apply<Row extends { id: string }>(
  directus: DirectusClient,
  collection: string,
  plan: RowPlan<Row>,
): Promise<number> {
  // Deletes first, so a registration whose offering goes away goes with it before anything new lands.
  for (const id of plan.toDelete) await directus.deleteItem(collection, id);
  let written = plan.toDelete.length;
  let skipped = 0;
  const count = (ok: boolean) => (ok ? written++ : skipped++);
  if (plan.toCreate.length > 0) {
    // One vanished link or duplicate fails the whole batch, so a failed batch is retried a row at a time.
    try {
      await directus.createItems<Row>(collection, plan.toCreate);
      written += plan.toCreate.length;
    } catch (error) {
      if (!isVanishedLink(error) && duplicateOf(error) === undefined) throw error;
      for (const row of plan.toCreate) count(await unlessVanished(() => createOrUpdate(directus, collection, row)));
    }
  }
  for (const { id, patch } of plan.toUpdate) {
    count(await unlessVanished(() => directus.updateItem<Row>(collection, id, patch)));
  }
  if (skipped > 0) {
    winston.warn(`Skipped ${skipped} ${collection} whose Clubspot row was deleted during the run`, { skipped });
  }
  return written;
}

/**
 * Reads the mirrors and the offerings, then brings `registrations`, each offering's confirmed count, and
 * each class's program in line with them. Returns the offerings that differ from Clubspot, for the audit.
 */
export async function syncOfferings(directus: DirectusClient, today: string): Promise<OfferingSyncResult> {
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

  const offerings = await directus.readItems<OfferingRow>("offerings", {
    ...all,
    fields: [
      "id",
      "program_id",
      "starts_on",
      "ends_on",
      "capacity",
      "clubspot_class_id",
      "clubspot_session_id",
      "confirmed_count",
      "archived_at",
    ],
  });
  const plan = planRegistrations(
    mirrors,
    offeringIdsByKey(offerings),
    await directus.readItems<CrmRegistrationRow>("registrations", all),
  );
  const registrationsWritten = await apply(directus, "registrations", plan);

  let offeringsWritten = 0;
  const registered = await directus.readItems<CrmRegistrationRow>("registrations", {
    ...all,
    fields: ["offering_id", "status"],
  });
  for (const { id, patch } of planConfirmedCounts(offerings, registered)) {
    if (await unlessVanished(() => directus.updateItem<OfferingRow>("offerings", id, patch))) offeringsWritten++;
  }
  for (const { id, patch } of planClassPrograms(classes, offerings)) {
    await unlessVanished(() => directus.updateItem<ClassRow>("clubspot_classes", id, patch));
  }
  return {
    offeringsWritten,
    registrationsWritten,
    findings: findOfferingDifferences(offerings, clubspotOfferings(mirrors), today),
  };
}
