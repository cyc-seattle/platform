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
        "this run's people, groups, catalog, and plans on dev's Directus",
        "{string} reads {string}",
        "{string} can't create, update, or delete {string}",
        "{string} can create, read, update, and delete {string}",
        "{string} reads every plan's draft and saved versions, with wages and bonus rates",
        "{string} reads the results",
        "{string} can't change any plan",
        "{string} can't change the results",
        "{string} can start a plan for a product, with a draft",
        "{string} can create, read, update, and delete the draft's rows",
        "{string} can save the draft as a version",
        "{string} can activate a saved version",
        "{string} can't read the catalog",
        "{string} can't read any plan, or the results",
        "{string} reads the saved version's rows",
        "{string} can't create, update, or delete the saved version's rows",
        "{string} can't move a draft's row into the saved version",
        "{string} can't make the saved version a draft again",
        "{string} can sign in to the Data Studio",
        "{string} can edit the draft's rows over MCP",
        "{string} can't change the saved version's rows over MCP",
        "{string} can't change any plan over MCP",
        "a person in no group",
        "an admin adds them to a group that grants {string}",
        "they read every plan's draft and saved versions",
        "a person in a group that grants {string}",
        "an admin removes them from the group",
        "they can't read any plan, or the results",
        "an admin drops {string} from the group",
        "a person in two groups that grant {string}",
        "an admin removes them from one of the groups",
        "a community member in a group that grants {string}",
        "they read their teammates, as Community does",
        "a person with no login, in a group that grants {string}",
        "they sign in for the first time",
        "{string} reads the catalog",
        "{string} can't change the catalog",
        "{string} can't read the catalog, any plan, or the results",
        "{string} can't read the CRM, Clubspot's records, the syncs' records, or groups",
      ]) {
        Step(text);
      }
    });

    Background(() => {});

    for (const outline of [
      "Catalog Reader reads the catalog, and changes nothing",
      "Catalog Writer keeps the catalog",
      "Nobody changes a saved version, not even an admin",
      "Each policy opens the Data Studio",
      "Only an admin manages groups, their members, and their grants",
      "Coaches, guardians, and community members in no planning group see no catalog, plans, or results",
    ]) {
      ScenarioOutline(outline, () => {});
    }
    for (const scenario of [
      "Plan Reader reads every plan and its results, wages and bonus rates included",
      "Plan Reader changes nothing",
      "Plan Writer reads everything Plan Reader does",
      "Plan Writer starts a plan for a product, with a draft",
      "Plan Writer edits any plan's draft, including one someone else started",
      "Plan Writer saves a draft as a version, and activates it",
      "Plan Writer doesn't write results",
      "The plan policies don't reach the catalog, and the catalog policies don't reach plans",
      "MCP reaches what the REST API does, and no more",
      "Joining a group grants its policies",
      "Leaving a group takes its policies away",
      "Dropping a group's grant takes it from every member",
      "A policy two groups grant stays until both drop it",
      "A community member in a group keeps what Community gives them",
      "A person added before their first sign-in gets the group's policies once they sign in",
      "Staff in no planning group read the catalog, and see no plans",
      "The engine writes results and metrics",
      "The engine reads the catalog and every plan, wages included, and changes none of it",
      "The engine reads nothing about people",
      "clubspot-sync sees no catalog, plans, or results",
      "gsuite-sync reads products and their revenue accounts, and no plans or results",
    ]) {
      Scenario(scenario, () => {});
    }
  },
  { excludeTags: ["pending"] },
);
