import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin, deleteRows, itemPath, planRows, row } from "./steps/rows.ts";

// A flow's data steps can skip Directus's events, and with them the saved-versions hook's filters.
// The database's triggers refuse the write anyway (docs/planning-schema.md). The deploy applies the
// schema just before this runs, so it also checks that applying a schema leaves them in place.

const REFUSED = "A saved plan version can't be changed. Make a new draft from it.";

let flowId: string | undefined;

afterAll(async () => {
  // Deleting a flow deletes its steps.
  if (flowId) {
    await (await admin()).request("DELETE", `/flows/${flowId}`);
  }
  const failures = await deleteRows();
  if (failures.length > 0) {
    throw new Error(`Couldn't clean up:\n${failures.join("\n")}`);
  }
}, 300_000);

describe("a saved plan version", () => {
  it("doesn't change when a flow's step changes it with events off, even with full permissions", async () => {
    await planRows();
    const session = await admin();
    const saved = row["plan_versions@saved"]!;
    const flow = await session.ok("POST", "/flows", {
      id: randomUUID(),
      name: `Saved version test ${saved}`,
      status: "active",
      trigger: "webhook",
      accountability: null,
      options: { method: "POST", async: false, return: "$last", error_on_reject: true },
    });
    flowId = flow.id;
    const step = await session.ok("POST", "/operations", {
      id: randomUUID(),
      flow: flowId,
      key: "change_saved_version",
      name: "Change a saved version",
      type: "item-update",
      position_x: 19,
      position_y: 1,
      options: {
        collection: "plan_versions",
        key: [saved],
        payload: { message: "Changed by a flow." },
        permissions: "$full",
        emitEvents: false,
      },
    });
    await session.ok("PATCH", `/flows/${flowId}`, { operation: step.id });

    const { status, body } = await session.request("POST", `/flows/trigger/${flowId}`, {});
    expect(status, JSON.stringify(body)).toBe(403);
    expect(body.errors?.[0]?.message).toBe(REFUSED);
    const now = await session.ok("GET", `${itemPath("plan_versions", saved)}?fields=message`);
    expect(now.message).not.toBe("Changed by a flow.");
  });
});
