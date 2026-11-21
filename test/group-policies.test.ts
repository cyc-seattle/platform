import { describe, expect, it } from "vitest";
import {
  applyMoves,
  coalesce,
  groupChanges,
  plan,
  renames,
  signInMembers,
  syncAuthentik,
  teamMoves,
} from "../stacks/backend/group-policies.cjs";

const login = (id: string, email: string | null, person_id: string | null = null) => ({ id, email, person_id });
const once = { emailCounts: { "crew@example.com": 1, "new@example.com": 1 }, linkedPeople: [] };

describe("the group-policies hook's plan", () => {
  it("gives a member each policy their groups give, once", () => {
    const { add, remove } = plan({
      users: [login("u-crew", "crew@example.com", "p-crew")],
      people: [{ id: "p-crew", email: "crew@example.com" }],
      grants: [
        { person_id: "p-crew", policy_id: "writer" },
        { person_id: "p-crew", policy_id: "writer" },
        { person_id: "p-crew", policy_id: "medical" },
      ],
      links: [],
      ...once,
    });
    expect(add).toEqual([
      { user: "u-crew", policy: "writer" },
      { user: "u-crew", policy: "medical" },
    ]);
    expect(remove).toEqual([]);
  });

  it("gives each of a person's logins the policies their groups give", () => {
    const { add, remove } = plan({
      users: [
        login("u-gmail", "alex@gmail.example", "p-alex"),
        login("u-work", "alex@work.example", "p-alex"),
        login("u-other", "other@example.com", "p-other"),
      ],
      people: [
        { id: "p-alex", email: "alex@gmail.example" },
        { id: "p-other", email: "other@example.com" },
      ],
      grants: [{ person_id: "p-alex", policy_id: "writer" }],
      links: [{ id: "a1", user: "u-gmail", policy: "writer" }],
      emailCounts: {},
      linkedPeople: [],
    });
    expect(add).toEqual([{ user: "u-work", policy: "writer" }]);
    expect(remove).toEqual([]);
  });

  it("links a login to the person added before they first signed in, by their email, in any case", () => {
    const { add, link, personOf } = plan({
      users: [login("u-new", "new@example.com")],
      people: [{ id: "p-new", email: "New@Example.com" }],
      grants: [{ person_id: "p-new", policy_id: "writer" }],
      links: [],
      ...once,
    });
    expect(link).toEqual([{ person: "p-new", user: "u-new" }]);
    expect(add).toEqual([{ user: "u-new", policy: "writer" }]);
    expect(personOf).toEqual(new Map([["u-new", "p-new"]]));
  });

  // Someone who can change a person's email could give it the address they sign in with, and take
  // the person's access. Only an admin links a second login.
  it("never links a login by email to a person who already has one, and says why", () => {
    const { add, link, unlinked } = plan({
      users: [login("u-staff", "crew@example.com", "p-staff"), login("u-stranger", "new@example.com")],
      people: [{ id: "p-staff", email: "new@example.com" }],
      grants: [{ person_id: "p-staff", policy_id: "writer" }],
      links: [{ id: "a1", user: "u-staff", policy: "writer" }],
      ...once,
    });
    expect(link).toEqual([]);
    expect(add).toEqual([]);
    expect(unlinked).toEqual([{ user: "u-stranger", reason: expect.stringContaining("already has a login") }]);
  });

  it("never links a login by email to a person whose only login it doesn't manage", () => {
    const { link } = plan({
      users: [login("u-stranger", "new@example.com")],
      people: [{ id: "p-staff", email: "new@example.com" }],
      grants: [],
      links: [],
      ...once,
      linkedPeople: ["p-staff"],
    });
    expect(link).toEqual([]);
  });

  it("links only one of two new logins with the same person's email", () => {
    const { link, unlinked } = plan({
      users: [login("u-a", "new@example.com"), login("u-b", "NEW@example.com")],
      people: [{ id: "p-new", email: "new@example.com" }],
      grants: [],
      links: [],
      ...once,
    });
    expect(link).toEqual([{ person: "p-new", user: "u-a" }]);
    expect(unlinked).toEqual([{ user: "u-b", reason: expect.stringContaining("already has a login") }]);
  });

  it("links nobody by an email two people share, and says why", () => {
    const { add, link, unlinked } = plan({
      users: [login("u-new", "new@example.com")],
      people: [
        { id: "p-new", email: "new@example.com" },
        { id: "p-other", email: "new@example.com" },
      ],
      grants: [{ person_id: "p-new", policy_id: "medical" }],
      links: [],
      emailCounts: { "new@example.com": 2 },
      linkedPeople: [],
    });
    expect(link).toEqual([]);
    expect(add).toEqual([]);
    expect(unlinked).toEqual([{ user: "u-new", reason: expect.stringContaining("more than one person") }]);
  });

  it("never moves a linked login to another person by email", () => {
    const { add, link } = plan({
      users: [login("u-crew", "new@example.com", "p-crew")],
      people: [
        { id: "p-crew", email: "crew@example.com" },
        { id: "p-new", email: "new@example.com" },
      ],
      grants: [{ person_id: "p-new", policy_id: "writer" }],
      links: [],
      ...once,
    });
    expect(link).toEqual([]);
    expect(add).toEqual([]);
  });

  it("takes away a link no group gives, and a duplicate, and keeps the rest", () => {
    const { add, remove } = plan({
      users: [login("u-crew", "crew@example.com", "p-crew")],
      people: [{ id: "p-crew", email: null }],
      grants: [{ person_id: "p-crew", policy_id: "writer" }],
      links: [
        { id: "a1", user: "u-crew", policy: "writer" },
        { id: "a2", user: "u-crew", policy: "writer" },
        { id: "a3", user: "u-crew", policy: "medical" },
      ],
      ...once,
    });
    expect(add).toEqual([]);
    expect(remove).toEqual(["a2", "a3"]);
  });

  it("takes away a policy linked straight to a login, which no group gives", () => {
    const { remove } = plan({
      users: [login("u-crew", "crew@example.com", "p-crew")],
      people: [{ id: "p-crew", email: null }],
      grants: [],
      links: [{ id: "a1", user: "u-crew", policy: "crew-rules" }],
      ...once,
    });
    expect(remove).toEqual(["a1"]);
  });

  it("takes away a login's links once it's unlinked from its person", () => {
    const { remove } = plan({
      users: [login("u-crew", "crew@example.com")],
      people: [],
      grants: [{ person_id: "p-crew", policy_id: "writer" }],
      links: [{ id: "a1", user: "u-crew", policy: "writer" }],
      ...once,
    });
    expect(remove).toEqual(["a1"]);
  });

  it("never touches a user it doesn't manage, such as a sync's or the first admin's", () => {
    const { add, remove } = plan({
      users: [login("u-crew", "crew@example.com")],
      people: [{ id: "p-other", email: "sync@example.com" }],
      grants: [{ person_id: "p-other", policy_id: "medical" }],
      links: [{ id: "a1", user: "u-sync", policy: "reader" }],
      ...once,
    });
    expect(add).toEqual([]);
    expect(remove).toEqual([]);
  });
});

