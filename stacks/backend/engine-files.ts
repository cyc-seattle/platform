import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PLANNING = path.resolve(import.meta.dirname, "../../src/planning");

/**
 * The planning engine as ES modules for the saved-versions hook, which runs it when a version is
 * saved. A ConfigMap's keys can't hold a `/`, so each file is `planning-<name>.mjs`, with its
 * imports renamed to match. The engine imports nothing but itself.
 */
export function engineFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of fs.readdirSync(PLANNING).filter((file) => file.endsWith(".ts"))) {
    const source = fs
      .readFileSync(path.join(PLANNING, name), "utf8")
      .replace(/from "\.\/([\w-]+)\.ts"/g, 'from "./planning-$1.mjs"');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
      fileName: name,
    });
    files[`planning-${name.replace(/\.ts$/, ".mjs")}`] = outputText;
  }
  return files;
}

/**
 * The engine version a saved version records: the package's version and a hash of the engine's
 * code. A commit would change it on every deploy, and a release is tagged after the deploy ships it.
 */
export function engineVersion(files: Record<string, string>): string {
  const { version } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8")) as {
    version: string;
  };
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort())
    hash
      .update(name)
      .update("\0")
      .update(files[name] as string);
  return `${version}+engine.${hash.digest("hex").slice(0, 12)}`;
}
