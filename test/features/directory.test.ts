import { expect } from "vitest";
import { describeAccessFeature, expectRefusal, onEachScenario, Step } from "./steps/index.ts";
import { admin, adminCreate, itemPath, newRow, runRows } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

let organizationId: string | undefined;
let venueId: string | undefined;
onEachScenario(() => {
  organizationId = undefined;
  venueId = undefined;
});

Step("an admin adds a venue with no organization", async () => {
  await runRows();
  venueId = (await adminCreate("venues", await newRow("venues", { organization_id: null }))).id;
});
Step("the venue is in the directory", async () => {
  const venue = await (await admin()).ok("GET", itemPath("venues", venueId));
  expect(venue.organization_id).toBeNull();
});

Step("an organization that runs a venue", async () => {
  await runRows();
  organizationId = (
    await adminCreate(
      "organizations",
      await newRow("organizations", { kind: "yacht_club", fiscal_year_start_month: null }),
    )
  ).id;
  await adminCreate("venues", await newRow("venues", { organization_id: organizationId }));
});
// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes the organization", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("organizations", organizationId));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the organization is still in the directory", async () => {
  await (await admin()).ok("GET", itemPath("organizations", organizationId));
});

describeAccessFeature("directory.feature");
