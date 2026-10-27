import { notBuilt } from "./steps/logins.ts";
import { describeAccessFeature, Step } from "./steps/index.ts";

for (const text of [
  "they start a plan for a product",
  "the plan has a draft they can change",
  "the plan has no saved versions yet",
  "a plan with two saved versions, the first of them active",
  "they make the second version active",
  "only the second version is active",
  "a plan someone else started",
  "they can save the draft as a version",
  "they can make a saved version active",
  "they can't move anything from the draft into a saved version",
  "they can't turn a saved version back into a draft",
]) {
  Step(text, () => notBuilt("11"));
}

describeAccessFeature("planning.feature");
