import { describeAccessFeature, Step } from "./steps/index.ts";
import { notBuilt } from "./steps/logins.ts";

// The hook that moves families between Community and Team (cyc-seattle/workplace#6 decision 27).
for (const text of [
  "their child signs up for a team",
  "they sign up for a team",
  "their child's last time on a team ended a month ago",
  "their child's last time on a team ended 13 months ago",
]) {
  Step(text, () => notBuilt("17"));
}

describeAccessFeature("authorization.feature");
