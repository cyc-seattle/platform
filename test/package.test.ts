import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/** Every module specifier a file imports or re-exports, static or dynamic. */
function specifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("the planning subpath", () => {
  // An app installs @cyc-seattle/platform for `planning` and runs it in a browser.
  it("imports nothing but its own files and the package's dependencies", () => {
    const allowed = Object.keys(pkg.dependencies);
    for (const file of files(join(root, "src/planning"))) {
      for (const specifier of specifiers(file)) {
        if (!specifier.startsWith(".")) {
          expect(allowed, `${file} imports ${specifier}`).toContain(specifier.split("/")[0]);
        }
      }
    }
  });

  it("reaches no file outside src/planning", () => {
    for (const file of files(join(root, "src/planning"))) {
      for (const specifier of specifiers(file).filter((s) => s.startsWith("."))) {
        expect(resolve(file, "..", specifier), `${file} imports ${specifier}`).toMatch(
          new RegExp(`^${join(root, "src/planning")}/`),
        );
      }
    }
  });
});

describe("the peer dependencies", () => {
  // So an app that only uses `planning` doesn't have to install Pulumi.
  it("are all optional", () => {
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(pkg.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
    }
  });
});
