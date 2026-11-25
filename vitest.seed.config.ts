import { defineConfig } from "vitest/config";

// The sample data scripts/ci-seed.ts leaves in the CI stack: the features' Givens, kept.
export default defineConfig({
  test: {
    include: ["test/seed/*.test.ts"],
    env: { SEED_RUN_ID: "Sample", SEED_PASSWORD: "sample-password" },
    testTimeout: 3 * 60_000,
    hookTimeout: 60_000,
  },
});
