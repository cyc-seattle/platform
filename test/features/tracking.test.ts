import { describeAccessFeature, Step } from "./steps/index.ts";

// Tracking, which the next platform PRs build: until then, each of these steps fails.
for (const text of [
  "a catalog offering {string}",
  "three Clubspot offerings of Guppies, for weeks 1, 2, and 3",
  "they link all three to {string}",
  "tracking counts all three Clubspot offerings under {string}",
  "{string} plans {string} at {money} a sailor and is in force",
  "{string} plans {string} at {money} a sailor",
  "{string} comes into force",
  "tracking counts the Clubspot offering under {string}, planned at {money} a sailor",
  "a Clubspot offering linked to {string}, with {int} confirmed sailors",
  "a Financial Plan in force that doesn't include {string}",
  "{string} is listed as not planned, with its {int} sailors",
  "a Financial Plan in force that expects {int} sailors in {string}",
  "a Clubspot offering linked to it, with {int} confirmed sailors, {int} on the waitlist, and {int} cancelled",
  "a planner looks at tracking for the program area",
  "{string} shows {int} sailors registered of {int} planned",
  "a Financial Plan in force that expects {int} sailors in {string} at {money} a sailor",
  "a Clubspot offering linked to it, where families have paid {money} and been refunded {money}",
  "{string} shows {money} collected of {money} planned",
  "a Financial Plan in force with {string} at {money} a sailor and {string} at {money} a sailor",
  "a family who paid {money} once for a Clubspot offering of each",
  "{string} shows {money} collected from that payment",
  "a Financial Plan in force for the program area",
  "a Clubspot offering of one of its programs, with {int} confirmed sailors and no link",
  "the Clubspot offering is listed as not in the plan, with its {int} sailors",
  "a Clubspot offering linked to {string}",
  "its session is archived in Clubspot",
  "the Clubspot sync runs again",
  "the Clubspot offering is still linked to {string}, marked archived",
  "they can see tracking for a program area, money collected included",
  "they can't link a Clubspot offering to a catalog offering",
  "they can't make a Financial Plan active",
  "they can't see tracking for a program area",
  "they can't see what families have paid",
]) {
  Step(text, () => {
    throw new Error("Not built yet: tracking");
  });
}

describeAccessFeature("tracking.feature");
