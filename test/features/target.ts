import { readFileSync } from "node:fs";
import type { CiStackTarget } from "../../src/ci-stack.ts";

// Where the features run: the CI stack on the runner (scripts/ci-stack), which describes itself in the
// file CI_STACK_TARGET names, or dev after each deploy. The CI stack runs every scenario. Dev runs only
// those tagged @smoke, which prove the deploy (docs/testing.md).

/** The CI stack, as `CiStackTarget` describes it. */
export type LocalTarget = CiStackTarget;

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
    throw new Error(`The CI stack doesn't run ${service}:${port}.`);
  }
  return url;
}

/** The tags a feature's scenarios are picked by, here. */
export function targetTags(): { includeTags?: string[]; excludeTags: string[] } {
  return localTarget() ? { excludeTags: [] } : { includeTags: ["smoke"], excludeTags: [] };
}
