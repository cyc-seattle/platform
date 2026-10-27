import { defineSteps, describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { feature } from "../support.ts";
import { as, deleteUsers, notBuilt, person, roleId, roleOf, setRole, userId } from "./logins.ts";
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
import { targets, type Target } from "./sets.ts";

// The steps the access features share, registered once for every feature a test file describes. A
// domain's test file imports this, adds its own steps with `defineSteps`, and calls
// `describeAccessFeature`.

type Callback = (...args: any[]) => void | Promise<void>;

// Registered per keyword: vitest-cucumber 7.0.0 matches a keyword-free Step in a Scenario and a
// Background, but not in a Scenario Outline.
export function Step(text: string, fn: Callback): void {
  defineSteps(({ Given, When, Then, And }) => {
    for (const define of [Given, When, Then, And]) {
      define(text, fn);
    }
  });
}

const ACTIONS = ["create", "read", "update", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/** "read", "read and update", or "create, read, and update". */
function phrase(actions: Action[], conjunction: string): string {
  if (actions.length < 3) {
    return actions.join(` ${conjunction} `);
  }
  return `${actions.slice(0, -1).join(", ")}, ${conjunction} ${actions.at(-1)}`;
}

/** Every ordered, non-empty subset of the four actions. */
const subsets: Action[][] = Array.from({ length: 15 }, (_, i) => ACTIONS.filter((_, bit) => (i + 1) & (1 << bit)));

const list = (names: string) => names.split(",").map((name) => name.trim());

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

async function can(login: string, actions: Action[], target: Target): Promise<void> {
  const session = await as(login);
  const { collection } = target;
  const has = (action: Action) => actions.includes(action);
  if (has("create")) {
    // The rest of the actions work on the row just created.
    const data = await newRow(collection);
    const id = data["id"];
    const create = await session.request("POST", `/items/${collection}`, data);
    if (create.status < 300) {
      created.push({ collection, id });
    }
    expect(create.status, `${collection} create: ${JSON.stringify(create.body)}`).toBe(200);
    if (has("read")) {
      const read = await session.request("GET", itemPath(collection, id));
      expect(read.status, `${collection} read: ${JSON.stringify(read.body)}`).toBe(200);
    }
    if (has("update")) {
      const update = await session.request("PATCH", itemPath(collection, id), change(collection));
      expect(update.status, `${collection} update: ${JSON.stringify(update.body)}`).toBe(200);
    }
    if (has("delete")) {
      const remove = await session.request("DELETE", itemPath(collection, id));
      expect(remove.status, `${collection} delete: ${JSON.stringify(remove.body)}`).toBe(204);
    }
    return;
  }
  if (has("read")) {
    const { status, body } = await session.request("GET", readQuery(target));
    expect(status, `${collection} read: ${JSON.stringify(body)}`).toBe(200);
    const ids = rowIds(target);
    if (ids.length > 0) {
      expect(body.data.map((item: Row) => item["id"]).sort(), `${collection} read`).toEqual([...ids].sort());
    }
  }
  if (has("update")) {
    for (const id of runRow(target)) {
      const { status, body } = await session.request("PATCH", itemPath(collection, id), change(collection));
      expect(status, `${collection} update: ${JSON.stringify(body)}`).toBe(200);
    }
  }
  if (has("delete")) {
    // A row of its own, so the run's row stays for the steps after.
    const item = await adminCreate(collection, await newRow(collection));
    const { status, body } = await session.request("DELETE", itemPath(collection, item.id));
    expect(status, `${collection} delete: ${JSON.stringify(body)}`).toBe(204);
  }
}

async function cant(login: string, actions: Action[], target: Target): Promise<void> {
  const session = await as(login);
  const { collection } = target;
  for (const action of actions) {
    if (action === "create") {
      const data = await newRow(collection);
      const { status, body } = await session.request("POST", `/items/${collection}`, data);
      if (status < 300) {
        created.push({ collection, id: data["id"] });
      }
      expect(status, `${collection} create: ${JSON.stringify(body)}`).toBe(403);
    } else if (action === "read") {
      // A role whose rules match none of the run's rows reads an empty list, not a 403: Crew, say,
      // reading medical profiles through Community's own-child rule.
      const { status, body } = await session.request("GET", readQuery(target));
      if (status !== 403) {
        expect(status, `${collection} read: ${JSON.stringify(body)}`).toBe(200);
        expect(body.data, `${collection} read`).toEqual([]);
      }
    } else {
      for (const id of runRow(target)) {
        const method = action === "update" ? "PATCH" : "DELETE";
        const data = action === "update" ? change(collection) : undefined;
        const { status, body } = await session.request(method, itemPath(collection, id), data);
        expect(status, `${collection} ${action}: ${JSON.stringify(body)}`).toBe(403);
      }
    }
  }
}

Step("this run's users and rows on dev's Directus", async () => {
  await runRows();
});

for (const actions of subsets) {
  Step(`{string} can ${phrase(actions, "and")} {string}`, async (_, login: string, target: string) => {
    for (const each of targets(target)) {
      await can(login, actions, each);
    }
  });
}
const negatives: [string, Action[]][] = [
  ...subsets.map((actions): [string, Action[]] => [phrase(actions, "or"), actions]),
  ["change", ["create", "update", "delete"]],
];
for (const [text, actions] of negatives) {
  Step(`{string} can't ${text} {string}`, async (_, login: string, target: string) => {
    for (const each of targets(target)) {
      await cant(login, actions, each);
    }
  });
}

// No field-level hiding: a reader gets wages and bonus rates with the rest.
Step("{string} can read every field of {string}", async (_, login: string, target: string) => {
  const session = await as(login);
  for (const each of targets(target)) {
    const { status, body } = await session.request("GET", readQuery(each, "*"));
    expect(status, `${each.collection}: ${JSON.stringify(body)}`).toBe(200);
    for (const key of each.rows) {
      const read = body.data.find((item: Row) => item["id"] === row[key]);
      expect(read, key).toEqual(fixture[key]);
    }
  }
});

Step("{string} can read only {string} of {string}", async (_, login: string, fields: string, collection: string) => {
  const session = await as(login);
  const [target] = targets(collection) as [Target];
  const allowed = list(fields);
  const all = await session.request("GET", readQuery(target, "*"));
  expect(all.status, JSON.stringify(all.body)).toBe(200);
  expect(Object.keys(all.body.data[0] ?? {}).sort()).toEqual([...allowed].sort());
  const others = Object.keys(fixture[collection] ?? {}).filter((field) => !allowed.includes(field));
  const denied = await session.request("GET", readQuery(target, others.join(",")));
  expect(denied.status, JSON.stringify(denied.body)).toBe(403);
});

Step("{string} can set {string} on {string}", async (_, login: string, field: string, collection: string) => {
  // The value it already has, so the run's row is unchanged.
  const { status, body } = await (
    await as(login)
  ).request("PATCH", itemPath(collection, row[collection]), { [field]: fixture[collection]?.[field] });
  expect(status, JSON.stringify(body)).toBe(200);
});

Step("{string} can sign in to the Data Studio", async (_, login: string) => {
  const globals = await (await as(login)).ok("GET", "/policies/me/globals");
  expect(globals.app_access).toBe(true);
});

Step("{string} holds the {string} role", async (_, login: string, role: string) => {
  expect(await roleOf(login)).toBe(role);
});

Step("every person's user holds one of {string}", async (_, roles: string) => {
  const filter = encodeURIComponent(JSON.stringify({ directus_user_id: { _nnull: true } }));
  const people = await (
    await admin()
  ).ok("GET", `/items/people?filter=${filter}&fields=id,directus_user_id.role.name&limit=-1`);
  for (const { id, directus_user_id: user } of people) {
    expect(list(roles), `person ${id}`).toContain(user?.role?.name);
  }
});

Step("{string} is a person with no login", async (_, name: string) => {
  await person(name, undefined);
});

Step("{string} is a person with a login", async (_, name: string) => {
  await person(name, "Community");
});

Step("{string} is a person on the {string} role", async (_, name: string, role: string) => {
  await person(name, role);
});

Step("{string} is the run's child's guardian, on the {string} role", async (_, name: string, role: string) => {
  const { personId } = await person(name, role);
  await adminCreate("contacts", await newRow("contacts", { contact_id: personId, relationship_type: "guardian" }));
});

Step("an admin gives {string} the {string} role", async (_, name: string, role: string) => {
  await setRole(name, role);
});

Step("{string} can't change a user's role, their own included", async (_, login: string) => {
  const session = await as(login);
  const someone = `Someone ${login}`;
  await person(someone, "Community");
  const adminRole = await roleId("Administrator");
  for (const [name, path] of [
    [login, "/users/me"],
    [someone, `/users/${await userId(someone)}`],
  ] as const) {
    const before = await roleOf(name);
    await session.request("PATCH", path, { role: adminRole });
    expect(await roleOf(name), name).toBe(before);
  }
});

for (const text of [
  "{string} is in a group that grants {string}",
  "{string} is in two groups that grant {string}",
  "{string} is a person with no login, in a group that grants {string}",
  "an admin adds {string} to a group that grants {string}",
  "an admin removes {string} from the group",
  "an admin removes {string} from one of them",
  "an admin drops {string} from the group",
  "{string} signs in for the first time",
  "{string} signs in again",
  "{string} keeps its role and policies",
]) {
  Step(text, () => notBuilt("8a"));
}

/** Describes an access feature with the shared steps, and deletes the run's rows and users after. */
export function describeAccessFeature(name: string): void {
  const parsed = feature(name);
  describeFeature(
    parsed,
    ({ Background, AfterAllScenarios, Scenario, ScenarioOutline }) => {
      AfterAllScenarios(async () => {
        // Rows first: a person's row points at its user.
        const failures = [...(await deleteRows()), ...(await deleteUsers())];
        if (failures.length > 0) {
          throw new Error(`Couldn't clean up:\n${failures.join("\n")}`);
        }
      });

      Background(() => {});

      // Every scenario, pending or not, so a step a pending one names must exist.
      for (const scenario of parsed.scenarii) {
        if ("examples" in scenario) {
          ScenarioOutline(scenario.description, () => {});
        } else {
          Scenario(scenario.description, () => {});
        }
      }
    },
    { excludeTags: ["pending"] },
  );
}