describe("linking a family's login", () => {
  const family = [
    { id: "p-parent", email: "family@example.com" },
    { id: "p-child", email: "family@example.com" },
  ];
  const input = {
    users: [login("u-family", "family@example.com")],
    people: family,
    grants: [],
    links: [],
    emailCounts: { "family@example.com": 2 },
    linkedPeople: [],
  };

  it("links a login with no group to its person, so the Community rules can find them", () => {
    const { link } = plan({ ...input, people: [family[0]!], emailCounts: { "family@example.com": 1 } });
    expect(link).toEqual([{ person: "p-parent", user: "u-family" }]);
  });

  it("links the parent when a parent and their child share an email, and reports no one", () => {
    const { link, unlinked } = plan({ ...input, guardianLinks: [{ subject: "p-child", contact: "p-parent" }] });
    expect(link).toEqual([{ person: "p-parent", user: "u-family" }]);
    expect(unlinked).toEqual([]);
  });

  it("links no one when the people sharing an email aren't one parent and their children", () => {
    const { link, unlinked } = plan(input);
    expect(link).toEqual([]);
    expect(unlinked).toHaveLength(1);
  });

  it("links no one when someone else with the email isn't among the people it was given", () => {
    const { link } = plan({
      ...input,
      emailCounts: { "family@example.com": 3 },
      guardianLinks: [{ subject: "p-child", contact: "p-parent" }],
    });
    expect(link).toEqual([]);
  });
});

