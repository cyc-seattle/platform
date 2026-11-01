import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = path.join(import.meta.dirname, "../src");

/** Every file under `src/` that the entry points reach through relative imports and re-exports. */
function reachable(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((entry) => path.join(src, entry));
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const { importedFiles } = ts.preProcessFile(fs.readFileSync(file, "utf8"), true, true);
    for (const { fileName } of importedFiles) {
      if (fileName.startsWith(".")) {
        queue.push(path.resolve(path.dirname(file), fileName));
      }
    }
  }
  return [...seen].map((file) => path.relative(src, file));
}

// The syncs' dependencies are devDependencies, bundled into their images, so an app that installs
// the package would fail to load anything that reaches them.
describe("the published package", () => {
  it("reaches none of the syncs or their model", () => {
    const files = reachable(["index.ts", "planning/index.ts"]);
    expect(files).toContain("planning/index.ts");
    expect(files.filter((file) => file.startsWith("syncs/") || file.startsWith("model/"))).toEqual([]);
  });
});
