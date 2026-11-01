import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, expectRefusal, onEachScenario, Step } from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, key, newRow, runId, runRows, type Row } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

let productId: string | undefined;
let accountNumber: string | undefined;
onEachScenario(() => {
  productId = undefined;
  accountNumber = undefined;
});

Step("a program with details of its own", async () => {
  const product = await adminCreate("products", { id: randomUUID(), name: `Product ${runId}`, kind: "program" });
  await adminCreate("programs", { id: randomUUID(), name: `Program ${runId}`, product_id: product.id });
  productId = product.id;
});
// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("an admin deletes the program's product", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("products", productId));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the product is still in the catalog", async () => {
  await (await admin()).ok("GET", itemPath("products", productId));
});

const account = (number: string) => ({
  id: randomUUID(),
  number,
  name: `Account ${runId}`,
  type: "revenue",
  retired: false,
});

Step("a revenue account in the catalog", async () => {
  accountNumber = key("account");
  await adminCreate("accounts", account(accountNumber));
});
Step("an admin adds another revenue account with the same number", async () => {
  const second = account(accountNumber!);
  const { status } = await (await admin()).request("POST", "/items/accounts", second);
  if (status < 300) {
    created.push({ collection: "accounts", id: second.id });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

let areaId: string | undefined;
onEachScenario(() => {
  areaId = undefined;
});

const programArea = async (fields: Row = {}) =>
  (await adminCreate("program_areas", { ...(await newRow("program_areas")), ...fields })).id;

Step("a program area with a program in it", async () => {
  await runRows();
  areaId = await programArea();
  await adminCreate("products", await newRow("products", { kind: "program", program_area_id: areaId }));
});
// As with a program's product, a 500 from the foreign key is the refusal, so the read after it is the check.
Step("an admin deletes the program area", async () => {
  const { status } = await (await admin()).request("DELETE", itemPath("program_areas", areaId));
  expectRefusal(() => expect(status).toBeGreaterThanOrEqual(400));
});
Step("the program area is still in the catalog", async () => {
  await (await admin()).ok("GET", itemPath("program_areas", areaId));
});
Step("an admin adds a program area with no revenue account", async () => {
  await runRows();
  const area: Row = { ...(await newRow("program_areas")), revenue_account_id: null };
  const { status } = await (await admin()).request("POST", "/items/program_areas", area);
  if (status < 300) {
    created.push({ collection: "program_areas", id: area["id"] });
  }
  expectRefusal(() => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});
describeAccessFeature("catalog.feature");
