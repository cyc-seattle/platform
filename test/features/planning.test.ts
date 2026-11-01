import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, Step, theirSession } from "./steps/index.ts";
import { notBuilt } from "./steps/logins.ts";
import {
  admin,
  adminCreate,
  adminSave,
  created,
  fixture,
  itemPath,
  newRow,
  PLAN_ROWS,
  planRows,
  row,
  saving,
  runRows,
  type Row,
} from "./steps/rows.ts";

// A plan's active version is its last activation (docs/planning-schema.md).

let planId: string | undefined;
let versionIds: string[] = [];
onEachScenario(() => {
  planId = undefined;
  versionIds = [];
});

/** A new plan for the run's product, made by the admin, with `saved` saved versions and then a draft. */
async function aPlan(saved: number, draft: boolean): Promise<void> {
  await runRows();
  planId = (await adminCreate("plans", await newRow("plans"))).id;
  for (let i = 0; i < saved; i++) {
    const { id } = await adminCreate("plan_versions", await newRow("plan_versions", { plan_id: planId }));
    await adminSave(id);
    versionIds.push(id);
  }
  if (draft) {
    const { id } = await adminCreate("plan_versions", await newRow("plan_versions", { plan_id: planId }));
    versionIds.push(id);
  }
}

async function versionsOf(plan: string, status: string): Promise<Row[]> {
  const filter = encodeURIComponent(JSON.stringify({ plan_id: { _eq: plan }, status: { _eq: status } }));
  return (await admin()).ok("GET", `/items/plan_versions?filter=${filter}&fields=id,status`);
}

async function activeVersion(plan: string): Promise<unknown> {
  const filter = encodeURIComponent(JSON.stringify({ plan_id: { _eq: plan } }));
  const [newest] = await (
    await admin()
  ).ok("GET", `/items/plan_activations?filter=${filter}&sort=-sequence&limit=1&fields=version_id`);
  return newest?.version_id;
}

/** Makes a saved version active as "they", and checks it's now the plan's active one. */
async function activate(versionId: string): Promise<void> {
  const id = randomUUID();
  const { status, body } = await (
    await theirSession()
  ).request("POST", "/items/plan_activations", { id, version_id: versionId });
  if (status < 300) {
    created.push({ collection: "plan_activations", id });
  }
  expect(status, JSON.stringify(body)).toBe(200);
  expect(await activeVersion(body.data.plan_id)).toBe(versionId);
}

Step("they start a plan for a program area", async () => {
  await runRows();
  const plan = await newRow("plans");
  const draft = { id: randomUUID(), status: "draft" };
  const { status, body } = await (await theirSession()).request("POST", "/items/plans", { ...plan, versions: [draft] });
  if (status < 300) {
    // Cleanup deletes the newest first, so the draft goes after its plan.
    created.push({ collection: "plans", id: plan["id"] }, { collection: "plan_versions", id: draft.id });
  }
  expect(status, JSON.stringify(body)).toBe(200);
  planId = plan["id"] as string;
});
Step("the plan has a draft they can change", async () => {
  const [draft, ...others] = await versionsOf(planId!, "draft");
  expect(others).toEqual([]);
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", draft!["id"]), { message: "A first draft." });
  expect(status, JSON.stringify(body)).toBe(200);
});
Step("the plan has no saved versions yet", async () => {
  expect(await versionsOf(planId!, "saved")).toEqual([]);
});

Step("a plan with two saved versions, the first of them active", async () => {
  await aPlan(2, false);
  await adminCreate("plan_activations", { id: randomUUID(), version_id: versionIds[0] });
  expect(await activeVersion(planId!)).toBe(versionIds[0]);
});
Step("they make the second version active", () => activate(versionIds[1]!));
Step("only the second version is active", async () => {
  expect(await activeVersion(planId!)).toBe(versionIds[1]);
});

// The run's plan, which the admin started.
Step("a plan someone else started", () => planRows());

