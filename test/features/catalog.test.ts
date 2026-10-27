import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, Step } from "./steps/index.ts";
import { admin, adminCreate, created, itemPath, key, runId } from "./steps/rows.ts";

// The data model's rules hold for everyone, so an admin checks them.

let productId: string | undefined;
let accountNumber: string | undefined;
let status = 0;
onEachScenario(() => {
  productId = undefined;
  accountNumber = undefined;
  status = 0;
});

Step("a product that runs a program", async () => {
  const product = await adminCreate("products", { id: randomUUID(), name: `Product ${runId}`, kind: "program" });
  await adminCreate("programs", { id: randomUUID(), name: `Program ${runId}`, product_id: product.id });
  productId = product.id;
});
Step("an admin deletes the product", async () => {
  ({ status } = await (await admin()).request("DELETE", itemPath("products", productId)));
});
// Directus answers a delete its foreign key refuses with a 500, so the read after it is the check.
Step("they're refused, and the product stays", async () => {
  expect(status).toBeGreaterThanOrEqual(400);
  await (await admin()).ok("GET", itemPath("products", productId));
});

const account = (number: string) => ({
  id: randomUUID(),
  number,
  name: `Account ${runId}`,
  type: "revenue",
  retired: false,
});

Step("an account in the catalog", async () => {
  accountNumber = key("account");
  await adminCreate("accounts", account(accountNumber));
});
Step("an admin adds another account with the same number", async () => {
  const second = account(accountNumber!);
  ({ status } = await (await admin()).request("POST", "/items/accounts", second));
  if (status < 300) {
    created.push({ collection: "accounts", id: second.id });
  }
});
Step("the catalog refuses it", () => {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
});

describeAccessFeature("catalog.feature");
