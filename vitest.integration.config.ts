import { defineConfig } from "vitest/config";

// The features run against the CI stack on the runner (scripts/ci-stack, test/features/target.ts).
export default defineConfig({
  test: {
    include: ["test/features/**/*.test.ts"],
    // The steps wait on Directus, not the runner's CPU. Directus is one Node process beside the tests,
    // so more workers only queue on it.
    maxWorkers: Number(process.env["CI_STACK_WORKERS"] ?? 8),
    testTimeout: 3 * 60_000,
    hookTimeout: 60_000,
  },
});
