import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, pattern, Step, theirSession } from "./steps/index.ts";
import { admin, created, itemPath, row, runId, runRows } from "./steps/rows.ts";
import { eventually } from "./steps/logins.ts";

pattern("url", /https:\/\/\S+/);

let linkId: string | undefined;
let refused: { status: number; body: unknown } | undefined;
onEachScenario(() => {
  linkId = undefined;
  refused = undefined;
});

Step("they add a link to {url}", async (_, url: string) => {
  linkId = randomUUID();
  const link = { id: linkId, title: `Link ${runId}`, url };
  const { status, body } = await (await theirSession()).request("POST", "/items/links", link);
  if (status < 300) {
    created.push({ collection: "links", id: linkId });
  }
  expect(status, JSON.stringify(body)).toBe(200);
});

// The hook reads the page after the save, so the preview arrives a moment later.
Step("the link's preview shows the title {string}", async (_, title: string) => {
  await eventually(async () => {
    const link = await (await admin()).ok("GET", `${itemPath("links", linkId)}?fields=preview_title,previewed_at`);
    expect(link.previewed_at).not.toBeNull();
    expect(link.preview_title).toBe(title);
  });
});

Step("they set a link's preview title themselves", async () => {
  await runRows();
  refused = await (
    await theirSession()
  ).request("PATCH", itemPath("links", row["links"]), {
    preview_title: "Not the page's own title",
  });
});

Step("it isn't allowed", () => {
  expect(refused, "nothing was asked").toBeDefined();
  expect(refused!.status, JSON.stringify(refused!.body)).toBe(403);
});

describeAccessFeature("sail-team.feature");
