import { newRunId, proxyOk } from "../cluster.ts";

// The sync scenarios seed dev's Clubspot fake through Parse's REST API. Their camps and people carry
// the run's ID, so runs never depend on each other (cyc-seattle/isthmia#185).

// The fake's seed, which the dev stack's clubspot-sync config names (contract: public test values).
const CLUB_ID = "seedClub01";
const parseHeaders = {
  "x-parse-application-id": "myclubspot2017",
  "x-parse-master-key": "fake-master-key-for-tests-only",
};

const pointer = (className: string, objectId: string) => ({ __type: "Pointer", className, objectId });
const date = (offsetDays: number) => ({
  __type: "Date",
  iso: new Date(Date.now() + offsetDays * 86_400_000).toISOString(),
});

/** Creates a Parse object with a chosen objectId, which the fake allows, so later objects can point at it. */
async function create(className: string, objectId: string, fields: Record<string, unknown>): Promise<void> {
  await proxyOk("clubspot-fake", 1337, "POST", `/parse/classes/${className}`, { objectId, ...fields }, parseHeaders);
}

export type ClubspotRun = ReturnType<typeof clubspotRun>;

/** A run's names for its rows in the Clubspot fake, and its sailor and parent. */
export function clubspotRun() {
  const runId = newRunId();
  const id = (kind: string) => `${kind}${runId}`;
  const participant = {
    firstName: "Sync",
    lastName: `Sailor ${runId}`,
    guardianFirst: "Guardian",
    guardianLast: `Sailor ${runId}`,
    guardianEmail: `guardian.${runId}@example.test`,
  };
  /** The camp's sharing question, which a `clubspot_promoted_fields` row maps to `share_contact`. */
  const sharingQuestion = `Share our contact details ${runId}`;
  return { runId, id, participant, sharingQuestion };
}

/** A camp running today in the Clubspot fake, with one session, one class, and the sharing question. */
export async function seedClass({ runId, id, sharingQuestion }: ClubspotRun): Promise<void> {
  const club = pointer("clubs", CLUB_ID);
  const camp = pointer("camps", id("cmp"));
  await create("customFields", id("fld"), {
    clubObject: club,
    campObject: camp,
    name: sharingQuestion,
    type: "radio",
    required: false,
    allClasses: true,
    hide_from_member: false,
  });
  await create("camps", id("cmp"), {
    clubObject: club,
    name: `Integration camp ${runId}`,
    startDate: date(-7),
    endDate: date(30),
    customFieldsArray: [pointer("customFields", id("fld"))],
  });
  await create("campSessions", id("ses"), {
    clubObject: club,
    campObject: camp,
    name: "Week 1",
    startDate: date(-7),
    endDate: date(30),
  });
  await create("campClasses", id("cls"), {
    clubObject: club,
    campObject: camp,
    name: `Integration class ${runId}`,
  });
}

/**
 * The run's sailor, a child with a parent, registered for its class in the Clubspot fake. A later
 * registration (`signUp` above 1) is a new sign-up by the same family, with its own sharing answer.
 */
export async function seedSailor(
  { id, participant }: ClubspotRun,
  { share, signUp = 1 }: { share?: boolean; signUp?: number } = {},
): Promise<void> {
  const camp = pointer("camps", id("cmp"));
  const session = pointer("campSessions", id("ses"));
  const campClass = pointer("campClasses", id("cls"));
  const confirmed = date(0);
  const suffix = signUp === 1 ? "" : String(signUp);
  await create("participants", id(`par${suffix}`), {
    firstName: participant.firstName,
    lastName: participant.lastName,
    DOB: { __type: "Date", iso: "2015-05-01T00:00:00.000Z" },
    parentGuardianName: `${participant.guardianFirst} ${participant.guardianLast}`,
    parentGuardianEmail: participant.guardianEmail,
    parentGuardianMobile: "206-555-0199",
    customFieldsArray: share === undefined ? [] : [{ customFieldID: id("fld"), response: share ? "Yes" : "No" }],
  });
  // The join points back at the registration, so it names the registration's objectId first.
  await create("registration_campSession", id(`jn${suffix}`), {
    campObject: camp,
    campSessionObject: session,
    campClassObject: campClass,
    registrationObject: pointer("registrations", id(`reg${suffix}`)),
    confirmed_at: confirmed,
    status: "confirmed",
    priority: 1,
    waitlist: false,
  });
  await create("registrations", id(`reg${suffix}`), {
    clubObject: pointer("clubs", CLUB_ID),
    campObject: camp,
    confirmed_at: confirmed,
    status: "confirmed",
    participantsArray: [pointer("participants", id(`par${suffix}`))],
    sessions: [session],
    classes: [campClass],
    sessionJoinObjects: [pointer("registration_campSession", id(`jn${suffix}`))],
  });
}
