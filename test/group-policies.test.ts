import { describe, expect, it } from "vitest";
import { plan } from "../stacks/backend/group-policies.cjs";

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
