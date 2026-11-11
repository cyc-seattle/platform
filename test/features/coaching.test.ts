import { expect } from "vitest";
import { the } from "./steps/community.ts";
import { describeAccessFeature, expectRefusal, onEachScenario, pattern, Step, theirSession } from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, newRow, type Row } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

// A season of a year, such as "fall 2026".
pattern("season", /(?:winter|spring|summer|fall) \d{4}/);

const parse = (season: string) => {
  const [name, year] = season.split(" ");
  return { season: name, year: Number(year) };
};

let sailorId: string | undefined;
let found: { status: number; rows: Row[] } | undefined;
onEachScenario(() => {
  sailorId = undefined;
  found = undefined;
});

const recommend = async (personId: string, season: string) =>
  adminCreate("recommendations", { ...(await newRow("recommendations", { person_id: personId })), ...parse(season) });

Step("a sailor with a recommendation for {season}", async (_, season: string) => {
  sailorId = (await adminCreate("people", await newRow("people", { first_name: "Sailor" }))).id;
  await recommend(sailorId, season);
});

Step("an admin adds another recommendation for the sailor for {season}", async (_, season: string) => {
  const data: Row = { ...(await newRow("recommendations", { person_id: sailorId })), ...parse(season) };
  const { status } = await (await admin()).request("POST", "/items/recommendations", data);
  if (status < 300) {
    created.push({ collection: "recommendations", id: data["id"] });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

Step("the sailor has recommendations for {season} and {season}", async (_, first: string, second: string) => {
  const filter = encodeURIComponent(JSON.stringify({ person_id: { _eq: sailorId } }));
  const rows: Row[] = await (
    await admin()
  ).ok("GET", `/items/recommendations?filter=${filter}&fields=year,season&sort=year`);
  expect(rows).toEqual([parse(first), parse(second)]);
});

// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes the sailor", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("people", sailorId));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the sailor is still in the CRM", async () => {
  await (await admin()).ok("GET", itemPath("people", sailorId));
});

Step("their child has a recommendation for {season}", async (_, season: string) => {
  await recommend(the("the child").id, season);
});
Step("they look up their child's recommendations", async () => {
  const filter = encodeURIComponent(JSON.stringify({ person_id: { _eq: the("the child").id } }));
  const { status, body } = await (await theirSession()).request("GET", `/items/recommendations?filter=${filter}`);
  found = { status, rows: body?.data ?? [] };
});
// A role with no rule on a collection reads a 403; one whose rules match no row reads an empty list.
Step("they don't see any recommendations", () => {
  expect(found!.status === 403 || (found!.status === 200 && found!.rows.length === 0), JSON.stringify(found)).toBe(
    true,
  );
});

describeAccessFeature("coaching.feature");
