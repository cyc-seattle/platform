import { notBuilt } from "./steps/logins.ts";
import { describeAccessFeature, Step } from "./steps/index.ts";

// Plans' own steps, which no other domain needs.
for (const text of [
  "{string} can start a plan for a product, with a draft",
  "{string} can save the draft as a version",
  "{string} can activate a saved version",
  "{string} can't move a draft's row into the saved version",
  "{string} can't make the saved version a draft again",
  "{string} can create, read, update, and delete {string} over MCP",
  "{string} can't change {string} over MCP",
]) {
  Step(text, () => notBuilt("11"));
}

describeAccessFeature("planning.feature");
