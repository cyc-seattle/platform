import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import type { AuthentikOnCluster } from "./cluster.ts";
import { builtInQueries } from "./naming.ts";

/**
 * The Authentik scripts/ci-stack runs in containers, at `authentik:localUrl`. It starts Authentik with
 * the bootstrap token this reads from config, so nothing here creates it.
 */
export async function localAuthentik(): Promise<AuthentikOnCluster> {
  const config = new pulumi.Config();
  const url = config.require("localUrl");
  const bootstrapToken = config.requireSecret("localBootstrapToken");
  const ready = new command.local.Command("authentik-api-ready", {
    create: ["../../scripts/wait-for-authentik", ...builtInQueries().map((q) => `'${q}'`)].join(" "),
    environment: { AUTHENTIK_URL: url, AUTHENTIK_TOKEN: bootstrapToken, AUTHENTIK_WAIT_PASSES: "1" },
  });
  return { domain: "localhost", url, bootstrapToken, ready };
}

/** The host and port the CI stack's browser reaches Authentik at, from `authentik:localUrl`. */
export function localLoginHost(): string {
  return new URL(new pulumi.Config().require("localUrl")).host;
}

/**
 * In place of a sibling stack's output, the value `authentik:localSiblings` gives as `<project>.<output>`.
 * The CI stack has no `backend`, `inbox` or `listmonk` stack of its own for Authentik to read.
 */
export function localSibling(project: string, output: string): string {
  const value = new pulumi.Config().requireObject<Record<string, string>>("localSiblings")[`${project}.${output}`];
  if (value === undefined) {
    throw new Error(`authentik:localSiblings has no ${project}.${output}.`);
  }
  return value;
}