describe("the Team role", () => {
  const roles = { community: "Community", team: "Team" };
  const personOf = new Map([
    ["u-joins", "p-joins"],
    ["u-joins-too", "p-joins"],
    ["u-leaves", "p-leaves"],
    ["u-stays", "p-stays"],
    ["u-crew", "p-crew"],
    ["u-staff", "p-staff"],
    ["u-admin", "p-admin"],
  ]);
  const users = [
    { id: "u-joins", role: "Community" },
    { id: "u-joins-too", role: "Community" },
    { id: "u-leaves", role: "Team" },
    { id: "u-stays", role: "Team" },
    { id: "u-crew", role: "Crew" },
    { id: "u-staff", role: "Staff" },
    { id: "u-admin", role: "Admin" },
    { id: "u-unlinked", role: "Team" },
  ];

  it("moves each of a family's logins onto Team while they're on a team, and back to Community after", () => {
    const moves = teamMoves({
      users,
      personOf,
      onTeam: new Set(["p-joins", "p-stays", "p-crew", "p-staff", "p-admin"]),
      ...roles,
    });
    expect(moves).toEqual([
      { user: "u-joins", role: "Team" },
      { user: "u-joins-too", role: "Team" },
      { user: "u-leaves", role: "Community" },
      { user: "u-unlinked", role: "Community" },
    ]);
  });

  it("never moves Crew, Staff, or Admin", () => {
    const moves = teamMoves({ users, personOf, onTeam: new Set(), ...roles });
    expect(moves.map(({ user }) => user).filter((user) => ["u-crew", "u-staff", "u-admin"].includes(user))).toEqual([]);
  });
});

describe("users' names", () => {
  const personOf = new Map([
    ["u-new", "p-new"],
    ["u-new-too", "p-new"],
    ["u-same", "p-same"],
    ["u-renamed", "p-renamed"],
  ]);
  const people = [
    { id: "p-new", first_name: "Ada", last_name: "Lovelace" },
    { id: "p-same", first_name: "Grace", last_name: "Hopper" },
    { id: "p-renamed", first_name: "Kat", last_name: null },
  ];

  it("gives each user their person's first and last name, when they differ", () => {
    const updates = renames({
      users: [
        { id: "u-new", first_name: null, last_name: null },
        { id: "u-new-too", first_name: "A", last_name: null },
        { id: "u-same", first_name: "Grace", last_name: "Hopper" },
        { id: "u-renamed", first_name: "Katherine", last_name: "Johnson" },
      ],
      people,
      personOf,
    });
    expect(updates).toEqual([
      { user: "u-new", first_name: "Ada", last_name: "Lovelace" },
      { user: "u-new-too", first_name: "Ada", last_name: "Lovelace" },
      { user: "u-renamed", first_name: "Kat", last_name: null },
    ]);
  });

  it("leaves a user no person is linked to with the name they have", () => {
    expect(renames({ users: [{ id: "u-alone", first_name: "Sam", last_name: null }], people, personOf })).toEqual([]);
  });
});

describe("moving users between Community and Team", () => {
  const roleIds = { Community: "r-community", Team: "r-team", Crew: "r-crew" };

  /** `directus_users` in memory, behind the slice of knex `applyMoves` uses. */
  function fakeDatabase(roles: Record<string, string>) {
    const locked: string[][] = [];
    const trx = (table: string) => {
      expect(table).toBe("directus_users");
      const wheres: [string, string[]][] = [];
      let forUpdate = false;
      const query = {
        select: () => query,
        whereIn: (column: string, values: string[]) => (wheres.push([column, values]), query),
        forUpdate: () => ((forUpdate = true), query),
        then: (resolve: (rows: { id: string }[]) => void) => {
          const rows = Object.entries(roles)
            .filter(([id, role]) => wheres.every(([column, values]) => values.includes(column === "id" ? id : role)))
            .map(([id]) => ({ id }));
          if (forUpdate) locked.push(rows.map(({ id }) => id));
          resolve(rows);
        },
      };
      return query;
    };
    const database = { transaction: async <T>(run: (t: unknown) => Promise<T>) => run(trx) };
    const usersService = (t: unknown) => {
      expect(t).toBe(trx);
      return {
        updateMany: async (ids: string[], { role }: { role: string }) => {
          for (const id of ids) roles[id] = role;
        },
      };
    };
    return { database, usersService, locked };
  }

  it("leaves a user an admin moved off Community or Team after the hook read their role", async () => {
    // The plan was made when u-promoted was Community; an admin has since made them Crew.
    const roles = { "u-joins": "r-community", "u-promoted": "r-crew", "u-leaves": "r-team" };
    const { database, usersService, locked } = fakeDatabase(roles);
    const moved = await applyMoves({
      database,
      usersService,
      moves: [
        { user: "u-joins", role: "Team" },
        { user: "u-promoted", role: "Team" },
        { user: "u-leaves", role: "Community" },
      ],
      roleIds,
      family: ["Community", "Team"],
    });
    expect(roles).toEqual({ "u-joins": "r-team", "u-promoted": "r-crew", "u-leaves": "r-community" });
    expect(moved).toEqual({ Team: 1, Community: 1 });
    // It locks the rows it moves, so an admin's change that lands meanwhile waits, then wins.
    expect(locked).toEqual([["u-joins"], ["u-leaves"]]);
  });
});

