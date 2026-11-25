// Fills the CI stack's Directus with sample data for screenshots and demos (docs/testing.md): the Givens
// in test/seed/sample-data.feature, kept after the run. It reads the stack from CI_STACK_TARGET, so it
// never reaches dev or prod, and does nothing on a stack it has already seeded.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LocalTarget } from "../test/features/target.ts";

const root = path.resolve(import.meta.dirname, "..");
// A Directus folder with a fixed id, made once the seed has finished.
const marker = { id: "5eed0000-0000-4000-8000-000000000056", name: "Sample data" };

const file = process.env["CI_STACK_TARGET"];
if (!file || !fs.existsSync(file)) {
  throw new Error("No CI stack: run `mise run ci-stack` first, and this under mise.");
}
const { directus } = JSON.parse(fs.readFileSync(file, "utf8")) as LocalTarget;

async function call(method: string, url: string, token?: string, body?: unknown): Promise<Response> {
  const send = () =>
    fetch(`${directus.url}${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  try {
    return await send();
  } catch (error) {
    // Directus closes an idle keep-alive socket while the seed runs, and fetch reuses it once.
    if ((error as { cause?: { code?: string } }).cause?.code !== "UND_ERR_SOCKET") throw error;
    return send();
  }
}

async function json(response: Response): Promise<any> {
  if (!response.ok) {
    throw new Error(`${response.url}: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { data: unknown }).data;
}

const { access_token: token } = await json(
  await call("POST", "/auth/login", undefined, { email: directus.adminEmail, password: directus.adminPassword }),
);

if ((await call("GET", `/folders/${marker.id}`, token)).ok) {
  console.log("The CI stack already has the sample data.");
} else {
  execFileSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.seed.config.ts"], { cwd: root, stdio: "inherit" });
  await json(await call("POST", "/folders", token, marker));
}

const filter = encodeURIComponent(JSON.stringify({ email: { _icontains: ".sample-" } }));
const users: { email: string; role: { name: string } | null }[] = await json(
  await call("GET", `/users?filter=${filter}&fields=email,role.name&sort=email&limit=-1`, token),
);
console.log(`\nDirectus: ${directus.url}, as ${directus.adminEmail} / ${directus.adminPassword}`);
console.log("The sample logins, each with the password sample-password:");
for (const user of users) {
  console.log(`  ${user.email} (${user.role?.name ?? "no role"})`);
}
console.log(
  "\nStop the stack today, with `mise run ci-stack-down`: a Directus left running for 24 hours spends a license activation.",
);
