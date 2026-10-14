import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/features/**/*.test.ts"],
    // The steps wait for load balancers and the Gateway controller.
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
});
