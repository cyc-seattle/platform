import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";
import { effectiveAccess, violation } from "../stacks/backend/community-query-guard.cjs";
import { communityPolicies } from "../stacks/backend/community-rules.ts";
import { crewRules, groupPolicies, queryGuardConfig } from "../stacks/backend/policies.ts";

interface Snapshot {
  fields: { collection: string; field: string; type: string }[];
  relations: {
    collection: string;
    field: string;
    related_collection: string | null;
    meta?: { one_field?: string | null };
  }[];
}

const schemas = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const schema = mergeSchemas(schemas) as Snapshot;
const fieldsOf = (collection: string) =>
  schema.fields.filter((field) => field.collection === collection && field.type !== "alias").map(({ field }) => field);

const config = queryGuardConfig([...communityPolicies, { name: "Crew", rules: crewRules }, ...groupPolicies(schemas)]);
const COMMUNITY = ["Community", ...communityPolicies.map(({ name }) => name)];
const CREW = ["Crew", ...communityPolicies.map(({ name }) => name)];

function accessOf(names: string[]) {
  const access = effectiveAccess(config, names, fieldsOf);
  if (access === undefined) throw new Error(`${names.join(", ")} has no row-filtered rule.`);
  return access;
}

const community = accessOf(COMMUNITY);
const check = (collection: string, query: Record<string, unknown>, access = community) =>
  violation(access, schema.relations, collection, query);

describe("effectiveAccess", () => {
  it("restricts the fields some Community read rule withholds, and opens the unfiltered lookups", () => {
    expect(community).toEqual({
      restricted: { people: ["email", "phone", "school"], registrations: ["camp_id", "share_contact"] },
      open: ["camps", "classes", "program_areas", "programs"],
    });
  });

  it("checks nothing for a user whose rules never limit rows", () => {
    expect(effectiveAccess(config, ["CRM Writer", "Medical Reader"], fieldsOf)).toBeUndefined();
  });

  it("opens a collection someone reads whole, whatever else they hold", () => {
    const crew = accessOf(CREW);
    expect(crew.open).toEqual(expect.arrayContaining(["people", "registration_entries"]));
    expect(crew.restricted["people"]).toBeUndefined();
  });
});

describe("the Community query guard", () => {
  it("passes the portal's roster requests", () => {
    const activeCamp = { start_date: { _lte: "$NOW" }, end_date: { _gte: "$NOW(-36 hours)" } };
    expect(check("registration_entries", { filter: { class_id: { camp_id: activeCamp } } })).toBeUndefined();
    expect(check("people", {})).toBeUndefined();
    expect(check("contacts", { filter: { subject_id: { _eq: "p1" } } })).toBeUndefined();
  });

  it("passes a search, which Directus checks against permissions itself", () => {
    expect(check("people", { search: "bart" })).toBeUndefined();
  });

  it.each([
    [{ filter: { email: { _starts_with: "b" } } }, "people.email"],
    [{ filter: { _or: [{ first_name: { _eq: "x" } }, { phone: { _nnull: true } }] } }, "people.phone"],
    [{ sort: ["-email"] }, "people.email"],
    [{ group: ["school"] }, "people.school"],
    [{ aggregate: { countDistinct: ["phone"] } }, "people.phone"],
    [{ filter: { my_contacts: { contact_id: { first_name: { _eq: "Marge" } } } } }, "the relation people.my_contacts"],
    [
      { filter: { my_contacts: { _some: { relationship_type: { _eq: "guardian" } } } } },
      "the relation people.my_contacts",
    ],
    [
      { filter: { "$FOLLOW(contacts,subject_id)": { contact_id: { _null: false } } } },
      "the relation $FOLLOW(contacts,subject_id)",
    ],
    [
      { deep: { my_contacts: { _filter: { contact_id: { email: { _eq: "x" } } } } } },
      "the relation contacts.contact_id",
    ],
    [{ deep: { participant_links: { _sort: ["-person_id.phone"] } } }, "the relation participants.person_id"],
  ])("rejects %j on people", (query: Record<string, unknown>, reason: string) => {
    expect(check("people", query)).toBe(reason);
  });

  it("passes a deep filter on a field the viewer reads on every related row they see", () => {
    expect(check("people", { deep: { my_contacts: { _filter: { relationship_type: { _eq: "guardian" } } } } })).toBe(
      undefined,
    );
  });

  it("follows `_some` the way Directus does, wherever it sits among the keys", () => {
    const probe = { participant_id: { person_id: { email: { _starts_with: "b" } } } };
    expect(
      check("programs", {
        filter: { classes: { name: { _eq: "x" }, _some: { registration_entries: { registration_id: probe } } } },
      }),
    ).toBe("the relation classes.registration_entries");
    expect(check("programs", { filter: { classes: { _none: { camp_id: { name: { _eq: "x" } } } } } })).toBeUndefined();
  });

  it("rejects a filter through an open collection back into a partial one", () => {
    expect(check("contacts", { filter: { subject_id: { email: { _eq: "x" } } } })).toBe(
      "the relation contacts.subject_id",
    );
  });

  it("rejects a relation through a field the viewer can't read on every row", () => {
    expect(check("registrations", { filter: { camp_id: { name: { _eq: "Summer Session 2" } } } })).toBe(
      "registrations.camp_id",
    );
  });
});

