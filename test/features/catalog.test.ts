import { notBuilt } from "./steps/logins.ts";
import { describeAccessFeature, Step } from "./steps/index.ts";

for (const text of [
  "a product that runs a program",
  "they delete the product",
  "they're refused, and the product stays",
]) {
  Step(text, () => notBuilt("9"));
}

describeAccessFeature("catalog.feature");
