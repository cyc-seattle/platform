import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFeatureFromText } from "@amiceli/vitest-cucumber";
import "../features/crew.ts";
import "../features/crm.ts";
import "../features/planning.ts";
import { describeParsedFeature } from "../features/steps/index.ts";

// Run by scripts/ci-seed.ts, never by the integration tests.
describeParsedFeature(loadFeatureFromText(readFileSync(join(import.meta.dirname, "sample-data.feature"), "utf8")), {
  keep: true,
});
