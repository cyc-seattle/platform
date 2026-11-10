import { randomUUID } from "node:crypto";
import { afterAll, expect } from "vitest";
import { WEBSITE_FOLDER } from "../../stacks/backend/migrations/cyc0005-website-folder.cjs";
import { describeAccessFeature, onEachScenario, Step, theirSession } from "./steps/index.ts";
import { admin, adminCreate, runId } from "./steps/rows.ts";

// A 1x1 transparent PNG.
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const uploaded: string[] = [];
let pageId: string | undefined;
let pictureId: string | undefined;
onEachScenario(() => {
  pageId = undefined;
  pictureId = undefined;
});

// Files aren't items, so the shared cleanup can't delete them.
afterAll(async () => {
  for (const id of uploaded) {
    await (await admin()).request("DELETE", `/files/${id}`);
  }
});

async function upload(folder: string | null): Promise<string> {
  const form = new FormData();
  if (folder !== null) {
    form.append("folder", folder);
  }
  form.append("title", `Picture ${runId}`);
  form.append("file", new Blob([PICTURE], { type: "image/png" }), `picture-${runId}.png`);
  const file = await (await admin()).upload(form);
  uploaded.push(file.id);
  return file.id;
}

Step("a page on the website", async () => {
  const slug = `page-${runId}-${randomUUID().slice(0, 8)}`;
  pageId = (await adminCreate("website_pages", { id: randomUUID(), slug, title: `Page ${runId}` })).id;
});
Step("it can see the page", async () => {
  const { status, body } = await (await theirSession()).request("GET", `/items/website_pages/${pageId}`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.data.id).toBe(pageId);
});

Step("a picture in the website's folder", async () => {
  pictureId = await upload(WEBSITE_FOLDER);
});
Step("a picture outside the website's folder", async () => {
  pictureId = await upload(null);
});

// Both the file's details and the picture itself.
Step("it can see the picture", async () => {
  const user = await theirSession();
  const { status, body } = await user.request("GET", `/files/${pictureId}`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(await user.fetchAsset(pictureId!)).toBe(200);
});
Step("it can't see the picture", async () => {
  const user = await theirSession();
  const { status, body } = await user.request("GET", `/files/${pictureId}`);
  expect(status, JSON.stringify(body)).toBe(403);
  expect(await user.fetchAsset(pictureId!)).toBe(403);
});

describeAccessFeature("website.feature");
