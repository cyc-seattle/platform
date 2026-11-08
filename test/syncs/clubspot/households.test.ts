import { describe, expect, it } from "vitest";
import {
  combineSharing,
  type HouseholdLink,
  type HouseholdPerson,
  planHouseholds,
} from "../../../src/syncs/clubspot/households.ts";
import { type HouseholdRow } from "../../../src/model/crm/index.ts";

const person = (id: string, overrides: Partial<HouseholdPerson> = {}): HouseholdPerson => ({
  id,
  household_id: null,
  share_contact: null,
  ...overrides,
});
const guardian = (child: string, parent: string): HouseholdLink => ({
  subject_id: child,
  contact_id: parent,
  relationship_type: "guardian",
});

function ids() {
  let next = 0;
  return () => `new-${++next}`;
}

function plan(
  people: HouseholdPerson[],
  links: HouseholdLink[],
  sailors: string[] = [],
  households: HouseholdRow[] = [],
) {
  return planHouseholds(people, links, sailors, households, ids());
}

describe("combineSharing", () => {
  it.each([
    [[true, true], true],
    [[true, null], true],
    [[true, false], false],
    [[null, false], false],
    [[null, null], null],
    [[], null],
  ])("makes %j into %j", (values, expected) => {
    expect(combineSharing(values)).toBe(expected);
  });
});

describe("planHouseholds", () => {
  it("puts a sailor, their parents, and the parents' other children in one household", () => {
    const people = ["kid", "sibling", "mom", "dad", "stranger"].map((id) => person(id));
    const result = plan(people, [guardian("kid", "mom"), guardian("kid", "dad"), guardian("sibling", "dad")]);
    expect(result.create).toEqual([{ id: "new-1", share_contact: null }]);
    expect(result.people).toEqual(["dad", "kid", "mom", "sibling"].map((id) => ({ id, household_id: "new-1" })));
  });

  it("leaves out emergency contacts", () => {
    const people = [person("kid"), person("aunt")];
    const result = plan(
      people,
      [{ subject_id: "kid", contact_id: "aunt", relationship_type: "emergency_contact" }],
      ["kid"],
    );
    expect(result.people).toEqual([{ id: "kid", household_id: "new-1" }]);
  });

  it("gives a sailor with no parents a household of their own", () => {
    const result = plan([person("adult-sailor")], [], ["adult-sailor"]);
    expect(result.create).toEqual([{ id: "new-1", share_contact: null }]);
    expect(result.people).toEqual([{ id: "adult-sailor", household_id: "new-1" }]);
  });

  it("writes nothing when every household is already right", () => {
    const people = [person("kid", { household_id: "home" }), person("mom", { household_id: "home" })];
    expect(plan(people, [guardian("kid", "mom")], ["kid"], [{ id: "home", share_contact: true }])).toEqual({
      create: [],
      update: [],
      people: [],
      delete: [],
    });
  });

  it("adds a newly linked parent to the household that's already there", () => {
    const people = [person("kid", { household_id: "home" }), person("mom", { household_id: "home" }), person("dad")];
    const result = plan(
      people,
      [guardian("kid", "mom"), guardian("kid", "dad")],
      [],
      [{ id: "home", share_contact: true }],
    );
    expect(result).toEqual({ create: [], update: [], people: [{ id: "dad", household_id: "home" }], delete: [] });
  });

  it("takes a no from someone who joins a household from none, as when two households join", () => {
    const people = [
      person("kid", { household_id: "home" }),
      person("mom", { household_id: "home" }),
      person("dad", { share_contact: false }),
    ];
    const result = plan(
      people,
      [guardian("kid", "mom"), guardian("kid", "dad")],
      [],
      [{ id: "home", share_contact: true }],
    );
    expect(result.update).toEqual([{ id: "home", share_contact: false }]);
  });

  describe("on the first run, takes each household's answer from its people's own", () => {
    it.each<[[boolean | null, boolean | null], boolean | null]>([
      [[true, null], true],
      [[true, false], false],
      [[null, null], null],
    ])("from %j, makes %j", ([mom, dad], expected) => {
      const people = [person("kid"), person("mom", { share_contact: mom }), person("dad", { share_contact: dad })];
      expect(plan(people, [guardian("kid", "mom"), guardian("kid", "dad")]).create).toEqual([
        { id: "new-1", share_contact: expected },
      ]);
    });
  });

  it("joins two households when a link connects them, keeping the larger and combining their answers", () => {
    const people = [
      person("kid", { household_id: "a" }),
      person("mom", { household_id: "a" }),
      person("sibling", { household_id: "b" }),
      person("dad", { household_id: "a" }),
    ];
    const households = [
      { id: "a", share_contact: true },
      { id: "b", share_contact: false },
    ];
    const result = plan(
      people,
      [guardian("kid", "mom"), guardian("kid", "dad"), guardian("sibling", "dad")],
      [],
      households,
    );
    expect(result).toEqual({
      create: [],
      update: [{ id: "a", share_contact: false }],
      people: [{ id: "sibling", household_id: "a" }],
      delete: ["b"],
    });
  });

  it("splits a household whose people are no longer linked, copying its answer to the new one", () => {
    // A staff unmerge: the sibling's link now goes to a different person.
    const people = [
      person("kid", { household_id: "home" }),
      person("mom", { household_id: "home" }),
      person("dad", { household_id: "home" }),
      person("sibling", { household_id: "home" }),
      person("other-dad"),
    ];
    const result = plan(
      people,
      [guardian("kid", "mom"), guardian("kid", "dad"), guardian("sibling", "other-dad")],
      [],
      [{ id: "home", share_contact: true }],
    );
    expect(result).toEqual({
      create: [{ id: "new-1", share_contact: true }],
      update: [],
      people: [
        { id: "other-dad", household_id: "new-1" },
        { id: "sibling", household_id: "new-1" },
      ],
      delete: [],
    });
  });

  it("takes someone out of a household when they're no longer anyone's parent or a sailor, and deletes an empty one", () => {
    const people = [person("former", { household_id: "old" })];
    expect(plan(people, [], [], [{ id: "old", share_contact: null }])).toEqual({
      create: [],
      update: [],
      people: [{ id: "former", household_id: null }],
      delete: ["old"],
    });
  });

  it("ignores a link to someone who isn't in the CRM", () => {
    expect(plan([person("kid")], [guardian("kid", "gone")]).people).toEqual([]);
  });
});
