import base from "@cyc-seattle/ts-config/vitest";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

// The integration tests need the dev deploy, so they run apart: vitest.integration.config.ts.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["packages/*/test/**/*.test.ts"],
      exclude: [...configDefaults.exclude, "test/features/**"],
    },
  }),
);
