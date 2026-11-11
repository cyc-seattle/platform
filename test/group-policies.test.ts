import { describe, expect, it } from "vitest";
import { applyMoves, coalesce, plan, renames, teamMoves } from "../stacks/backend/group-policies.cjs";

const users = [
  { id: "u-crew", email: "crew@example.com" },
  { id: "u-new", email: "new@example.com" },
];
const once = { emailCounts: { "crew@example.com": 1, "new@example.com": 1 }, linkedUsers: [] };

describe("the group-policies hook's plan", () => {
  it("gives a member each policy their groups give, once", () => {
    const { add, remove } = plan({
      users,
      people: [{ id: "p-crew", email: "crew@example.com", directus_user_id: "u-crew" }],
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

  it("links a person added before they first signed in to their login by their email, in any case", () => {
    const { add, link } = plan({
      users,
      people: [{ id: "p-new", email: "New@Example.com", directus_user_id: null }],
      grants: [{ person_id: "p-new", policy_id: "writer" }],
      links: [],
      ...once,
    });
    expect(link).toEqual([{ person: "p-new", user: "u-new" }]);
    expect(add).toEqual([{ user: "u-new", policy: "writer" }]);
  });

  it("links nobody by an email two people share, and says why", () => {
    const { add, link, unlinked } = plan({
      users,
      people: [{ id: "p-new", email: "new@example.com", directus_user_id: null }],
      grants: [{ person_id: "p-new", policy_id: "medical" }],
      links: [],
      emailCounts: { "new@example.com": 2 },
      linkedUsers: [],
    });
    expect(link).toEqual([]);
    expect(add).toEqual([]);
    expect(unlinked).toEqual([{ person: "p-new", reason: expect.stringContaining("shares their email") }]);
  });

  it("links nobody by email to a login another person is already linked to", () => {
    const { add, link, unlinked } = plan({
      users,
      people: [{ id: "p-other", email: "crew@example.com", directus_user_id: null }],
      grants: [{ person_id: "p-other", policy_id: "medical" }],
      links: [],
      ...once,
      linkedUsers: ["u-crew"],
    });
    expect(link).toEqual([]);
    expect(add).toEqual([]);
    expect(unlinked).toEqual([{ person: "p-other", reason: expect.stringContaining("another person is linked to") }]);
  });

  it("keeps a linked person's login when their email changes to someone else's", () => {
    const { add, link } = plan({
      users,
      people: [{ id: "p-crew", email: "new@example.com", directus_user_id: "u-crew" }],
      grants: [{ person_id: "p-crew", policy_id: "writer" }],
      links: [],
      ...once,
    });
    expect(link).toEqual([]);
    expect(add).toEqual([{ user: "u-crew", policy: "writer" }]);
  });

  it("takes away a link no group gives, and a duplicate, and keeps the rest", () => {
    const { add, remove } = plan({
      users,
      people: [{ id: "p-crew", email: null, directus_user_id: "u-crew" }],
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

  it("never touches a user it doesn't manage, such as a sync's or the first admin's", () => {
    const { add, remove } = plan({
      users,
      people: [
        { id: "p-sync", email: null, directus_user_id: "u-sync" },
        { id: "p-other", email: "sync@example.com", directus_user_id: null },
      ],
      grants: [
        { person_id: "p-sync", policy_id: "medical" },
        { person_id: "p-other", policy_id: "medical" },
      ],
      links: [{ id: "a1", user: "u-sync", policy: "reader" }],
      ...once,
    });
    expect(add).toEqual([]);
    expect(remove).toEqual([]);
  });

  it("prefers a person's own login to another user with their email", () => {
    const { add } = plan({
      users,
      people: [{ id: "p", email: "new@example.com", directus_user_id: "u-crew" }],
      grants: [{ person_id: "p", policy_id: "writer" }],
      links: [],
      ...once,
    });
    expect(add).toEqual([{ user: "u-crew", policy: "writer" }]);
  });
});

describe("linking a family's login", () => {
  const family = [
    { id: "p-parent", email: "family@example.com", directus_user_id: null },
    { id: "p-child", email: "family@example.com", directus_user_id: null },
  ];
  const input = {
    users: [{ id: "u-family", email: "family@example.com" }],
    people: family,
    grants: [],
    links: [],
    emailCounts: { "family@example.com": 2 },
    linkedUsers: [],
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
    expect(unlinked).toHaveLength(2);
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
  const userOf = new Map([
    ["p-joins", "u-joins"],
    ["p-leaves", "u-leaves"],
    ["p-stays", "u-stays"],
    ["p-crew", "u-crew"],
    ["p-staff", "u-staff"],
    ["p-admin", "u-admin"],
  ]);
  const users = [
    { id: "u-joins", role: "Community" },
    { id: "u-leaves", role: "Team" },
    { id: "u-stays", role: "Team" },
    { id: "u-crew", role: "Crew" },
    { id: "u-staff", role: "Staff" },
    { id: "u-admin", role: "Admin" },
    { id: "u-unlinked", role: "Team" },
  ];

  it("moves a family onto Team while they're on a team, and back to Community after", () => {
    const moves = teamMoves({
      users,
      userOf,
      onTeam: new Set(["p-joins", "p-stays", "p-crew", "p-staff", "p-admin"]),
      ...roles,
    });
    expect(moves).toEqual([
      { user: "u-joins", role: "Team" },
      { user: "u-leaves", role: "Community" },
      { user: "u-unlinked", role: "Community" },
    ]);
  });

  it("never moves Crew, Staff, or Admin", () => {
    const moves = teamMoves({ users, userOf, onTeam: new Set(), ...roles });
    expect(moves.map(({ user }) => user).filter((user) => ["u-crew", "u-staff", "u-admin"].includes(user))).toEqual([]);
  });
});

describe("users' names", () => {
  const userOf = new Map([
    ["p-new", "u-new"],
    ["p-same", "u-same"],
    ["p-renamed", "u-renamed"],
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
        { id: "u-same", first_name: "Grace", last_name: "Hopper" },
        { id: "u-renamed", first_name: "Katherine", last_name: "Johnson" },
      ],
      people,
      userOf,
    });
    expect(updates).toEqual([
      { user: "u-new", first_name: "Ada", last_name: "Lovelace" },
      { user: "u-renamed", first_name: "Kat", last_name: null },
    ]);
  });

  it("leaves a user no person is linked to with the name they have", () => {
    expect(renames({ users: [{ id: "u-alone", first_name: "Sam", last_name: null }], people, userOf })).toEqual([]);
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
