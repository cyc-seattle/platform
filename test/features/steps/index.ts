import { defineParameterExpression, defineSteps, describeFeature } from "@amiceli/vitest-cucumber";
import { afterAll, describe, expect, it } from "vitest";
import type { DirectusSession } from "../directus.ts";
import { devDirectusLicensed } from "../directus.ts";
import { feature } from "../support.ts";
import {
  deleteUsers,
  notBuilt,
  policyNames,
  roleNames,
  roleOf,
  roleId,
  serviceNames,
  setRole,
  todaysRoleName,
  userFor,
  type Actor,
} from "./logins.ts";
import {
  admin,
  adminCreate,
  change,
  created,
  deleteRows,
  fixture,
  itemPath,
  newRow,
  row,
  runRows,
  type Row,
} from "./rows.ts";
import { recordNames, targets, type Target } from "./sets.ts";

// The steps the features share: who "they" are, and what they can see and change. A feature's test
// file imports this, adds its own steps with `Step`, and calls `describeAccessFeature`.

type Callback = (...args: any[]) => unknown;

// Registered per keyword: vitest-cucumber 7.0.0 matches a keyword-free Step in a Scenario and a
// Background, but not in a Scenario Outline.
export function Step(text: string, fn: Callback): void {
  // A step may return what its helper did; vitest-cucumber ignores it.
  const step = fn as (...args: any[]) => void | Promise<void>;
  defineSteps(({ Given, When, Then, And, But }) => {
    for (const define of [Given, When, Then, And, But]) {
      define(text, step);
    }
  });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A parameter that takes one of `names`, or an outline's `<column>`, which the example fills in. */
export function parameter(name: string, names: string[]): void {
  const longestFirst = [...names].sort((a, b) => b.length - a.length).map(escape);
  defineParameterExpression({
    name,
    regexp: new RegExp(`(?:${longestFirst.join("|")}|<\\w+>)`),
    transformer: (value: string) => value,
  });
}

parameter("policy", policyNames);
parameter("role", roleNames);
parameter("service", serviceNames);
parameter("records", recordNames);

/** The session "they" sign in with, and their user's id. */
export interface They {
  session(): Promise<DirectusSession>;
  userId(): Promise<string>;
}

let they: They | undefined;

export function setThey(next: They): void {
  they = next;
}

function current(): They {
  if (they === undefined) {
    throw new Error("No Given has said who they are.");
  }
  return they;
}

const session = () => current().session();
export const theirSession = session;

const resets: (() => void)[] = [];

let refusal: (() => unknown) | undefined;

/** Records how to check that what the When just asked for was refused. */
export function expectRefusal(check: () => unknown): void {
  refusal = check;
}

for (const system of ["the CRM", "the catalog"]) {
  Step(`${system} doesn't allow it`, async () => {
    if (refusal === undefined) {
      throw new Error("No When has asked for anything.");
    }
    await refusal();
  });
}

/** Runs `reset` after each scenario, to clear what it left. */
export function onEachScenario(reset: () => void): void {
  resets.push(reset);
}

function actor(spec: Actor): They {
  return {
    session: async () => (await userFor(spec)).session,
    userId: async () => (await userFor(spec)).userId,
  };
}

Step("a user with the {policy} policy", (_, policy: string) => setThey(actor({ policies: [policy] })));
Step("a user with the {role} role", (_, role: string) => setThey(actor({ role })));
Step("a user with the {role} role and the {policy} policy", (_, role: string, policy: string) =>
  setThey(actor({ role, policies: [policy] })),
);
Step("{service}'s service account", (_, service: string) => setThey(actor({ service })));

const ACTIONS = ["create", "read", "update", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/** Each action in the features' own words. */
const WORDS: Record<Action, string> = { create: "add", read: "see", update: "edit", delete: "delete" };

/** "see", "see and edit", or "add, see, and edit". */
function phrase(actions: Action[], conjunction: string): string {
  const words = actions.map((action) => WORDS[action]);
  if (words.length < 3) {
    return words.join(` ${conjunction} `);
  }
  return `${words.slice(0, -1).join(", ")}, ${conjunction} ${words.at(-1)}`;
}

/** Every ordered, non-empty subset of the four actions. */
const subsets: Action[][] = Array.from({ length: 15 }, (_, i) => ACTIONS.filter((_, bit) => (i + 1) & (1 << bit)));

function rowIds(target: Target): string[] {
  return target.rows.map((key) => row[key]).filter((id) => id !== undefined);
}

function runRow(target: Target): string[] {
  const ids = rowIds(target);
  if (ids.length === 0) {
    throw new Error(`This run has no row in ${target.collection}.`);
  }
  return ids;
}

/** Reads the target's run's rows, or any one row where the run has none. */
function readQuery(target: Target, fields = "id"): string {
  const ids = rowIds(target);
  const filter = ids.length === 0 ? "&limit=1" : `&filter=${encodeURIComponent(JSON.stringify({ id: { _in: ids } }))}`;
  return `/items/${target.collection}?fields=${encodeURIComponent(fields)}${filter}`;
}

async function can(actions: Action[], target: Target): Promise<void> {
  await runRows();
  const user = await session();
  const { collection } = target;
  const has = (action: Action) => actions.includes(action);
  if (has("create")) {
    // The rest of the actions work on the row just created.
    const data = await newRow(collection);
    const id = data["id"];
    const create = await user.request("POST", `/items/${collection}`, data);
    if (create.status < 300) {
      created.push({ collection, id });
    }
    expect(create.status, `${collection} create: ${JSON.stringify(create.body)}`).toBe(200);
    if (has("read")) {
      const read = await user.request("GET", itemPath(collection, id));
      expect(read.status, `${collection} read: ${JSON.stringify(read.body)}`).toBe(200);
    }
    if (has("update")) {
      const update = await user.request("PATCH", itemPath(collection, id), change(collection));
      expect(update.status, `${collection} update: ${JSON.stringify(update.body)}`).toBe(200);
    }
    if (has("delete")) {
      const remove = await user.request("DELETE", itemPath(collection, id));
      expect(remove.status, `${collection} delete: ${JSON.stringify(remove.body)}`).toBe(204);
    }
    return;
  }
  if (has("read")) {
    const { status, body } = await user.request("GET", readQuery(target));
    expect(status, `${collection} read: ${JSON.stringify(body)}`).toBe(200);
    const ids = rowIds(target);
    if (ids.length > 0) {
      expect(body.data.map((item: Row) => item["id"]).sort(), `${collection} read`).toEqual([...ids].sort());
    }
  }
  if (has("update")) {
    for (const id of runRow(target)) {
      const { status, body } = await user.request("PATCH", itemPath(collection, id), change(collection));
      expect(status, `${collection} update: ${JSON.stringify(body)}`).toBe(200);
    }
  }
  if (has("delete")) {
    // A row of its own, so the run's row stays for the steps after.
    const item = await adminCreate(collection, await newRow(collection));
    const { status, body } = await user.request("DELETE", itemPath(collection, item.id));
    expect(status, `${collection} delete: ${JSON.stringify(body)}`).toBe(204);
  }
}

async function cant(actions: Action[], target: Target): Promise<void> {
  await runRows();
  const user = await session();
  const { collection } = target;
  for (const action of actions) {
    if (action === "create") {
      const data = await newRow(collection);
      const { status, body } = await user.request("POST", `/items/${collection}`, data);
      if (status < 300) {
        created.push({ collection, id: data["id"] });
      }
      expect(status, `${collection} create: ${JSON.stringify(body)}`).toBe(403);
    } else if (action === "read") {
      // A role whose rules match none of the run's rows reads an empty list, not a 403: Crew, say,
      // reading medical profiles through Community's own-family rule.
      const { status, body } = await user.request("GET", readQuery(target));
      if (status !== 403) {
        expect(status, `${collection} read: ${JSON.stringify(body)}`).toBe(200);
        expect(body.data, `${collection} read`).toEqual([]);
      }
    } else {
      for (const id of runRow(target)) {
        const method = action === "update" ? "PATCH" : "DELETE";
        const data = action === "update" ? change(collection) : undefined;
        const { status, body } = await user.request(method, itemPath(collection, id), data);
        expect(status, `${collection} ${action}: ${JSON.stringify(body)}`).toBe(403);
      }
    }
  }
}

const checks: [string, (records: string) => Promise<void>][] = [
  ...subsets.map((actions): [string, (records: string) => Promise<void>] => [
    `can ${phrase(actions, "and")}`,
    async (records) => {
      for (const target of targets(records)) {
        await can(actions, target);
      }
    },
  ]),
  ...[
    ...subsets.map((actions): [string, Action[]] => [phrase(actions, "or"), actions]),
    ["change", ["create", "update", "delete"]] as [string, Action[]],
  ].map(([text, actions]): [string, (records: string) => Promise<void>] => [
    `can't ${text}`,
    async (records) => {
      for (const target of targets(records)) {
        await cant(actions, target);
      }
    },
  ]),
  [
    "can change",
    async (records) => {
      for (const target of targets(records)) {
        await can([...ACTIONS], target);
      }
    },
  ],
];
for (const pronoun of ["they", "it"]) {
  for (const [text, check] of checks) {
    Step(`${pronoun} ${text} {records}`, (_, records: string) => check(records));
  }
}

Step("a plan with wages and bonus rates", () => runRows());
// No field-level hiding: a reader gets wages and bonus rates with the rest.
Step("they can see every part of the plan, wages and bonus rates included", () => readsEveryDetail());

async function readsEveryDetail(): Promise<void> {
  await runRows();
  const user = await session();
  for (const target of targets("plans")) {
    const { status, body } = await user.request("GET", readQuery(target, "*"));
    expect(status, `${target.collection}: ${JSON.stringify(body)}`).toBe(200);
    for (const key of target.rows) {
      const read = body.data.find((item: Row) => item["id"] === row[key]);
      expect(read, key).toEqual(fixture[key]);
    }
  }
}

/** Checks that "they" read exactly `allowed` of the run's row in `collection`, and no other field. */
export async function readOnly(collection: string, allowed: string[]): Promise<void> {
  await runRows();
  const user = await session();
  const target: Target = { collection, rows: [collection] };
  const all = await user.request("GET", readQuery(target, "*"));
  expect(all.status, JSON.stringify(all.body)).toBe(200);
  expect(Object.keys(all.body.data[0] ?? {}).sort()).toEqual([...allowed].sort());
  const others = Object.keys(fixture[collection] ?? {}).filter((field) => !allowed.includes(field));
  const denied = await user.request("GET", readQuery(target, others.join(",")));
  expect(denied.status, JSON.stringify(denied.body)).toBe(403);
}

/** Checks that "they" can set `field` on the run's row in `collection`, to the value it already has. */
export async function canSet(collection: string, field: string): Promise<void> {
  await runRows();
  const { status, body } = await (
    await session()
  ).request("PATCH", itemPath(collection, row[collection]), { [field]: fixture[collection]?.[field] });
  expect(status, JSON.stringify(body)).toBe(200);
}

Step("they can open the Data Studio", async () => {
  const globals = await (await session()).ok("GET", "/policies/me/globals");
  expect(globals.app_access).toBe(true);
});

for (const text of ["they have the {role} role", "they still have the {role} role"]) {
  Step(text, async (_, role: string) => {
    expect(await roleOf(await current().userId())).toBe(todaysRoleName(role));
  });
}

let signedIn: { id: string; directus_user_id: { role: { name: string } | null } | null }[] = [];
Step("the people in the CRM who have signed in", () => runRows());
Step("an admin looks up their roles", async () => {
  const filter = encodeURIComponent(JSON.stringify({ directus_user_id: { _nnull: true } }));
  signedIn = await (
    await admin()
  ).ok("GET", `/items/people?filter=${filter}&fields=id,directus_user_id.role.name&limit=-1`);
});
Step("each of them has the Community, Crew, or Admin role", () => {
  for (const { id, directus_user_id: user } of signedIn) {
    expect(["Community", "Crew", "Admin"].map(todaysRoleName), `person ${id}`).toContain(user?.role?.name);
  }
});

Step("an admin gives them the {role} role", async (_, role: string) => {
  await setRole(await current().userId(), role);
});

Step("they can't change anyone's role, even their own", async () => {
  const user = await session();
  const someone = await userFor({ role: "Community" });
  const adminRole = await roleId("Administrator");
  for (const [userId, path] of [
    [await current().userId(), "/users/me"],
    [someone.userId, `/users/${someone.userId}`],
  ] as const) {
    const before = await roleOf(userId);
    await user.request("PATCH", path, { role: adminRole });
    expect(await roleOf(userId), path).toBe(before);
  }
});

// Groups, and a first sign-in through the club's single sign-on, come with step 8a.
for (const text of [
  "a person in the CRM who has never signed in",
  "a person in the CRM who has never signed in, in a group that gives the {policy} policy",
  "a user in a group that gives the {policy} policy",
  "a user in two groups that each give the {policy} policy",
  "they sign in for the first time",
  "they sign in again",
  "an admin adds them to a group that gives the {policy} policy",
  "an admin takes them out of the group",
  "an admin takes them out of one of the groups",
  "an admin changes the group so it no longer gives that policy",
  "the first admin account",
  "an admin adds it to a group that gives the {policy} policy",
]) {
  Step(text, () => notBuilt("8a"));
}

/** A scenario's own steps, for one whose steps no other feature shares. */
export type ScenarioSteps = (steps: Record<"Given" | "When" | "Then" | "And" | "But", Callback>) => void;

interface Declarable {
  description: string;
  examples?: unknown;
}

/**
 * Describes a feature on the shared steps, plus any scenario's own, declaring every scenario,
 * pending ones included, so a typo in a pending scenario's step fails the run too. Deletes the run's
 * rows and users after.
 */
export function describeAccessFeature(name: string, ownSteps: Record<string, ScenarioSteps> = {}): void {
  const parsed = feature(name);
  if (parsed.tags.has("licensed") && !devDirectusLicensed()) {
    describe.skip(`Feature: ${parsed.name}`, () => {
      it("is skipped: dev's Directus is unlicensed (backend:licensed is false in stacks/backend/Pulumi.dev.yaml)", () => {});
    });
    return;
  }

  // vitest-cucumber runs AfterAllScenarios after each Rule, so cleanup waits for the whole file.
  afterAll(async () => {
    // Rows first: a person's row points at its user.
    const failures = [...(await deleteRows()), ...(await deleteUsers())];
    if (failures.length > 0) {
      throw new Error(`Couldn't clean up:\n${failures.join("\n")}`);
    }
    // One request per row, and the family examples make hundreds.
  }, 300_000);

  describeFeature(
    parsed,
    ({ AfterEachScenario, Background, Rule, Scenario, ScenarioOutline }) => {
      // After, not before: a Background runs ahead of BeforeEachScenario.
      AfterEachScenario(() => {
        they = undefined;
        refusal = undefined;
        for (const reset of resets) {
          reset();
        }
      });
      if (parsed.background) {
        Background(() => {});
      }
      const declare = (list: readonly Declarable[], scenario: typeof Scenario, outline: typeof ScenarioOutline) => {
        for (const each of list) {
          if ("examples" in each) {
            outline(each.description, () => {});
          } else {
            scenario(each.description, (ownSteps[each.description] ?? (() => {})) as Parameters<typeof Scenario>[1]);
          }
        }
      };
      declare(parsed.scenarii, Scenario, ScenarioOutline);
      for (const rule of parsed.rules) {
        Rule(rule.name, ({ RuleBackground, RuleScenario, RuleScenarioOutline }) => {
          if (rule.background) {
            RuleBackground(() => {});
          }
          declare(rule.scenarii, RuleScenario as typeof Scenario, RuleScenarioOutline as typeof ScenarioOutline);
        });
      }
    },
    { excludeTags: ["pending"] },
  );
}
