import { expect } from "vitest";
import {
  aNewcomer,
  describeAccessFeature,
  expectRefusal,
  onEachScenario,
  readOnly,
  Step,
  theirSession,
} from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, newRow, type Row } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

let coach: { id: string; personId: string } | undefined;
onEachScenario(() => {
  coach = undefined;
});

function theCoach(): { id: string; personId: string } {
  if (coach === undefined) {
    throw new Error("No Given has put a coach on the list.");
  }
  return coach;
}

// A coach of the scenario's own, so archiving one leaves the run's coach as it was.
Step("a coach on the list", async () => {
  const item = await adminCreate("coaches", await newRow("coaches"));
  coach = { id: item.id, personId: item["person_id"] as string };
});

/** Adds a coach as the admin, and records that the CRM should have refused it. */
async function adminAddsCoach(data: Row): Promise<void> {
  const { status } = await (await admin()).request("POST", "/items/coaches", data);
  if (status < 300) {
    created.push({ collection: "coaches", id: data["id"] });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
}

Step("an admin adds the same person to the coach list again", async () =>
  adminAddsCoach(await newRow("coaches", { person_id: theCoach().personId })),
);
Step("an admin adds a coach with no staff level", async () =>
  adminAddsCoach(await newRow("coaches", { staff_level_key: null })),
);

// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes that person from the CRM", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("people", theCoach().personId));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("that person is still in the CRM", async () => {
  await (await admin()).ok("GET", itemPath("people", theCoach().personId));
});

Step("they archive the coach", async () => {
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("coaches", theCoach().id), { active: false });
  expect(status, JSON.stringify(body)).toBe(200);
});
Step("the coach is still on the list, marked as no longer coaching", async () => {
  const item = await (await admin()).ok("GET", itemPath("coaches", theCoach().id));
  expect(item.active).toBe(false);
});

Step("they can see people's names, but nothing else about them", () =>
  readOnly("people", ["id", "first_name", "last_name"]),
);

Step("a coach in the CRM who has never signed in", async () => {
  const personId = await aNewcomer([]);
  await adminCreate("coaches", await newRow("coaches", { person_id: personId }));
});

describeAccessFeature("staff.feature");
