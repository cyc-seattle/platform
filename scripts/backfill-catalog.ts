// Fills $PULUMI_STACK's catalog from the CRM (cyc-seattle/workplace#6 step 10): a revenue account
// for each code programs and camps use, and a product of kind program for each program, booked to
// its program's account. It reads everything from the CRM, so no club data lives in the repo.
//
// A dry run unless given --apply. Safe to run again. It prints counts only, never names or codes.
//
//   PULUMI_STACK=dev mise exec -- node scripts/backfill-catalog.ts [--apply]

import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { outputsObject, parsePlatformOutputs, stateBucket } from "../src/outputs.ts";
import { type BackfillRows, planBackfill } from "./catalog-backfill.ts";

const apply = process.argv.includes("--apply");
const environment = process.env["PULUMI_STACK"];
const project = process.env["GCP_PROJECT"];
if (!environment || !project) {
  throw new Error("Run under mise, with PULUMI_STACK set to dev or prod.");
}

const google = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function googleFetch(url: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${await google.getAccessToken()}` } });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Reads the admin's password from the Secret Directus reads it from, as the integration tests do.
async function directusAdmin(): Promise<{ baseUrl: string; email: string; password: string }> {
  const bucket = stateBucket(project!, environment!);
  const text = JSON.stringify(
    await googleFetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(outputsObject)}?alt=media`,
    ),
  );
  const platform = parsePlatformOutputs(text, `gs://${bucket}/${outputsObject}`);
  const kube = (path: string) => googleFetch(`https://${platform.clusterEndpoint}${path}`);
  const deployment = await kube(`/apis/apps/v1/namespaces/${platform.namespace}/deployments/directus`);
  const env: { name: string; value?: string }[] = deployment.spec.template.spec.containers[0].env;
  const email = env.find(({ name }) => name === "ADMIN_EMAIL")?.value;
  const secret = await kube(`/api/v1/namespaces/${platform.namespace}/secrets/directus`);
  const password = Buffer.from(secret.data.ADMIN_PASSWORD, "base64").toString("utf8");
  if (!email) throw new Error("Directus's Deployment sets no ADMIN_EMAIL.");
  return { baseUrl: `https://directus.${platform.domain}`, email, password };
}

const { baseUrl, email, password } = await directusAdmin();

const token = (async () => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`The admin can't sign in: ${response.status}`);
  return ((await response.json()) as { data: { access_token: string } }).data.access_token;
})();

// An error names only the request and status: a body could echo a row's values.
async function call(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${await token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path.split("?")[0]}: ${response.status}`);
  }
  return text ? JSON.parse(text).data : undefined;
}

const read = (collection: string, fields: string[]) =>
  call("GET", `/items/${collection}?fields=${fields.join(",")}&limit=-1`);

const rows: BackfillRows = {
  programs: await read("programs", ["id", "name", "revenue_account", "product_id"]),
  products: await read("products", ["id", "kind", "revenue_account_id"]),
  accounts: await read("accounts", ["id", "number"]),
  camps: await read("camps", ["clubspot_sales_account"]),
};
const plan = planBackfill(rows, randomUUID);

console.log(`${environment}: ${apply ? "applying" : "dry run, given no --apply"}`);
console.log(
  `  programs: ${rows.programs.length}, products: ${rows.products.length}, accounts: ${rows.accounts.length}`,
);
console.log(`  revenue accounts to add: ${plan.accounts.length}`);
console.log(`  programs to give a product: ${plan.programs.length}`);
console.log(`  of those, booked to an account: ${plan.products.filter((p) => p.revenue_account_id).length}`);
console.log(`  existing products to book to their program's account: ${plan.productAccounts.length}`);
console.log(`  products already booked elsewhere, left for staff: ${plan.conflicts}`);
console.log(`  programs whose product isn't a program, left for the audit: ${plan.wrongKind}`);

if (apply) {
  if (plan.accounts.length > 0) {
    await call("POST", "/items/accounts", plan.accounts);
  }
  // One request per program creates its product and links it in one transaction, so a failure
  // never leaves a product that a second run would duplicate.
  const productById = new Map(plan.products.map((product) => [product.id, product]));
  for (const program of plan.programs) {
    await call("PATCH", `/items/programs/${program.id}`, { product_id: productById.get(program.product_id) });
  }
  if (plan.productAccounts.length > 0) {
    await call("PATCH", "/items/products", plan.productAccounts);
  }
  const after = planBackfill(
    {
      programs: await read("programs", ["id", "name", "revenue_account", "product_id"]),
      products: await read("products", ["id", "kind", "revenue_account_id"]),
      accounts: await read("accounts", ["id", "number"]),
      camps: rows.camps,
    },
    randomUUID,
  );
  const left = after.accounts.length + after.programs.length + after.productAccounts.length;
  console.log(left === 0 ? "Done: nothing left to backfill." : `Not done: ${left} writes still planned.`);
  if (left !== 0) process.exitCode = 1;
}
