import { randomUUID } from "node:crypto";
import { afterAll, expect } from "vitest";
import { WEBSITE_FOLDER } from "../../stacks/backend/migrations/cyc0007-website-folder.cjs";
import { describeAccessFeature, onEachScenario, Step, theirSession } from "./steps/index.ts";
import { admin, adminCreate, row, runId, runRows } from "./steps/rows.ts";

// A 1x1 transparent PNG.
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const uploaded: string[] = [];
let pageId: string | undefined;
let pictureId: string | undefined;
let websiteProgramId: string | undefined;
let refused: { status: number; body: unknown } | undefined;
onEachScenario(() => {
  pageId = undefined;
  pictureId = undefined;
  websiteProgramId = undefined;
  refused = undefined;
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

// Every collection, the system's own included, read through its own route. A route Directus doesn't
// serve, such as its migrations', is skipped.
Step("it can't see anything outside the website", async () => {
  const everything: { collection: string; schema: unknown }[] = await (
    await admin()
  ).ok("GET", "/collections?limit=-1");
  const allowed = new Set(["directus_files", "directus_folders"]);
  const seen: string[] = [];
  for (const { collection, schema } of everything) {
    // A folder in the Data Studio has no table.
    if (schema === null || collection.startsWith("website_") || allowed.has(collection)) {
      continue;
    }
    const route = collection.startsWith("directus_")
      ? `/${collection.slice("directus_".length)}?limit=1`
      : `/items/${collection}?limit=1`;
    if ((await (await admin()).request("GET", route)).status === 404) {
      continue;
    }
    const { status } = await (await theirSession()).request("GET", route);
    seen.push(`${collection}: ${status}`);
  }
  expect(seen.filter((line) => !line.endsWith(": 403"))).toEqual([]);
  expect(seen.length).toBeGreaterThan(50);
});

Step("a program on the website linked to a program in the catalog", async () => {
  await runRows();
  websiteProgramId = (
    await adminCreate("website_programs", {
      id: randomUUID(),
      slug: `program-${runId}-${randomUUID().slice(0, 8)}`,
      title: `Program ${runId}`,
      catalog_programs: [{ catalog_program_id: row["programs"] }],
    })
  ).id;
});
Step("it looks at the catalog program through the website's program", async () => {
  const fields = encodeURIComponent("id,catalog_programs.catalog_program_id.*");
  refused = await (await theirSession()).request("GET", `/items/website_programs/${websiteProgramId}?fields=${fields}`);
});

// Directus leaves out the fields a user can't read, so the list holds only its links' own IDs.
Step("it sees none of the catalog program's details", () => {
  expect(refused, "nothing was asked").toBeDefined();
  const { status, body } = refused!;
  if (status === 403) {
    return;
  }
  expect(status, JSON.stringify(body)).toBe(200);
  const links = (body as { data: { catalog_programs: unknown[] } }).data.catalog_programs;
  expect(links.length, "the website's program lists its link").toBeGreaterThan(0);
  for (const link of links) {
    expect(typeof link, JSON.stringify(body)).toBe("string");
  }
  expect(JSON.stringify(body)).not.toContain(String(row["programs"]));
});

Step("a sponsor whose logo is kept outside the website's folder", async () => {
  pictureId = await upload(null);
  await adminCreate("website_sponsors", { id: randomUUID(), name: `Sponsor ${runId}`, logo: pictureId });
});
Step("it searches the sponsors by their logo's file name", async () => {
  const filter = encodeURIComponent(JSON.stringify({ logo: { filename_download: { _nnull: true } } }));
  refused = await (await theirSession()).request("GET", `/items/website_sponsors?filter=${filter}`);
});

Step("it isn't allowed", () => {
  expect(refused, "nothing was asked").toBeDefined();
  expect(refused!.status, JSON.stringify(refused!.body)).toBe(403);
});

describeAccessFeature("website.feature");
