import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Pulumi stores each provider's serialized code in state. A top-level import of an ESM package is
// copied in by value, and a named builtin import fails to serialize (AGENTS.md, Modules). This runs
// in plain Node, because vitest's module transform changes what the serializer captures.
const script = `
import * as pulumi from "@pulumi/pulumi";
const resources = await import(process.argv.at(-1));
const sizes = {};
for (const [name, provider] of Object.entries(resources)) {
  if (!name.endsWith("Provider")) continue;
  const { text } = await pulumi.runtime.serializeFunction(() => provider, { allowSecrets: false, isFactoryFunction: true });
  sizes[name] = text.length;
}
console.log(JSON.stringify(sizes));
`;

// The providers serialize to 12–17 KB, while an inlined npm package adds tens of KB or more.
const MAX_BYTES = 24_000;

describe("Directus providers", () => {
  it("serialize without inlining a package", () => {
    const resources = pathToFileURL(path.join(import.meta.dirname, "../src/directus/resources.ts")).href;
    // On stdin, not `-e`, which makes every builtin a global and hides a named import.
    const output = execFileSync(process.execPath, ["--input-type=module", "-", resources], {
      cwd: path.join(import.meta.dirname, ".."),
      input: script,
      stdio: "pipe",
      encoding: "utf8",
    });
    const sizes = JSON.parse(output) as Record<string, number>;

    expect(Object.keys(sizes).sort()).toEqual([
      "directusAccessProvider",
      "directusPermissionRuleProvider",
      "directusPolicyProvider",
      "directusRoleProvider",
      "directusSchemaProvider",
      "directusSettingsProvider",
      "directusUserProvider",
      "savedVersionsCheckProvider",
    ]);
    for (const [name, size] of Object.entries(sizes)) {
      expect(size, name).toBeLessThan(MAX_BYTES);
    }
  }, 30_000);
});
