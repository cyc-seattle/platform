import { defineConfig } from "vitest/config";

// On the CI stack (scripts/ci-stack) every feature runs against the stack on the runner; on dev, only
// the scenarios tagged @smoke, which prove the deploy (test/features/target.ts).
const local = Boolean(process.env["CI_STACK_TARGET"]);

// The features with a scenario tagged @smoke.
const onDev = ["clubspot", "gsuite"];

export default defineConfig({
  test: {
    include: local ? ["test/features/**/*.test.ts"] : onDev.map((name) => `test/features/${name}.test.ts`),
    // The steps wait on Directus, not the runner's CPU. On the CI stack, Directus is one Node process
    // beside the tests, so more workers only queue on it.
    maxWorkers: local ? Number(process.env["CI_STACK_WORKERS"] ?? 8) : 8,
    // On dev, a sync's step waits for it to reach the fakes through the cluster's API.
    testTimeout: local ? 3 * 60_000 : 15 * 60_000,
    hookTimeout: 60_000,
  },
});
