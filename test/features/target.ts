import { readFileSync } from "node:fs";

// Where the features run: the CI stack on the runner (scripts/ci-stack), which describes itself in the
// file CI_STACK_TARGET names, or dev after each deploy. The CI stack runs every scenario but those
// tagged @dev, which need what only dev has. Dev runs those, and the ones tagged @smoke, which prove
// the deploy (docs/testing.md).

export interface LocalTarget {
  directus: { url: string; adminEmail: string; adminPassword: string; communityRoleId: string };
  /** Where the website's forms post, in place of dev's `https://mail.<domain>`. */
  formsUrl: string;
  /** Each Service's URL as this process reaches it, by its in-cluster `name:port`. */
  services: Record<string, string>;
  /** Each sync's env, as dev's CronJob gives it. */
  cronJobs: Record<string, Record<string, string>>;
}

let loaded: LocalTarget | undefined;

/** The CI stack, or undefined on dev. */
export function localTarget(): LocalTarget | undefined {
  const file = process.env["CI_STACK_TARGET"];
  if (!file) {
    return undefined;
  }
  loaded ??= JSON.parse(readFileSync(file, "utf8")) as LocalTarget;
  return loaded;
}

/** A Service's local URL, by its in-cluster `name:port`. */
export function localService(target: LocalTarget, service: string, port: number): string {
  const url = target.services[`${service}:${port}`];
  if (url === undefined) {
    throw new Error(`The CI stack doesn't run ${service}:${port}. Tag the scenario @dev.`);
  }
  return url;
}

/** The tags a feature's scenarios are picked by, here. */
export function targetTags(): { includeTags?: string[]; excludeTags: string[] } {
  return localTarget() ? { excludeTags: ["dev"] } : { includeTags: ["dev", "smoke"], excludeTags: [] };
}
