import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import "./steps/community.ts";
import { describeAccessFeature, expectRefusal, onEachScenario, Step } from "./steps/index.ts";
import { notBuilt } from "./steps/logins.ts";
import { admin, adminCreate, created, email, itemPath, runId } from "./steps/rows.ts";

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

// Teams, Crew's wider reads, and the per-person opt-in (cyc-seattle/workplace#6 decisions 26-29).
for (const [step, texts] of [
  [
    "16",
    [
      "they can stop sharing and share again",
      "they can't change whether the teammate's parent shares",
      "a parent whose child is on a team, who stopped sharing",
      "a parent whose child is on a team, who said yes to sharing in Clubspot",
      "they say yes to sharing when they sign their child up again in Clubspot",
      "they stop sharing",
      "they share their email and phone",
      "they don't share their email and phone",
    ],
  ],
  [
    "17",
    [
      "a sailor in a program who hasn't answered the sharing question, and their parent",
      "a parent whose child is on a team",
      "a sailor who is only on another team",
      "a sailor who is only in a program that isn't a team",
      "a sailor whose last time on a team ended a month ago",
      "a sailor whose last time on a team ended 13 months ago",
      "a parent whose child's last time on a team ended 13 months ago",
      "an adult teammate who chose to share",
      "an adult teammate who chose not to share",
      "a teammate who is a child, and their parent, who chose to share",
      "a teammate who is a child, with an email and phone of their own, and their parent, who chose to share",
      "a teammate with no date of birth on file, and an email and phone of their own",
      "they see their own medical information",
      "not the teammate's",
    ],
  ],
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

describeAccessFeature("crm.feature");
