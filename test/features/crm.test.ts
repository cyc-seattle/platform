import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import "./steps/community.ts";
import { describeAccessFeature, onEachScenario, Step } from "./steps/index.ts";
import { admin, adminCreate, created, email, itemPath, runId } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

interface Family {
  sailorId: string;
  parentIds: string[];
  emergencyContactId: string;
}

let family: Family | undefined;
let status = 0;
onEachScenario(() => {
  family = undefined;
  status = 0;
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

Step("a sailor with two parents and an emergency contact", async () => {
  const sailorId = await person("sailor");
  const parentIds = [await person("parent"), await person("parent")];
  const emergencyContactId = await person("neighbor");
  for (const parentId of parentIds) {
    await listed(sailorId, parentId, "guardian");
  }
  await listed(sailorId, emergencyContactId, "emergency_contact");
  family = { sailorId, parentIds, emergencyContactId };
});

let found: { contact_id: string; relationship_type: string }[] = [];
Step("an admin looks up the sailor's parents and emergency contacts", async () => {
  const filter = encodeURIComponent(JSON.stringify({ subject_id: { _eq: theFamily().sailorId } }));
  found = await (await admin()).ok("GET", `/items/contacts?filter=${filter}&fields=contact_id,relationship_type`);
});
Step("they see both parents and the emergency contact", () => {
  const { parentIds, emergencyContactId } = theFamily();
  expect(found).toEqual(
    expect.arrayContaining([
      ...parentIds.map((id) => ({ contact_id: id, relationship_type: "guardian" })),
      { contact_id: emergencyContactId, relationship_type: "emergency_contact" },
    ]),
  );
  expect(found).toHaveLength(3);
});

Step("a sailor with medical information on file", async () => {
  const sailorId = await person("sailor");
  await adminCreate("medical_profiles", { id: randomUUID(), person_id: sailorId, allergies: "none" });
  family = { sailorId, parentIds: [], emergencyContactId: "" };
});
Step("an admin adds a second set of medical information for the sailor", async () => {
  const id = randomUUID();
  ({ status } = await (
    await admin()
  ).request("POST", "/items/medical_profiles", { id, person_id: theFamily().sailorId, allergies: "peanuts" }));
  if (status < 300) {
    created.push({ collection: "medical_profiles", id });
  }
});
Step("the CRM refuses it", () => {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
});

Step("an admin deletes one of the sailor's parents", async () => {
  ({ status } = await (await admin()).request("DELETE", itemPath("people", theFamily().parentIds[0])));
});
Step("they're refused, and the parent is still in the CRM", async () => {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
  await (await admin()).ok("GET", itemPath("people", theFamily().parentIds[0]));
});

describeAccessFeature("crm.feature");
