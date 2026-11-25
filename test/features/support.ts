import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFeatureFromText } from "@amiceli/vitest-cucumber";

export function feature(name: string): ReturnType<typeof loadFeatureFromText> {
  return loadFeatureFromText(readFileSync(join(import.meta.dirname, "../../features", name), "utf8"));
}
