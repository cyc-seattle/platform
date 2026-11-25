import * as gcp from "@pulumi/gcp";
import * as github from "@pulumi/github";
import { platform, sailTeam } from "./github.ts";

// Each repo's integration-ci licenses its throwaway Directus with prod's key (docs/testing.md). Creating the
// secret overwrites one set by hand, and importing one leaves its value empty, so neither is imported.
const licenseKey = gcp.secretmanager.getSecretVersionAccessOutput({ secret: "directus-license-key" }).secretData;

export const directusLicenseSecrets = (
  [
    ["platform", platform],
    ["sail-team", sailTeam],
  ] as const
).map(
  ([label, repo]) =>
    new github.ActionsSecret(`${label}-directus-license-key`, {
      repository: repo.name,
      secretName: "DIRECTUS_LICENSE_KEY",
      value: licenseKey,
    }),
);
