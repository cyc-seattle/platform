import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import "./steps/community.ts";
import { describeAccessFeature, expectRefusal, onEachScenario, Step } from "./steps/index.ts";
import { asAdmin } from "./cluster.ts";
import { clubspotRun, seedClass, seedSailor, type ClubspotRun } from "./steps/clubspot.ts";
import { createUser, notBuilt, type User } from "./steps/logins.ts";
import { admin, adminCreate, created, email, itemPath, newRow, runId } from "./steps/rows.ts";
import { runClubspotSync } from "./syncs.ts";

// The data model's rules hold for everyone, so an admin checks them.

interface Family {
  sailorId: string;
  parentIds: string[];
  emergencyContactIds: string[];
}

let family: Family | undefined;
onEachScenario(() => {
  family = undefined;
});

function theFamily(): Family {
  if (family === undefined) {
    throw new Error("No Given has made the sailor.");
  }
  return family;
}

const person = async (name: string) =>
  (await adminCreate("people", { first_name: name, last_name: `Test ${runId}`, email: email(name) })).id;

async function listed(sailorId: string, contactId: string, relationship: "guardian" | "emergency_contact") {
  await adminCreate("contacts", { subject_id: sailorId, contact_id: contactId, relationship_type: relationship });
}

Step("a sailor with two parents and two emergency contacts", async () => {
  const sailorId = await person("sailor");
  const parentIds = [await person("parent"), await person("parent")];
  const emergencyContactIds = [await person("neighbor"), await person("grandparent")];
  for (const parentId of parentIds) {
    await listed(sailorId, parentId, "guardian");
  }
  for (const contactId of emergencyContactIds) {
    await listed(sailorId, contactId, "emergency_contact");
  }
  family = { sailorId, parentIds, emergencyContactIds };
});

Step("a sailor with a parent", async () => {
  const sailorId = await person("sailor");
  const parentId = await person("parent");
  await listed(sailorId, parentId, "guardian");
  family = { sailorId, parentIds: [parentId], emergencyContactIds: [] };
});

let found: { contact_id: string; relationship_type: string }[] = [];
Step("an admin looks up the sailor's parents and emergency contacts", async () => {
  const filter = encodeURIComponent(JSON.stringify({ subject_id: { _eq: theFamily().sailorId } }));
  found = await (await admin()).ok("GET", `/items/contacts?filter=${filter}&fields=contact_id,relationship_type`);
});
Step("they see both parents and both emergency contacts", () => {
  const { parentIds, emergencyContactIds } = theFamily();
  expect(found).toEqual(
    expect.arrayContaining([
      ...parentIds.map((id) => ({ contact_id: id, relationship_type: "guardian" })),
      ...emergencyContactIds.map((id) => ({ contact_id: id, relationship_type: "emergency_contact" })),
    ]),
  );
  expect(found).toHaveLength(4);
});

Step("a sailor with medical information on file", async () => {
  const sailorId = await person("sailor");
  await adminCreate("medical_profiles", { id: randomUUID(), person_id: sailorId, allergies: "none" });
  family = { sailorId, parentIds: [], emergencyContactIds: [] };
});
Step("an admin adds a second set of medical information for the sailor", async () => {
  const id = randomUUID();
  const { status } = await (
    await admin()
  ).request("POST", "/items/medical_profiles", { id, person_id: theFamily().sailorId, allergies: "peanuts" });
  if (status < 300) {
    created.push({ collection: "medical_profiles", id });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes the sailor's parent", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("people", theFamily().parentIds[0]));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the parent is still in the CRM", async () => {
  await (await admin()).ok("GET", itemPath("people", theFamily().parentIds[0]));
});

// The roster page and the old rules' removal (cyc-seattle/workplace#6 steps 18 and 19).
for (const [step, texts] of [
  ["18", ["the page loads without errors and shows the teams' rosters"]],
  [
    "19",
    [
      "a parent whose child is signed up for a program that isn't a team",
      "another sailor in the program who chose to share, and their parent",
      "they don't see who the sailor's parent is",
    ],
  ],
] as const) {
  for (const text of texts) {
    Step(text, () => notBuilt(step));
  }
}

/** A family signed up through Clubspot, who said yes to sharing, synced onto a team. Returns the parent's id. */
async function aParentWhoSaidYes(run: ClubspotRun): Promise<string> {
  await seedClass(run);
  await seedSailor(run, { share: true });
  await adminCreate("clubspot_promoted_fields", {
    id: randomUUID(),
    target_field: "share_contact",
    labels: [run.sharingQuestion],
  });
  await runClubspotSync(run.id("cmp"));
  const team = await adminCreate("programs", await newRow("programs", { name: `Team ${run.runId}`, team: true }));
  await asAdmin("PATCH", `/items/clubspot_classes/${run.id("cls")}`, { program_id: team.id });
  const sailor = await asAdmin(
    "GET",
    `/items/clubspot_participants/${run.id("par")}?fields=person_id.my_contacts.contact_id,person_id.my_contacts.relationship_type`,
  );
  return sailor.person_id.my_contacts.find(
    (link: { relationship_type: string }) => link.relationship_type === "guardian",
  ).contact_id;
}

/**
 * Signs a person in, linked to their login as the group-policies hook links them. The rules match by
 * login, so the login's email needn't be the one Clubspot gave them, which Directus may not accept.
 */
async function signedIn(personId: string): Promise<User> {
  const user = await createUser(email("parent"), "Community");
  await asAdmin("PATCH", `/items/people/${personId}`, { directus_user_id: user.userId });
  return user;
}

const sharesContact = async (personId: string) =>
  (await asAdmin("GET", `/items/people/${personId}?fields=share_contact`)).share_contact;

describeAccessFeature("crm.feature", {
  "A parent who stopped sharing says yes on a later sign-up": ({ Given, When, Then }) => {
    const run = clubspotRun();
    let parentId: string;

    Given("a parent whose child is on a team, who stopped sharing", async () => {
      parentId = await aParentWhoSaidYes(run);
      const user = await signedIn(parentId);
      const { status } = await user.session.request("PATCH", `/items/people/${parentId}`, { share_contact: false });
      expect(status).toBeLessThan(300);
    });

    When("they say yes to sharing when they sign their child up again in Clubspot", async () => {
      await seedSailor(run, { share: true, signUp: 2 });
      // Clearing the camp's watermark makes the run read every sign-up, so the fake's clock can't hide
      // the new one.
      await asAdmin("PATCH", `/items/clubspot_camps/${run.id("cmp")}`, { synced_through: null });
      await runClubspotSync(run.id("cmp"));
    });

    Then("they share their email and phone", async () => {
      expect(await sharesContact(parentId)).toBe(true);
    });
  },

  "A parent who said yes in Clubspot stops sharing": ({ Given, When, Then }) => {
    const run = clubspotRun();
    let parentId: string;
    let user: User;

    Given("a parent whose child is on a team, who said yes to sharing in Clubspot", async () => {
      parentId = await aParentWhoSaidYes(run);
      expect(await sharesContact(parentId)).toBe(true);
      user = await signedIn(parentId);
    });

    When("they stop sharing", async () => {
      const { status } = await user.session.request("PATCH", `/items/people/${parentId}`, { share_contact: false });
      expect(status).toBeLessThan(300);
    });

    Then("they don't share their email and phone", async () => {
      expect(await sharesContact(parentId)).toBe(false);
    });
  },
});
