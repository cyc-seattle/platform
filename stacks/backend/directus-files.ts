import fs from "node:fs";
import path from "node:path";
import type { GroupPoliciesConfig, QueryGuardConfig, FrozenPlansConfig, WebsitePublishConfig } from "./policies.ts";
import type { FormsConfig } from "./forms.cjs";

// The files Directus loads at start, which the cluster mounts from ConfigMaps and CI from a directory.

/** The configs of the hook extensions Directus loads (./policies.ts). */
export interface DirectusExtensions {
  queryGuard: QueryGuardConfig;
  groupPolicies: GroupPoliciesConfig;
  frozenPlans: FrozenPlansConfig;
  websitePublish: WebsitePublishConfig;
  forms: FormsConfig;
  /** Where the website's forms post: Listmonk's public address, which the Gateway shares with Directus. */
  formsHostname: string;
  /** The planning engine's modules, which the frozen-plans hook loads (./engine-files.ts). */
  engine: Record<string, string>;
}

/** One extension's directory under /directus/extensions. */
export interface ExtensionDir {
  name: string;
  files: Record<string, string>;
}

export function extensionDirs(extensions: DirectusExtensions): ExtensionDir[] {
  const extension = (
    name: string,
    type: "hook" | "display" | "endpoint",
    source: string,
    files: Record<string, string> = {},
  ): ExtensionDir => ({
    name,
    files: {
      "package.json": JSON.stringify({
        name,
        version: "1.0.0",
        "directus:extension": { type, path: "index.js", source: "index.js", host: "^12.0.0" },
      }),
      "index.js": fs.readFileSync(path.resolve(import.meta.dirname, source), "utf8"),
      ...files,
    },
  });
  const hook = (name: string, source: string, config: object, files: Record<string, string> = {}) =>
    extension(name, "hook", source, { "config.json": JSON.stringify(config), ...files });
  return [
    hook("community-query-guard", "community-query-guard.cjs", extensions.queryGuard),
    hook("group-policies", "group-policies.cjs", extensions.groupPolicies),
    hook("frozen-plans", "frozen-plans.cjs", extensions.frozenPlans, extensions.engine),
    hook("catalog-rules", "catalog-rules.cjs", {}),
    hook("school-choice", "school-choice.cjs", {}),
    hook("link-preview", "link-preview.cjs", {}),
    hook("website-publish", "website-publish.cjs", extensions.websitePublish),
    extension("cents-as-dollars", "display", "cents-display.mjs"),
    extension("forms", "endpoint", "forms.cjs", { "config.json": JSON.stringify(extensions.forms) }),
  ];
}

/** Directus runs each migration it hasn't recorded at start, before it serves. */
export function migrationFiles(): Record<string, string> {
  const dir = path.resolve(import.meta.dirname, "migrations");
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".cjs"))
      .map((file) => [file, fs.readFileSync(path.join(dir, file), "utf8")]),
  );
}
