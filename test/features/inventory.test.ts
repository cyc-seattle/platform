import { expect } from "vitest";
import { describeAccessFeature, expectRefusal, onEachScenario, Step, theirSession } from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, newRow, row, runRows, type Row } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

let boatId: string | undefined;
let hullNumber: string | undefined;
let rackId: string | undefined;
let rackDeleted: number | undefined;
onEachScenario(() => {
  boatId = undefined;
  hullNumber = undefined;
  rackId = undefined;
  rackDeleted = undefined;
});

/** An admin adds a row that should be refused as incomplete or a duplicate: a 4xx, not a 5xx. */
async function addRefused(collection: string, data: Row): Promise<void> {
  const { status } = await (await admin()).request("POST", `/items/${collection}`, data);
  if (status < 300) {
    created.push({ collection, id: data["id"] });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
}

const aBoat = async (fields: Row = {}) => {
  await runRows();
  return adminCreate("boats", await newRow("boats", fields));
};

Step("an admin adds a boat with no hull number", async () => {
  await runRows();
  await addRefused("boats", await newRow("boats", { hull_number: null }));
});
Step("a boat in the inventory", async () => {
  const boat = await aBoat();
  boatId = boat.id;
  hullNumber = boat["hull_number"] as string;
});
Step("an admin adds another boat with the same hull number", async () => {
  await addRefused("boats", await newRow("boats", { hull_number: hullNumber }));
});

Step("a boat that has moved to its beginner life", async () => {
  boatId = (await aBoat()).id;
  await adminCreate("boat_stage_changes", await newRow("boat_stage_changes", { boat_id: boatId }));
  await adminCreate(
    "boat_stage_changes",
    await newRow("boat_stage_changes", { boat_id: boatId, stage: "beginner", changed_on: "2026-01-01" }),
  );
});
// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes the boat", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("boats", boatId));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the boat is still in the inventory", async () => {
  await (await admin()).ok("GET", itemPath("boats", boatId));
});

const aRack = async () => {
  await runRows();
  return (await adminCreate("storage_spaces", await newRow("storage_spaces"))).id;
};
Step("a rack with a sailor's storage agreement on it", async () => {
  rackId = await aRack();
  await adminCreate("storage_agreements", await newRow("storage_agreements", { storage_space_id: rackId }));
});
Step("one of CSC's boats on a rack no sailor stores a boat on", async () => {
  rackId = await aRack();
  boatId = (await aBoat({ storage_space_id: rackId })).id;
});
Step("an admin deletes the rack", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("storage_spaces", rackId));
  rackDeleted = status;
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the rack is still in the inventory", async () => {
  await (await admin()).ok("GET", itemPath("storage_spaces", rackId));
});
Step("the boat is still in the inventory, stored nowhere", async () => {
  expect(rackDeleted).toBe(204);
  const boat = await (await admin()).ok("GET", itemPath("boats", boatId));
  expect(boat.storage_space_id).toBeNull();
});

Step("an admin adds a charter with no sailor", async () => {
  await runRows();
  await addRefused("boat_charters", await newRow("boat_charters", { person_id: null }));
});
Step("an admin adds a storage agreement with no start date", async () => {
  await runRows();
  await addRefused("storage_agreements", await newRow("storage_agreements", { starts_on: null }));
});
Step("an admin logs damage with no status", async () => {
  await runRows();
  await addRefused("boat_damage", await newRow("boat_damage", { status: null }));
});

// The run's child is the sailor on its charter, damage, and storage agreement.
Step("they can see sailors' names", async () => {
  await runRows();
  const filter = encodeURIComponent(JSON.stringify({ id: { _eq: row["people"] } }));
  const { status, body } = await (
    await theirSession()
  ).request("GET", `/items/people?fields=first_name,last_name&filter=${filter}`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.data).toHaveLength(1);
});
Step("they can't see sailors' emails or phone numbers", async () => {
  await runRows();
  for (const field of ["email", "phone"]) {
    const { status, body } = await (
      await theirSession()
    ).request("GET", `${itemPath("people", row["people"])}?fields=${field}`);
    expect(status, `${field}: ${JSON.stringify(body)}`).toBe(403);
  }
});

// The boat replacement reserve, which the next platform PR builds: until then, each of these steps fails.
for (const text of [
  "Optis that last {int} years",
  "an Opti worth {money}, in service for the whole plan year",
  "an Opti worth {money} that goes into service halfway through the plan year",
  "an Opti worth {money} that retires halfway through the plan year",
  "an Opti worth {money} that went into service {int} years before the plan year",
  "an Opti worth {money}, chartered to a sailor for the whole plan year",
  "Guppies sails {int} of CSC's Optis for {int} hours, and Minnows sails {int} for {int} hours",
  "Guppies sails {int} of CSC's Optis for {int} hours, and Minnows sails only Optis its sailors bring",
  "Guppies sails {int} of CSC's Optis for {int} hours",
  "no offering sails Optis",
  "a planner looks at the plan",
  "the organization's boat replacement reserve is {money}",
  "Guppies' boat replacement reserve is {money}",
  "Minnows' boat replacement reserve is {money}",
  "the planner is warned that no offering sails CSC's Opti boats",
  "Guppies' net is the same as with no boats in the inventory",
]) {
  Step(text, () => {
    throw new Error("Not built yet: the boat replacement reserve");
  });
}

describeAccessFeature("inventory.feature");
