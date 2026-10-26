import { describeFeature } from "@amiceli/vitest-cucumber";
import { feature } from "./support.ts";

// The planning model's permissions, written before the collections and policies exist
// (cyc-seattle/workplace#6 step 8). Every scenario is `@pending`, so the steps are stubs: steps 9 to 12
// fill them in, as directus-roles.test.ts does for today's roles, and drop the tag.

const pending = () => {
  throw new Error("Not built yet: cyc-seattle/workplace#6 steps 9 to 12 build this step.");
};

describeFeature(
  feature("planning-roles.feature"),
  ({ Background, defineSteps, Scenario, ScenarioOutline }) => {
    defineSteps(({ Given, When, Then, And }) => {
      // Registered per keyword: vitest-cucumber 7.0.0 matches a keyword-free Step in a Scenario but
      // not in a Scenario Outline.
      const Step = (text: string) => {
        for (const define of [Given, When, Then, And]) {
          define(text, pending);
        }
      };

      for (const text of [
        "this run's users, catalog, and plans on dev's Directus",
        "{string} can create, read, update, and delete {string}",
        "{string} reads {string}",
        "{string} reads the catalog",
        "{string} can't change the catalog",
        "{string} can start a plan for a product, with a draft",
        "{string} can create, read, update, and delete the draft's rows",
        "{string} reads the saved version's rows",
        "{string} can't create, update, or delete the saved version's rows",
        "{string} can't move a draft's row into the saved version",
        "{string} can't make the saved version a draft again",
        "{string} can archive a plan",
        "{string} can't delete a plan or a version",
        "{string} can activate a version",
        "{string} can't activate a version",
        "{string} can freeze a baseline",
        "{string} can't freeze a baseline",
        "{string} reads {string} of {string}",
        "{string} can't read {string} of {string}",
        "{string} reads the rest of {string}",
        "{string} can set {string} on the draft's {string}",
        "{string} can't set {string} on the draft's {string}",
        "{string} can't set {string} on the saved version's {string}",
        "{string} reads every plan's draft and saved versions",
        "{string} reads every plan's draft and saved versions, with wages and bonus rates",
        "{string} can't change any plan",
        "{string} reads the results",
        "{string} can't read the results",
        "{string} can't change the results",
        "{string} can't read the CRM, Clubspot's records, or the syncs' records",
        "{string} can't read the catalog, any plan, or the results",
        "{string} can't read any plan, or the results",
      ]) {
        Step(text);
      }
    });

    Background(() => {});

    for (const outline of [
      "Staff keep the catalog, as Catalog editors",
      "Only Finance reads wages and bonus rates",
      "Only the engine writes results",
      "Coaches, families, community members, and clubspot-sync see no catalog, plans, or results",
    ]) {
      ScenarioOutline(outline, () => {});
    }
    for (const scenario of [
      "A planner reads the catalog, but only staff change it",
      "A planner starts a plan for a product, with a draft",
      "A planner edits every part of a draft, including one someone else started",
      "A saved version can't be changed",
      "A planner archives a plan, but deletes no plan or version",
      "Only Finance activates a version or freezes a baseline",
      "Only Finance sets wages and bonus rates, and only in a draft",
      "Staff without Planner read plans, but change nothing",
      "Planners and Finance read the engine's results, and other staff don't",
      "The engine replaces a plan's results",
      "The engine reads the catalog and every plan, wages included, and changes none of it",
      "The engine reads nothing about people",
      "gsuite-sync reads products and their revenue accounts, and no plans or results",
    ]) {
      Scenario(scenario, () => {});
    }
  },
  { excludeTags: ["pending"] },
);