describe("the hook's passes", () => {
  it("run once more after the running one, however often they're asked meanwhile", async () => {
    let passes = 0;
    let finish: () => void = () => {};
    const run = coalesce(async () => {
      passes++;
      await new Promise<void>((resolve) => (finish = resolve));
    });
    void run();
    for (let i = 0; i < 10; i++) void run();
    await Promise.resolve();
    expect(passes).toBe(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(passes).toBe(2);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(passes).toBe(2);
  });
});

describe("Authentik's sign-in groups", () => {
  const policies = { "p-agent": "FreeScout Agent", "p-send": "Listmonk Send" };

  it("hold the emails of each active login whose person a group gives the policy, and no one else", () => {
    const members = signInMembers({
      users: [
        { id: "u-gmail", email: "Alex@Gmail.example", status: "active" },
        { id: "u-work", email: "alex@work.example", status: "active" },
        { id: "u-suspended", email: "alex@old.example", status: "suspended" },
        { id: "u-other", email: "other@example.com", status: "active" },
        { id: "u-none", email: null, status: "active" },
      ],
      personOf: new Map([
        ["u-gmail", "p-alex"],
        ["u-work", "p-alex"],
        ["u-suspended", "p-alex"],
        ["u-other", "p-other"],
        ["u-none", "p-alex"],
      ]),
      grants: [
        { person_id: "p-alex", policy_id: "p-agent" },
        { person_id: "p-alex", policy_id: "p-agent" },
        { person_id: "p-other", policy_id: "writer" },
      ],
      policies,
    });
    expect(members).toEqual({
      "FreeScout Agent": ["alex@gmail.example", "alex@work.example"],
      "Listmonk Send": [],
    });
  });

  it("add who's missing, if they have an Authentik account, and take out who shouldn't be there", () => {
    expect(
      groupChanges({
        members: [
          { pk: 1, email: "Kept@example.com" },
          { pk: 2, email: "by-hand@example.com" },
        ],
        wanted: ["kept@example.com", "new@example.com", "never-signed-in@example.com"],
        found: { "new@example.com": 3 },
      }),
    ).toEqual({ add: [3], remove: [2] });
  });

  it("are made right through Authentik's API, taking out before adding, and a missing or failing group doesn't stop the rest", async () => {
    const calls: string[] = [];
    const request = async (route: string, options: { method?: string; body?: unknown } = {}) => {
      calls.push(`${options.method ?? "GET"} ${route} ${options.body ? JSON.stringify(options.body) : ""}`.trim());
      if (route.startsWith("/core/groups/?name=FreeScout")) {
        return {
          results: [{ pk: "g1", name: "FreeScout Agent", users_obj: [{ pk: 2, email: "by-hand@example.com" }] }],
        };
      }
      if (route.startsWith("/core/groups/?name=Listmonk%20Write")) throw new Error("Authentik answered 500");
      if (route.startsWith("/core/groups/?name=")) return { results: [] };
      if (route.startsWith("/core/users/?email=new%40example.com")) {
        return { results: [{ pk: 3, email: "new@example.com" }] };
      }
      return undefined;
    };
    const warnings: string[] = [];
    await syncAuthentik({
      members: {
        "Listmonk Write": ["new@example.com"],
        "FreeScout Agent": ["new@example.com"],
        "Listmonk Send": ["new@example.com"],
      },
      request,
      logger: { info: () => {}, warn: (...args) => warnings.push(String(args.at(-1))) },
    });
    expect(calls).toEqual([
      "GET /core/groups/?name=Listmonk%20Write&include_users=true",
      "GET /core/groups/?name=FreeScout%20Agent&include_users=true",
      'POST /core/groups/g1/remove_user/ {"pk":2}',
      "GET /core/users/?email=new%40example.com&is_active=true",
      'POST /core/groups/g1/add_user/ {"pk":3}',
      "GET /core/groups/?name=Listmonk%20Send&include_users=true",
    ]);
    expect(warnings).toEqual([
      "group-policies: couldn't update Authentik's Listmonk Write group",
      "group-policies: Authentik has no Listmonk Send group yet",
    ]);
  });
});
