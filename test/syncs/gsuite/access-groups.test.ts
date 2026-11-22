import { describe, expect, it } from "vitest";
import { type GroupMember } from "@cyc-seattle/gsuite-sdk";
import {
  accessGroupPeople,
  contestedGoogleGroups,
  googleGroupSources,
  planAccessGroup,
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
    ).toEqual({ add: ["new@example.com"], remove: ["left@example.com", "outsider@example.org"], massRemoval: false });
  });

  it("skips a member with no address, such as a whole domain", () => {
    const live = [
      { email: "kept@example.com", role: "MEMBER", type: "USER" },
      { role: "MEMBER", type: "CUSTOMER" },
    ] as GroupMember[];
    expect(planAccessGroupMembers([{ email: "kept@example.com" }], live)).toEqual({
      add: [],
      remove: [],
      massRemoval: false,
    });
  });

  it("keeps a member who joined by an alias, whom Google lists at their primary address", async () => {
    const plan = await planAccessGroup(
      [{ email: "jane.doe@cycsail.team" }, { email: "kept@example.com" }],
      "board@example.org",
      {
        async listMembers() {
          return [
            { email: "jane@cycsail.team", role: "MEMBER", type: "USER" },
            { email: "kept@example.com", role: "MEMBER", type: "USER" },
          ];
        },
        async getMember(_, memberKey) {
          return memberKey === "jane.doe@cycsail.team"
            ? { email: "Jane@cycsail.team", role: "MEMBER", type: "USER" }
            : null;
        },
      },
    );
    expect(plan).toEqual({ add: [], remove: [], massRemoval: false });
  });

  it("calls taking out every plain member, or more than five, a mass removal", () => {
    const member = (email: string): GroupMember => ({ email, role: "MEMBER", type: "USER" });
    const manager: GroupMember = { email: "chair@example.com", role: "MANAGER", type: "USER" };
    expect(planAccessGroupMembers([], [member("a@example.com"), manager]).massRemoval).toBe(true);
    expect(
      planAccessGroupMembers(
        [{ email: "kept@example.com" }],
        [member("kept@example.com"), ...["a", "b", "c", "d", "e"].map((name) => member(`${name}@example.com`))],
      ).massRemoval,
    ).toBe(false);
    expect(
      planAccessGroupMembers(
        [{ email: "kept@example.com" }],
        [member("kept@example.com"), ...["a", "b", "c", "d", "e", "f"].map((name) => member(`${name}@example.com`))],
      ).massRemoval,
    ).toBe(true);
    expect(planAccessGroupMembers([], [manager]).massRemoval).toBe(false);
  });
});
