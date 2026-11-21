import { describe, expect, it } from "vitest";
import {
  accessGroupPeople,
  contestedGoogleGroups,
  googleGroupSources,
  planAccessGroupMembers,
} from "../../../src/syncs/gsuite/access-groups.ts";

describe("which Google Groups a program or a CRM group fills", () => {
  it("lists each Google Group's sources, and the ones more than one fills", () => {
    const sources = googleGroupSources(
      [
        { id: "race-team", google_group_id: "g-race" },
        { id: "camp", google_group_id: "g-board" },
        { id: "no-group", google_group_id: null },
      ],
      [
        { id: "board", name: "Board of Directors", google_group_id: "g-board" },
        { id: "finance", name: "Finance Committee", google_group_id: "g-finance" },
        { id: "office", name: "Office", google_group_id: null },
      ],
    );
    expect(Object.fromEntries(sources)).toEqual({
      "g-race": [{ program: "race-team" }],
      "g-board": [{ program: "camp" }, { group: "board" }],
      "g-finance": [{ group: "finance" }],
    });
    expect(contestedGoogleGroups(sources)).toEqual(new Set(["g-board"]));
  });

  it("lets programs share a Google Group, as they always have", () => {
    const sources = googleGroupSources(
      [
        { id: "a", google_group_id: "g" },
        { id: "b", google_group_id: "g" },
      ],
      [],
    );
    expect(contestedGoogleGroups(sources)).toEqual(new Set());
  });

  it("counts two CRM groups on one Google Group as contested too", () => {
    const sources = googleGroupSources(
      [],
      [
        { id: "a", name: "A", google_group_id: "g" },
        { id: "b", name: "B", google_group_id: "g" },
      ],
    );
    expect(contestedGoogleGroups(sources)).toEqual(new Set(["g"]));
  });
});

describe("a CRM group's Google Group", () => {
  it("holds the group's people, each once", () => {
    const people = [
      { id: "p1", email: "one@example.com" },
      { id: "p2", email: "two@example.com" },
    ] as never[];
    expect(
      accessGroupPeople(
        "board",
        [
          { group_id: "board", person_id: "p1" },
          { group_id: "board", person_id: "p1" },
          { group_id: "other", person_id: "p2" },
        ],
        people,
      ),
    ).toEqual([{ id: "p1", email: "one@example.com" }]);
  });

  it("adds who's missing, and takes out plain members who aren't in the group, but never a manager, owner or nested group", () => {
    expect(
      planAccessGroupMembers(
        [{ email: "Kept@Example.com" }, { email: "new@example.com" }, { email: "not an email" }, { email: null }],
        [
          { email: "kept@example.com", role: "MEMBER", type: "USER" },
          { email: "left@example.com", role: "MEMBER", type: "USER" },
          { email: "outsider@example.org", role: "MEMBER", type: "EXTERNAL" },
          { email: "manager@example.com", role: "MANAGER", type: "USER" },
          { email: "owner@example.com", role: "OWNER", type: "USER" },
          { email: "announcers@example.com", role: "MEMBER", type: "GROUP" },
        ],
      ),
    ).toEqual({ add: ["new@example.com"], remove: ["left@example.com", "outsider@example.org"] });
  });
});
