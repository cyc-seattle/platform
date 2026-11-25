import { expect } from "vitest";
import { asAdmin } from "./cluster.ts";
import { type ClubspotRun, clubspotRun, seedClass, seedSailor } from "./steps/clubspot.ts";
import { canSet, describeAccessFeature, Step } from "./steps/index.ts";
import { admin, adminCreate, itemPath, key, newRow, type Row } from "./steps/rows.ts";
import { runClubspotSync } from "./syncs.ts";

// The sync scenarios seed the CRM and the Clubspot fake, run clubspot-sync on their own camp, and
// read the result through Directus's REST API.

/**
 * A catalog offering of a new program, linked to the run's class and session, as staff would link it. It
 * ends `daysLate` days after the session does.
 */
async function linkOffering({ runId, id }: ClubspotRun, daysLate: number): Promise<string> {
  const program = (await adminCreate("programs", await newRow("programs", { name: `Program ${runId}` }))).id;
  const session = await asAdmin("GET", `/items/clubspot_sessions/${id("ses")}?fields=start_date,end_date`);
  const ends = new Date(`${session.end_date}T00:00:00Z`);
  ends.setUTCDate(ends.getUTCDate() + daysLate);
  const offering = await adminCreate("offerings", {
    program_id: program,
    name: `Offering ${runId}`,
    starts_on: session.start_date,
    ends_on: ends.toISOString().slice(0, 10),
    clubspot_class_id: id("cls"),
    clubspot_session_id: id("ses"),
  });
  return offering.id;
}
Step("they can match a registration's sailor to a person in the CRM", () =>
  canSet("clubspot_participants", "person_id"),
);

Step("it can move people's places on Crew and which Google groups they're in to another person", async () => {
  for (const collection of ["crew_members", "google_group_memberships"]) {
    await canSet(collection, "person_id");
  }
});

describeAccessFeature("clubspot.feature", {
  "A sailor's registration adds the sailor and their parent to the CRM": ({ Given, And, When, Then }) => {
    const run = clubspotRun();
    const { id, participant } = run;

    Given("a class running today in Clubspot", () => seedClass(run));

    And("a sailor registered for it, with a parent", () => seedSailor(run));

    When("the Clubspot sync runs", () => runClubspotSync(id("cmp")));

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
      const row = await asAdmin("GET", `/items/clubspot_participants/${id("par")}?fields=${fields}`);
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

  "A sailor waits until their class is linked to an offering": ({ Given, And, When, Then }) => {
    const run = clubspotRun();
    const { id } = run;
    let offeringId: string;

    Given("a sailor registered for a class running today in Clubspot", async () => {
      await seedClass(run);
      await seedSailor(run);
    });

    And("the Clubspot sync has copied them into the CRM", () => runClubspotSync(id("cmp")));

    When("staff link an offering to the class's session", async () => {
      offeringId = await linkOffering(run, 0);
    });

    And("the Clubspot sync runs again", () => runClubspotSync(id("cmp")));

    Then("the sailor is registered in that offering", async () => {
      const sailor = await asAdmin("GET", `/items/clubspot_participants/${id("par")}?fields=person_id`);
      const registrations: Row[] = await asAdmin(
        "GET",
        `/items/registrations?filter[offering_id][_eq]=${offeringId}&fields=person_id,status,clubspot_entry_id`,
      );
      expect(registrations).toEqual([
        { person_id: sailor.person_id, status: "confirmed", clubspot_entry_id: id("jn") },
      ]);
    });

    And("the offering counts one confirmed sailor", async () => {
      const offering = await asAdmin("GET", `/items/offerings/${offeringId}?fields=confirmed_count`);
      expect(offering.confirmed_count).toBe(1);
    });
  },

  "A class with sailors and no offering is reported": ({ Given, When, Then }) => {
    const run = clubspotRun();
    const { id } = run;

    Given("a sailor registered for a class running today in Clubspot", async () => {
      await seedClass(run);
      await seedSailor(run);
    });

    When("the Clubspot sync runs", () => runClubspotSync(id("cmp")));

    Then("the sync reports that the class has sailors in no offering", async () => {
      const findings: Row[] = await asAdmin(
        "GET",
        `/items/audit_findings?filter[kind][_eq]=class_without_offering&filter[subject][_eq]=${id("cls")}&fields=status`,
      );
      expect(findings).toEqual([{ status: "open" }]);
    });
  },

  "An offering that ends a day later than its Clubspot session": ({ Given, When, And, Then }) => {
    const run = clubspotRun();
    const { id } = run;
    let offeringId: string;

    Given("a sailor registered for a class running today in Clubspot", async () => {
      await seedClass(run);
      await seedSailor(run);
      await runClubspotSync(id("cmp"));
    });

    When("staff link an offering that ends a day after the class's session", async () => {
      offeringId = await linkOffering(run, 1);
    });

    And("the Clubspot sync runs", () => runClubspotSync(id("cmp")));

    Then("the sync reports that the offering differs from Clubspot", async () => {
      const findings: Row[] = await asAdmin(
        "GET",
        `/items/audit_findings?filter[kind][_eq]=offering_differs&filter[subject][_eq]=${offeringId}&fields=status,detail`,
      );
      expect(findings).toEqual([{ status: "open", detail: expect.stringContaining("ends_on") }]);
    });
  },

  "The person kept becomes the coach": ({ Given, And, When, Then }) => {
    const run = clubspotRun();
    const { runId } = run;
    let keeperId: string;
    let duplicateId: string;
    let crewMemberId: string;

    Given("two people who are the same sailor, one a coach in a program", async () => {
      // The same name is what makes them one merge group.
      const sailor = () => adminCreate("people", { first_name: "Merge", last_name: `Sailor ${runId}` });
      keeperId = (await sailor()).id;
      duplicateId = (await sailor()).id;
      const program = await adminCreate("programs", await newRow("programs", { name: `Program ${runId}` }));
      const coach = await adminCreate("crew_positions", { name: `Coach ${key("position")}` });
      crewMemberId = (await adminCreate("crew_members", { person_id: duplicateId })).id;
      await adminCreate("crew_terms", { crew_member_id: crewMemberId, position_id: coach.id, program_id: program.id });
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

    // The merge is club-wide, so it runs whatever the camp.
    When("the Clubspot sync runs", async () => {
      await seedClass(run);
      await runClubspotSync(run.id("cmp"));
    });

    Then("the person kept is the coach", async () => {
      const member = await (await admin()).ok("GET", itemPath("crew_members", crewMemberId));
      expect(member.person_id).toBe(keeperId);
    });

    And("the duplicate is gone", async () => {
      const { status } = await (await admin()).request("GET", itemPath("people", duplicateId));
      expect(status).not.toBe(200);
    });
  },
});
