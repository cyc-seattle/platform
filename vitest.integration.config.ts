import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/features/**/*.test.ts"],
    // The steps wait on dev, not the runner's CPU, so every file runs at once and the run takes as
    // long as its longest file. vitest's default is one fewer than the runner's 4 cores.
    maxWorkers: 16,
    // The steps wait for load balancers and the Gateway controller, and a sync's Job waits for a pod on
    // Spot capacity, then for the sync itself.
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
  },
});
