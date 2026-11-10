// Compares the external domain's Cloud DNS zone with the name servers the domain is delegated to,
// for every name the zone declares and the common ones it might lack. Run before switching name
// servers (docs/manual-setup.md); it exits 1 on any difference.
import childProcess from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { externalRecords } from "../stacks/infra/external-records.ts";
import { PROBE_NAMES, compare, resolverFor } from "./dns-diff.ts";

const stackConfig = path.resolve(import.meta.dirname, "../stacks/infra/Pulumi.prod.yaml");
const { config } = yaml.load(fs.readFileSync(stackConfig, "utf8")) as { config: Record<string, unknown> };
const domain = config["infra:externalDomain"] as string;

// The infra stack's output, which the registrar delegation uses too. Reading it needs mise's backend.
const nameServers = childProcess.execFileSync(
  "pulumi",
  ["stack", "output", "nameServers", "--json", "--stack", "prod", "--cwd", path.dirname(stackConfig)],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const zoneServers = (JSON.parse(nameServers) as { external: string[] }).external;
const delegatedServers = await dns.resolveNs(domain);

console.log(`Zone:      ${zoneServers.join(", ")}`);
console.log(`Delegated: ${delegatedServers.join(", ")}`);

const names = [...externalRecords.map((r) => r.name), ...PROBE_NAMES];
const differences = await compare(domain, names, await resolverFor(zoneServers), await resolverFor(delegatedServers));

for (const d of differences) {
  console.log(`\n${d.name || "@"} ${d.type}`);
  console.log(`  zone:      ${JSON.stringify(d.zone)}`);
  console.log(`  delegated: ${JSON.stringify(d.delegated)}`);
}
if (differences.length > 0) {
  console.error(`\n${differences.length} difference(s).`);
  process.exit(1);
}
console.log(`\nNo differences across ${new Set(names).size} names.`);
