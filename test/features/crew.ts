import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, expectRefusal, onEachScenario, Step, theirSession } from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, newRow, row, runId, runRows } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

let personId: string | undefined;
let positionId: string | undefined;
let programId: string | undefined;
onEachScenario(() => {
  personId = undefined;
  positionId = undefined;
  programId = undefined;
});

async function aCrewMember(term: Record<string, unknown> = {}): Promise<void> {
  await runRows();
  const member = await adminCreate("crew_members", await newRow("crew_members"));
  personId = member["person_id"] as string;
  if (Object.keys(term).length > 0) {
    await adminCreate("crew_terms", await newRow("crew_terms", { crew_member_id: member.id, ...term }));
  }
}

async function aPosition(name: string, fields: Record<string, unknown> = {}): Promise<string> {
  positionId = (await adminCreate("crew_positions", { id: randomUUID(), name: `${name} ${runId}`, ...fields })).id;
  return positionId;
}

Step("a crew member", () => aCrewMember());
Step("an admin adds the same person to Crew again", async () => {
  const again = await newRow("crew_members", { person_id: personId });
  const { status } = await (await admin()).request("POST", "/items/crew_members", again);
  if (status < 300) {
    created.push({ collection: "crew_members", id: again["id"] });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// Directus answers a delete its foreign key refuses with a 500, so each check reads the row after.
Step("an admin deletes that person from the CRM", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("people", personId));
  expectRefusal(async () => {
    expect(status).toBeGreaterThanOrEqual(400);
    await (await admin()).ok("GET", itemPath("people", personId));
  });
});

Step("a crew member with a term as Treasurer", async () => {
  await aCrewMember({ position_id: await aPosition("Treasurer"), program_id: null });
});
Step("an admin deletes the Treasurer position", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("crew_positions", positionId));
  expectRefusal(async () => {
    expect(status).toBeGreaterThanOrEqual(400);
    await (await admin()).ok("GET", itemPath("crew_positions", positionId));
  });
});

Step("a crew member who is Parent Coordinator for a program", async () => {
  await runRows();
  programId = (await adminCreate("programs", await newRow("programs"))).id;
  await aCrewMember({ position_id: await aPosition("Parent Coordinator"), program_id: programId });
});
Step("an admin deletes that program", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("programs", programId));
  expectRefusal(async () => {
    expect(status).toBeGreaterThanOrEqual(400);
    await (await admin()).ok("GET", itemPath("programs", programId));
  });
});

const PAY = ["staff_level_id", "hourly_rate_cents", "profit_share"];
async function readPay(): Promise<{ status: number; body: unknown }> {
  await runRows();
  return (await theirSession()).request("GET", `${itemPath("crew_terms", row["crew_terms"])}?fields=${PAY.join(",")}`);
}
Step("they can see a term's pay", async () => {
  const { status, body } = await readPay();
  expect(status, JSON.stringify(body)).toBe(200);
  expect((body as { data: Record<string, unknown> }).data["hourly_rate_cents"]).toBe(2_500);
});
Step("they can't see a term's pay", async () => {
  const { status, body } = await readPay();
  expect(status, JSON.stringify(body)).toBe(403);
});

Step("they can see people's names and emails, but nothing else about them", async () => {
  await runRows();
  const user = await theirSession();
  const named = await user.request("GET", `${itemPath("people", row["people"])}?fields=id,first_name,last_name,email`);
  expect(named.status, JSON.stringify(named.body)).toBe(200);
  for (const field of ["phone", "date_of_birth", "street", "household_id"]) {
    const { status, body } = await user.request("GET", `${itemPath("people", row["people"])}?fields=${field}`);
    expect(status, `${field}: ${JSON.stringify(body)}`).toBe(403);
  }
});

/** crew.feature, whose steps the seed also uses (test/seed). */
export function describeCrew(): void {
  describeAccessFeature("crew.feature");
}