Step("a plan with a draft", () => aPlan(0, true));
Step("they can save the draft as a version", async () => {
  const draft = versionIds[0]!;
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", draft), { ...(await saving()), message: "Ready for the board." });
  expect(status, JSON.stringify(body)).toBe(200);
  const saved = await (await admin()).ok("GET", `${itemPath("plan_versions", draft)}?fields=status,saved_by,saved_at`);
  const me = await (await theirSession()).ok("GET", "/users/me?fields=id");
  expect(saved).toMatchObject({ status: "saved", saved_by: me.id, saved_at: expect.any(String) });
});
Step("they can make a saved version active", () => activate(versionIds[0]!));

Step("they can't copy a draft's changes into a saved version", async () => {
  await planRows();
  const user = await theirSession();
  for (const collection of PLAN_ROWS) {
    const draft = Object.fromEntries(
      Object.entries(fixture[`${collection}@draft`]!).filter(([field]) => !["id", "version_id", "key"].includes(field)),
    );
    const { status, body } = await user.request("PATCH", itemPath(collection, row[`${collection}@saved`]), draft);
    expect(status, `${collection}: ${JSON.stringify(body)}`).toBe(403);
  }
});
Step("they can't turn a saved version back into a draft", async () => {
  await planRows();
  const saved = row["plan_versions@saved"];
  const { status, body } = await (
    await theirSession()
  ).request("PATCH", itemPath("plan_versions", saved), { status: "draft" });
  expect(status, JSON.stringify(body)).toBe(403);
  expect(body.errors?.[0]?.message).toBe("A saved plan version can't be changed. Make a new draft from it.");
  const { status: now } = await (await admin()).ok("GET", `${itemPath("plan_versions", saved)}?fields=status`);
  expect(now).toBe("saved");
});

// The P&L and program areas' steps, which step 12a builds.
for (const text of [
  "two plans for a program area this year, the first of them active",
  "they make a saved version of the second plan active",
  "the second plan is the program area's plan for the year",
  "the first plan has no active version",
  "a plan for a program area",
  "an offering in it of a program from another program area",
  "a planner calculates the P&L",
  "the planner is warned that the offering is in the wrong plan",
  "the Operations Plan sells {money} of merchandise",
  "the club-wide totals include {money} of merchandise sales",
  "a program with no program area",
  "a plan with an offering of that program",
  "the planner is warned that the program has no program area",
  "a program area with two offerings that each take in {money}",
  "{money} of storage charged to the program area",
  "the program area takes in {money}",
  "its costs include the {money} of storage",
  "a program area with two offerings, the first with twice the direct costs of the second",
  "the first offering pays {money} of the storage",
  "the second offering pays {money} of the storage",
  "a program area with two offerings with the same direct costs",
  "a salaried director paid {money} an hour, with {count} hours charged to the program area",
  "each offering pays {money} of the director's salary",
  "the Operations Plan sets scholarships at {percent} of programs' revenue",
  "an offering of a program at {money} a sailor, with {count} sailors",
  "the offering's scholarships are {money}",
  "the merchandise has no scholarships",
  "the Operations Plan collects card fees from families at {percent} of revenue",
  "the Operations Plan pays card fees at {percent} of revenue",
  "an offering of a program that takes in {money}",
  "the offering takes in {money} of card fees from families",
  "the offering pays {money} of card fees",
  "two offerings with the same direct costs",
  "scholarships on the first offering only, which don't count toward the split",
  "{money} of office costs shared by every offering",
  "each offering pays {money} of the office costs",
  "the Operations Plan buys a {money} coach boat",
  "no offering or program area pays for the coach boat",
  "the club-wide totals show {money} of capital",
  "a {money} coach boat charged to a program area",
  "the program area doesn't pay for the coach boat",
  "the planner is warned that capital can't be charged to a program area",
  "programs that take in {money} and cost {money}",
  "donations of {money}, which cost {money} to raise",
  "the club-wide totals are:",
  "they can write the draft's rules",
  "a plan with a saved version that has rules",
  "they can't change the saved version's rules",
]) {
  Step(text, () => notBuilt("12a"));
}

describeAccessFeature("planning.feature");
