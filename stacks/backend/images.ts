// The images the cluster and the CI stack (scripts/ci-stack) run. Plain data, no `@pulumi/*` import.

export const directusImage = "directus/directus:12.3.1";
// Renovate bumps each fake with its SDK, which publishes it (renovate.json).
export const clubspotFakeImage = "ghcr.io/cyc-seattle/clubspot-fake:0.4.1";
export const workspaceFakeImage = "ghcr.io/cyc-seattle/workspace-fake:1.2.0";
