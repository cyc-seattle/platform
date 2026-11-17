import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { describeAccessFeature, onEachScenario, setThey, Step, them } from "./steps/index.ts";
import {
  addToGroup,
  createUser,
  forget,
  hasPolicies,
  linkLogin,
  newGroup,
  newPerson,
  userFor,
  type User,
} from "./steps/logins.ts";
import { adminCreate, email } from "./steps/rows.ts";
import { onATeam, type Season } from "./steps/teams.ts";

// The hook that moves families between Community and Team (cyc-seattle/workplace#6 decision 27).

/**
 * Gives the signed-in user a family of their own, in place of the one they had: `family` makes the
 * person, and their login moves to it once it's made, so the hook never sees them half made. The
 * scenario changes a shared actor's family, so later scenarios get one of their own.
 */
async function aFamilyOfTheirOwn(family: (personId: string) => Promise<void>): Promise<void> {
  const they = them();
  const userId = await they.userId();
  if (they.actor !== undefined) {
    const user = await userFor(they.actor);
    forget(they.actor);
    setThey({ session: async () => user.session, userId: async () => user.userId });
  }
  const personId = await newPerson({ date_of_birth: "1980-01-01" });
  await family(personId);
  await linkLogin(userId, personId);
}

const theirChildOnATeam = (season: Season) =>
  aFamilyOfTheirOwn(async (parentId) => {
    const childId = await newPerson({ date_of_birth: "2014-01-01" });
    await adminCreate("contacts", { subject_id: childId, contact_id: parentId, relationship_type: "guardian" });
    await onATeam(childId, season);
  });

Step("their child signs up for a team", () => theirChildOnATeam("running"));
Step("they sign up for a team", () => aFamilyOfTheirOwn((personId) => onATeam(personId)));
Step("their child's last time on a team ended a month ago", () => theirChildOnATeam("ended"));
Step("their child's last time on a team ended 13 months ago", () => theirChildOnATeam("lapsed"));

// A person who signs in with two emails (cyc-seattle/platform#329).

let logins: User[] = [];
let family: string[] = [];
let seen: string[][] = [];
onEachScenario(() => {
  logins = [];
  family = [];
  seen = [];
});

async function twoLogins(personId: string): Promise<void> {
  logins = [await createUser(email("first"), "Community"), await createUser(email("second"), "Community")];
  for (const login of logins) {
    await linkLogin(login.userId, personId);
  }
}

Step("a person who signs in with two emails, with a child in their household", async () => {
  const { id: household_id } = await adminCreate("households", { id: randomUUID() });
  const personId = await newPerson({ date_of_birth: "1980-01-01", household_id });
  family = [personId, await newPerson({ date_of_birth: "2014-01-01", household_id })];
  await twoLogins(personId);
});
Step("they look up the people they can see with each email", async () => {
  seen = [];
  for (const login of logins) {
    const rows = await login.session.ok("GET", "/items/people?fields=id&limit=-1");
    seen.push(rows.map(({ id }: { id: string }) => id).sort());
  }
});
Step("each email shows themselves and their child, and no one else", () => {
  expect(seen).toEqual(logins.map(() => [...family].sort()));
});

Step("a person who signs in with two emails, in a group that gives the {policy} policy", async (_, policy: string) => {
  const personId = await newPerson();
  await twoLogins(personId);
  const { groupId } = await newGroup(policy);
  await addToGroup(groupId, personId);
  await hasPolicies(logins[0]!.userId, [policy]);
});
Step("they sign in with their second email", () => {
  const login = logins[1]!;
  setThey({ session: async () => login.session, userId: async () => login.userId });
});
Step("both of their logins have the {policy} policy", async (_, policy: string) => {
  for (const login of logins) {
    await hasPolicies(login.userId, [policy]);
  }
});

describeAccessFeature("authorization.feature");
