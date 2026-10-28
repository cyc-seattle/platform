import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, Step, theirSession } from "./steps/index.ts";
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
  PLATFORM_VERSION,
  row,
  runRows,
  type Row,
} from "./steps/rows.ts";

// A plan's active version is its newest activation (docs/planning-schema.md).

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
  ).ok("GET", `/items/plan_activations?filter=${filter}&sort=-activated_at&limit=1&fields=version_id`);
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

Step("they start a plan for a product", async () => {
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
  ).request("PATCH", itemPath("plan_versions", draft), {
    status: "saved",
    platform_version: PLATFORM_VERSION,
    message: "Ready for the board.",
  });
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

describeAccessFeature("planning.feature");
