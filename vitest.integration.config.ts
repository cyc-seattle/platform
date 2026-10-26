import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/features/**/*.test.ts"],
    // The steps wait for load balancers and the Gateway controller, and a sync's Job waits for a pod on
    // Spot capacity, then for the sync itself.
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
  },
});
