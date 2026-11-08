import { describeAccessFeature, Step } from "./steps/index.ts";

// Tracking, which the next platform PRs build: until then, each of these steps fails.
for (const text of [
  "two saved Financial Plans for next year, {string} and {string}",
  "{string} is active",
  "they mark {string} active",
  "{string} is next year's active Financial Plan",
  "{string} is saved, and no longer active",
  "a draft Financial Plan for next year",
  "they try to mark it active",
  "they're told that only a saved Financial Plan can be active",
  "a catalog offering {string}",
  "three Clubspot offerings of Guppies, for weeks 1, 2, and 3",
  "they link all three to {string}",
  "tracking counts all three Clubspot offerings under {string}",
  "{string} plans {string} at {money} a sailor and is active",
  "{string} plans {string} at {money} a sailor",
  "{string} is marked active",
  "tracking counts the Clubspot offering under {string}, planned at {money} a sailor",
  "a Clubspot offering linked to {string}, with {int} confirmed sailors",
  "an active Financial Plan that doesn't include {string}",
  "{string} is listed as not planned, with its {int} sailors",
  "an active Financial Plan that expects {int} sailors in {string}",
  "a Clubspot offering linked to it, with {int} confirmed sailors, {int} on the waitlist, and {int} cancelled",
  "a planner looks at tracking for the program area",
  "{string} shows {int} sailors registered of {int} planned",
  "an active Financial Plan that expects {int} sailors in {string} at {money} a sailor",
  "a Clubspot offering linked to it, where families have paid {money} and been refunded {money}",
  "{string} shows {money} collected of {money} planned",
  "an active Financial Plan with {string} at {money} a sailor and {string} at {money} a sailor",
  "a family who paid {money} once for a Clubspot offering of each",
  "{string} shows {money} collected from that payment",
  "an active Financial Plan for the program area",
  "a Clubspot offering of one of its programs, with {int} confirmed sailors and no link",
  "the Clubspot offering is listed as not in the plan, with its {int} sailors",
  "a Clubspot offering linked to {string}",
  "its session is archived in Clubspot",
  "the Clubspot sync runs again",
  "the Clubspot offering is still linked to {string}, marked archived",
  "they can see tracking for a program area, money collected included",
  "they can't link a Clubspot offering to a catalog offering",
  "they can't mark a Financial Plan active",
  "they can't see tracking for a program area",
  "they can't see what families have paid",
]) {
  Step(text, () => {
    throw new Error("Not built yet: tracking");
  });
}

describeAccessFeature("tracking.feature");
