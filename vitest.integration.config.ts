import { defineConfig } from "vitest/config";

// On the CI stack (scripts/ci-stack) the features run against Directus on the runner; on dev, only what
// needs dev or proves its deploy (test/features/target.ts).
const local = Boolean(process.env["CI_STACK_TARGET"]);

// The features with a scenario tagged @dev or @smoke.
const onDev = ["smoke", "isolation", "inbox", "newsletter", "authorization", "clubspot", "gsuite"];
// Wholly @dev, and declared without the shared steps' tag filter.
const devOnly = ["smoke", "isolation", "inbox"];

export default defineConfig({
  test: {
    include: local ? ["test/features/**/*.test.ts"] : onDev.map((name) => `test/features/${name}.test.ts`),
    exclude: local ? devOnly.map((name) => `test/features/${name}.test.ts`) : [],
    // The steps wait on Directus, not the runner's CPU. On the CI stack, Directus is one Node process
    // beside the tests, so more workers only queue on it.
    maxWorkers: local ? Number(process.env["CI_STACK_WORKERS"] ?? 8) : 8,
    // On dev, a step waits for a sync's Job to get a pod on Spot capacity, then for the sync itself.
    testTimeout: local ? 3 * 60_000 : 15 * 60_000,
    hookTimeout: 60_000,
  },
});
