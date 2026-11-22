import { randomUUID } from "node:crypto";
import { afterAll, expect } from "vitest";
import { WEBSITE_FOLDER } from "../../stacks/backend/migrations/cyc0007-website-folder.cjs";
import { describeAccessFeature, onEachScenario, Step, theirSession } from "./steps/index.ts";
import { admin, adminCreate, newRow, row, runId, runRows } from "./steps/rows.ts";
import { newCamp, newProgram, signUp } from "./steps/teams.ts";

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
Step("it can't see anything outside the website, crew's public profiles, and what's on sale", async () => {
  const everything: { collection: string; schema: unknown }[] = await (
    await admin()
  ).ok("GET", "/collections?limit=-1");
  const allowed = new Set([
    "directus_files",
    "directus_folders",
    "crew_members",
    "crew_terms",
    "crew_positions",
    "people",
    "programs",
    "offerings",
    "registration_forms",
    "clubspot_camps",
  ]);
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

// Directus leaves out the fields a user can't read, so a linked program has only the four it may.
Step("it sees only the catalog program's name and ages", () => {
  expect(refused, "nothing was asked").toBeDefined();
  const { status, body } = refused!;
  expect(status, JSON.stringify(body)).toBe(200);
  const links = (body as { data: { catalog_programs: { catalog_program_id: Record<string, unknown> }[] } }).data
    .catalog_programs;
  expect(links.length, "the website's program lists its link").toBeGreaterThan(0);
  for (const { catalog_program_id: program } of links) {
    expect(Object.keys(program).sort(), JSON.stringify(body)).toEqual(["id", "max_age", "min_age", "name"]);
  }
});

const adminPatch = async (collection: string, id: string, changes: Record<string, unknown>) =>
  (await admin()).ok("PATCH", `/items/${collection}/${id}`, changes);

let sale: { offeringId: string; formId: string; campId: string } | undefined;
onEachScenario(() => {
  sale = undefined;
});

/** An offering of a new program, on its camp's registration form, with a sailor confirmed in it. */
async function onSale(campIsPublic: boolean, archived = false): Promise<void> {
  const program = await newProgram(await newCamp("running"));
  await adminPatch("clubspot_camps", program.camp.id, { public: campIsPublic, registration_closed: false });
  const form = await adminCreate("registration_forms", {
    name: `Form ${runId}`,
    opens_on: daysAgo(30),
    clubspot_camp_id: program.camp.id,
  });
  await adminPatch("offerings", program.offeringId, {
    registration_form_id: form.id,
    price_cents: 67_500,
    capacity: 12,
    ...(archived && { archived_at: new Date().toISOString() }),
  });
  const person = await adminCreate("people", await newRow("people"));
  await signUp(person.id, program);
  await adminPatch("offerings", program.offeringId, { confirmed_count: 1 });
  sale = { offeringId: program.offeringId, formId: form.id, campId: program.camp.id };
}
Step("an offering on a public Clubspot camp's form, with a sailor confirmed in it", () => onSale(true));
Step("an archived offering", () => onSale(true, true));
Step("an offering on the form of a Clubspot camp that isn't public", () => onSale(false));

Step("it can see the offering's dates, price and capacity, and that one is confirmed", async () => {
  const fields = "starts_on,ends_on,price_cents,capacity,confirmed_count";
  const { status, body } = await read(`/items/offerings/${sale!.offeringId}?fields=${fields}`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.data).toMatchObject({ price_cents: 67_500, capacity: 12, confirmed_count: 1 });
});
Step("it can see the offering's form, and whether its camp takes registrations", async () => {
  const fields =
    "registration_form_id.name,registration_form_id.opens_on,registration_form_id.clubspot_camp_id.registration_closed";
  const { status, body } = await read(`/items/offerings/${sale!.offeringId}?fields=${fields}`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.data.registration_form_id).toMatchObject({
    name: `Form ${runId}`,
    clubspot_camp_id: { registration_closed: false },
  });
});
Step("it can't see who registered, or the offering's link to Clubspot", async () => {
  for (const fields of ["clubspot_class_id", "clubspot_session_id"]) {
    const { status } = await read(`/items/offerings/${sale!.offeringId}?fields=${fields}`);
    expect(status, fields).toBe(403);
  }
  // Directus 12 leaves out a relation it may not read, rather than refusing: the answer is just the offering's key.
  for (const fields of ["registrations.person_id", "registrations.*"]) {
    const { status, body } = await read(`/items/offerings/${sale!.offeringId}?fields=${fields}`);
    if (status !== 403) {
      expect(status, fields).toBe(200);
      expect(body.data, fields).toBe(sale!.offeringId);
    }
  }
  const filter = encodeURIComponent(JSON.stringify({ registrations: { person_id: { _nnull: true } } }));
  expect((await read(`/items/offerings?fields=id&filter=${filter}`)).status).toBe(403);
  const { status } = await read(`/items/registrations?limit=1`);
  expect(status).toBe(403);
});
Step("it can't see the offering", () => seesNothing(byId("offerings", sale!.offeringId)));
Step("it can't see the camp", () => seesNothing(byId("clubspot_camps", sale!.campId)));

Step("a sponsor whose logo is kept outside the website's folder", async () => {
  pictureId = await upload(null);
  await adminCreate("website_sponsors", { id: randomUUID(), name: `Sponsor ${runId}`, logo: pictureId });
});
Step("it searches the sponsors by their logo's file name", async () => {
  const filter = encodeURIComponent(JSON.stringify({ logo: { filename_download: { _nnull: true } } }));
  refused = await (await theirSession()).request("GET", `/items/website_sponsors?filter=${filter}`);
});

// Crew. Each crew member has a person of their own, and a term in a position of their own.
let crew: { memberId: string; termId: string; qualificationId: string; personId: string } | undefined;
onEachScenario(() => {
  crew = undefined;
});
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function aCrewMember(onWebsite: boolean, position: string, ends_on: string | null): Promise<void> {
  await runRows();
  const member = await adminCreate("crew_members", await newRow("crew_members", { on_website: onWebsite }));
  const positionId = (await adminCreate("crew_positions", { id: randomUUID(), name: `${position} ${runId}` })).id;
  const term = await adminCreate(
    "crew_terms",
    await newRow("crew_terms", { crew_member_id: member.id, position_id: positionId, starts_on: daysAgo(60), ends_on }),
  );
  const held = await adminCreate(
    "crew_qualifications",
    await newRow("crew_qualifications", { crew_member_id: member.id }),
  );
  crew = { memberId: member.id, termId: term.id, qualificationId: held.id, personId: member["person_id"] as string };
}
Step("a crew member on the website, with a current term as Head Coach", () => aCrewMember(true, "Head Coach", null));
Step("a crew member who isn't on the website, with a current term as Head Coach", () =>
  aCrewMember(false, "Head Coach", null),
);
Step("a crew member on the website whose term as Treasurer ended yesterday", () =>
  aCrewMember(true, "Treasurer", daysAgo(1)),
);

const read = async (path: string) => (await theirSession()).request("GET", path);
const byId = (collection: string, id: string, fields = "id") =>
  `/items/${collection}?fields=${fields}&filter=${encodeURIComponent(JSON.stringify({ id: { _eq: id } }))}`;

Step("it can see their first and last name, whether to show both, and their bio and photo", async () => {
  const fields = "id,show_full_name,website_bio,website_photo,person_id.first_name,person_id.last_name";
  const { status, body } = await read(`/items/crew_members/${crew!.memberId}?fields=${fields}`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.data.person_id).toEqual({ first_name: "Casey", last_name: expect.any(String) });
  expect(body.data.show_full_name).toBe(false);
});
Step("it can see their term as Head Coach", async () => {
  const { status, body } = await read(`/items/crew_terms/${crew!.termId}?fields=id,position_id.name`);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.data.position_id.name).toBe(`Head Coach ${runId}`);
});
// The person's id comes with their crew member, but nothing about them but their name.
Step("it can't see anything else about them in the CRM", async () => {
  const { body } = await read(`/items/crew_members/${crew!.memberId}?fields=person_id`);
  for (const field of ["email", "phone", "date_of_birth", "street", "household_id"]) {
    const { status } = await read(`/items/people/${body.data.person_id}?fields=${field}`);
    expect(status, field).toBe(403);
  }
});
Step("it can't see their name", async () => {
  const filter = encodeURIComponent(JSON.stringify({ id: { _eq: crew!.personId } }));
  const { status, body } = await read(`/items/people?fields=id,first_name,last_name&filter=${filter}`);
  if (status !== 403) {
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data).toEqual([]);
  }
});
Step("a person in the CRM who isn't on Crew", async () => {
  await runRows();
  const person = await adminCreate("people", await newRow("people", { first_name: "Robin" }));
  crew = { memberId: "", termId: "", qualificationId: "", personId: person.id };
});
Step("it can't see their qualifications or pay", async () => {
  const held = await read(`/items/crew_qualifications/${crew!.qualificationId}`);
  expect(held.status, JSON.stringify(held.body)).toBe(403);
  const pay = await read(`/items/crew_terms/${crew!.termId}?fields=hourly_rate_cents`);
  expect(pay.status, JSON.stringify(pay.body)).toBe(403);
});
// A row its rule hides reads as nothing, not a refusal.
async function seesNothing(path: string): Promise<void> {
  const { status, body } = await read(path);
  if (status !== 403) {
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data, path).toEqual([]);
  }
}
Step("it can't see them or their terms", async () => {
  await seesNothing(byId("crew_members", crew!.memberId));
  await seesNothing(byId("crew_terms", crew!.termId));
});
Step("it can't see that term", () => seesNothing(byId("crew_terms", crew!.termId)));
Step("it searches crew members by their person's email", async () => {
  const filter = encodeURIComponent(JSON.stringify({ person_id: { email: { _nnull: true } } }));
  refused = await read(`/items/crew_members?filter=${filter}`);
});

Step("it isn't allowed", () => {
  expect(refused, "nothing was asked").toBeDefined();
  expect(refused!.status, JSON.stringify(refused!.body)).toBe(403);
});

describeAccessFeature("website.feature");
