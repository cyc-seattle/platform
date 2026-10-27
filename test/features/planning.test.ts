import { notBuilt } from "./steps/logins.ts";
import { describeAccessFeature, Step } from "./steps/index.ts";

for (const text of [
  "they start a plan for a product",
  "the plan has a draft they can edit",
  "a plan someone else started",
  "they can save the draft as a version",
  "they can make a saved version active",
  "they can't move a row from the draft into a saved version",
  "they can't make a saved version a draft again",
]) {
  Step(text, () => notBuilt("11"));
}

describeAccessFeature("planning.feature");
