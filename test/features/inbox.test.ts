import { describeFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { newRunId } from "./cluster.ts";
import { canSignIn, deleteAuthentikUsers, newAuthentikUser } from "./inbox.ts";
import { deleteUsers } from "./steps/logins.ts";
import { deleteRows } from "./steps/rows.ts";
import { feature } from "./support.ts";

afterAll(async () => {
  await deleteAuthentikUsers();
  // Rows first: a person's row points at its user.
  const failures = [...(await deleteRows()), ...(await deleteUsers())];
  if (failures.length > 0) {
    throw new Error(`Couldn't clean up:\n${failures.join("\n")}`);
  }
}, 120_000);

describeFeature(feature("inbox.feature"), ({ Rule }) => {
  Rule("Only people allowed to use the shared inbox can sign in", ({ RuleScenario }) => {
    RuleScenario("A volunteer allowed to use the shared inbox can sign in", ({ Given, Then }) => {
      let user: number;
      Given("a volunteer allowed to use the shared inbox", async () => {
        user = await newAuthentikUser(newRunId(), true);
      });
      Then("they can sign in to the shared inbox", async () => {
        expect(await canSignIn(user)).toBe(true);
      });
    });

    RuleScenario("A parent who isn't allowed to use the shared inbox can't sign in", ({ Given, Then }) => {
      let user: number;
      Given("a parent who isn't allowed to use the shared inbox", async () => {
        user = await newAuthentikUser(newRunId(), false);
      });
      Then("they can't sign in to the shared inbox", async () => {
        expect(await canSignIn(user)).toBe(false);
      });
    });
  });
});
