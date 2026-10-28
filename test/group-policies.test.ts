import { describe, expect, it } from "vitest";
import { plan } from "../stacks/backend/group-policies.cjs";

const users = [
  { id: "u-crew", email: "crew@example.com" },
  { id: "u-new", email: "new@example.com" },
];

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
    });
    expect(add).toEqual([
      { user: "u-crew", policy: "writer" },
      { user: "u-crew", policy: "medical" },
    ]);
    expect(remove).toEqual([]);
  });

  it("finds the login of a person added before they first signed in by their email, in any case", () => {
    const { add } = plan({
      users,
      people: [{ id: "p-new", email: "New@Example.com", directus_user_id: null }],
      grants: [{ person_id: "p-new", policy_id: "writer" }],
      links: [],
    });
    expect(add).toEqual([{ user: "u-new", policy: "writer" }]);
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
    });
    expect(add).toEqual([{ user: "u-crew", policy: "writer" }]);
  });
});
