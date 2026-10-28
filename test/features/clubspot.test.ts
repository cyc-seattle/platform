import { expect } from "vitest";
import { asAdmin, newRunId, proxyOk, runCronJob } from "./cluster.ts";
import { canSet, describeAccessFeature, Step } from "./steps/index.ts";
import { admin, adminCreate, itemPath, key } from "./steps/rows.ts";

// The sync scenarios seed dev's CRM, and its Clubspot fake through Parse's REST API, run the
// clubspot-sync CronJob once as a Job, and read the result through Directus's REST API. Their camps
// and people carry the run's ID, so runs never depend on each other (cyc-seattle/isthmia#185).

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

Step("they can set which program a class belongs to", () => canSet("classes", "program_id"));
Step("they can match a registration's sailor to a person in the CRM", () => canSet("participants", "person_id"));

Step(
  "it can move people's program roles, the sessions they staff, and which Google groups they're in to another person",
  async () => {
    for (const collection of ["program_role_assignments", "event_staff", "google_group_memberships"]) {
      await canSet(collection, "person_id");
    }
  },
);

describeAccessFeature("clubspot.feature", {
  "A sailor's registration adds the sailor and their parent to the CRM": ({ Given, And, When, Then }) => {
    const runId = newRunId();
    const id = (kind: string) => `${kind}${runId}`;
    const participant = {
      firstName: "Sync",
      lastName: `Sailor ${runId}`,
      guardianFirst: "Guardian",
      guardianLast: `Sailor ${runId}`,
      guardianEmail: `guardian.${runId}@example.test`,
    };

    Given("a class running today in Clubspot", async () => {
      const club = pointer("clubs", CLUB_ID);
      await create("camps", id("cmp"), {
        clubObject: club,
        name: `Integration camp ${runId}`,
        startDate: date(-7),
        endDate: date(30),
      });
      await create("campSessions", id("ses"), {
        clubObject: club,
        campObject: pointer("camps", id("cmp")),
        name: "Week 1",
        startDate: date(-7),
        endDate: date(30),
      });
      await create("campClasses", id("cls"), {
        clubObject: club,
        campObject: pointer("camps", id("cmp")),
        name: `Integration class ${runId}`,
      });
    });

    And("a sailor registered for it, with a parent", async () => {
      const camp = pointer("camps", id("cmp"));
      const session = pointer("campSessions", id("ses"));
      const campClass = pointer("campClasses", id("cls"));
      const confirmed = date(0);
      await create("participants", id("par"), {
        firstName: participant.firstName,
        lastName: participant.lastName,
        DOB: { __type: "Date", iso: "2015-05-01T00:00:00.000Z" },
        parentGuardianName: `${participant.guardianFirst} ${participant.guardianLast}`,
        parentGuardianEmail: participant.guardianEmail,
        parentGuardianMobile: "206-555-0199",
      });
      // The join points back at the registration, so it names the registration's objectId first.
      await create("registration_campSession", id("jn"), {
        campObject: camp,
        campSessionObject: session,
        campClassObject: campClass,
        registrationObject: pointer("registrations", id("reg")),
        confirmed_at: confirmed,
        status: "confirmed",
        priority: 1,
        waitlist: false,
      });
      await create("registrations", id("reg"), {
        clubObject: pointer("clubs", CLUB_ID),
        campObject: camp,
        confirmed_at: confirmed,
        status: "confirmed",
        participantsArray: [pointer("participants", id("par"))],
        sessions: [session],
        classes: [campClass],
        sessionJoinObjects: [pointer("registration_campSession", id("jn"))],
      });
    });

    When("the Clubspot sync runs", async () => {
      await runCronJob("clubspot-sync", runId);
    });

    let person: any;

    Then("the CRM has the sailor as a person", async () => {
      const fields = [
        "person_id.id",
        "person_id.first_name",
        "person_id.last_name",
        "person_id.my_contacts.relationship_type",
        "person_id.my_contacts.contact_id.first_name",
        "person_id.my_contacts.contact_id.last_name",
        "person_id.my_contacts.contact_id.email",
      ].join(",");
      const row = await asAdmin("GET", `/items/participants/${id("par")}?fields=${fields}`);
      person = row.person_id;
      expect(person).toMatchObject({ first_name: participant.firstName, last_name: participant.lastName });
    });

    And("the CRM has the sailor's parent as a person, listed as their parent", () => {
      expect(person.my_contacts).toContainEqual({
        relationship_type: "guardian",
        contact_id: {
          first_name: participant.guardianFirst,
          last_name: participant.guardianLast,
          email: participant.guardianEmail,
        },
      });
    });
  },

  "The person kept becomes the coach": ({ Given, And, When, Then }) => {
    const runId = newRunId();
    let keeperId: string;
    let duplicateId: string;
    let assignmentId: string;

    Given("two people who are the same sailor, one a coach in a program", async () => {
      // The same name is what makes them one merge group.
      const sailor = () => adminCreate("people", { first_name: "Merge", last_name: `Sailor ${runId}` });
      keeperId = (await sailor()).id;
      duplicateId = (await sailor()).id;
      const program = await adminCreate("programs", { name: `Program ${runId}` });
      const coach = await adminCreate("program_roles", { name: `Coach ${key("role")}` });
      assignmentId = (
        await adminCreate("program_role_assignments", {
          person_id: duplicateId,
          program_id: program.id,
          program_role_id: coach.id,
        })
      ).id;
    });

    // The finding's detail is the format clubspot-sync writes and its merge reads back.
    And("staff have approved merging them", async () => {
      await adminCreate("audit_findings", {
        source: "clubspot-sync",
        kind: "duplicate_person",
        subject: keeperId,
        detail: `Merge Sailor ${runId}: ${[keeperId, duplicateId].map((id) => `${id} (dob unknown)`).join(", ")}`,
        status: "approved",
        fingerprint: key("fingerprint"),
      });
    });

    When("the Clubspot sync runs", async () => {
      await runCronJob("clubspot-sync", runId);
    });

    Then("the person kept is the coach", async () => {
      const assignment = await (await admin()).ok("GET", itemPath("program_role_assignments", assignmentId));
      expect(assignment.person_id).toBe(keeperId);
    });

    And("the duplicate is gone", async () => {
      const { status } = await (await admin()).request("GET", itemPath("people", duplicateId));
      expect(status).not.toBe(200);
    });
  },
});