describe("the query guard for Crew", () => {
  const crew = accessOf(CREW);
  const allergies = { participant_links: { medical_allergies: { _contains: "peanut" } } };

  it("passes a filter on the people Crew reads whole", () => {
    expect(check("people", { filter: { email: { _starts_with: "b" } } }, crew)).toBeUndefined();
  });

  it("rejects probing other sailors' medical answers through the rule that shows a Crew parent their own child's", () => {
    expect(check("people", { filter: allergies }, crew)).toBe("the relation people.participant_links");
    expect(
      check("people", { filter: { "$FOLLOW(medical_profiles,person_id)": { allergies: { _nnull: true } } } }, crew),
    ).toBe("the relation $FOLLOW(medical_profiles,person_id)");
  });

  it("passes the same filter for a Crew member with CRM Writer and Medical Reader, who reads every participant", () => {
    expect(check("people", { filter: allergies }, accessOf([...CREW, "CRM Writer", "Medical Reader"]))).toBeUndefined();
  });

  it("rejects a deep filter that probes other sailors' medical answers", () => {
    expect(check("people", { deep: { my_contacts: { _filter: { subject_id: allergies } } } }, crew)).toBe(
      "the relation people.participant_links",
    );
  });
});

// A Staff user moved to Crew, who has the Staff group's CRM Writer and Medical Writer.
describe("the query guard for migrated staff", () => {
  const staff = accessOf([...CREW, "CRM Writer", "Medical Writer"]);

  it.each([
    ["people", { deep: { participant_links: { _filter: { medical_allergies: { _nnull: true } }, _sort: ["-id"] } } }],
    ["people", { deep: { my_contacts: { contact_id: { _filter: { email: { _nnull: true } } } } } }],
    ["people", { filter: { "$FOLLOW(medical_profiles,person_id)": { allergies: { _nnull: true } } } }],
    ["people", { filter: { my_contacts: { contact_id: { last_name: { _eq: "Simpson" } } } }, sort: ["-email"] }],
    ["contacts", { filter: { subject_id: { email: { _eq: "x" } } }, sort: ["contact_id.last_name"] }],
    [
      "registrations",
      {
        filter: { participant_id: { person_id: { last_name: { _eq: "Simpson" } } } },
        sort: ["participant_id.person_id.last_name"],
        deep: { registration_entries: { _filter: { class_id: { camp_id: { name: { _eq: "Summer" } } } } } },
      },
    ],
  ])("passes the Data Studio's relational queries on %s: %j", (collection: string, query: Record<string, unknown>) => {
    expect(check(collection, query, staff)).toBeUndefined();
  });

  it("still rejects a filter into the accounts, whose other rows Directus hides", () => {
    expect(check("people", { filter: { directus_user_id: { email: { _starts_with: "a" } } } }, staff)).toBe(
      "the relation people.directus_user_id",
    );
  });
});
