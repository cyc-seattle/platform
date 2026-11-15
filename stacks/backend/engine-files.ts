import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PLANNING = path.resolve(import.meta.dirname, "../../src/planning");

/**
 * The planning engine as ES modules for the frozen-plans hook, which runs it when a Financial Plan
 * changes or is frozen. A ConfigMap's keys can't hold a `/`, so each file is `planning-<name>.mjs`, with its
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
 * The release this checkout is, or the last one before it: the latest `v*` tag it holds. The release
 * job tags a commit before its deploy runs, so a deploy stamps the release that ships it. A deploy
 * from Actions fails without one, so it never stamps the package's placeholder version.
 */
function release(): string {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .replace(/^v/, "");
  } catch (error) {
    if (process.env["GITHUB_ACTIONS"])
      throw new Error("No release tag found, so the engine version can't be stamped.", { cause: error });
    const { version } = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"),
    ) as { version: string };
    return version;
  }
}

/**
 * The engine version each Financial Plan's results record: the release and a hash of the engine's
 * code, which marks a changed engine whatever the release.
 */
export function engineVersion(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort())
    hash
      .update(name)
      .update("\0")
      .update(files[name] as string);
  return `${release()}+engine.${hash.digest("hex").slice(0, 12)}`;
}
