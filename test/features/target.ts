import { readFileSync } from "node:fs";
import type { CiStackTarget } from "../../src/ci-stack.ts";

// The features run against the CI stack (scripts/ci-stack), which describes itself in the file
// CI_STACK_TARGET names (docs/testing.md).

/** The CI stack, as `CiStackTarget` describes it. */
export type LocalTarget = CiStackTarget;

let loaded: LocalTarget | undefined;

/** The CI stack the features run against. */
export function localTarget(): LocalTarget {
  const file = process.env["CI_STACK_TARGET"];
  if (!file) {
    throw new Error(
      "CI_STACK_TARGET isn't set. Start the CI stack with `mise run ci-stack`, then run the features with `mise run integration-ci`.",
    );
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
