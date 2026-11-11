import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { discoverSchemaFiles } from "../src/directus/client.ts";
import { familyPolicies } from "../stacks/backend/community-rules.ts";
import {
  crewRules,
  fieldsIn,
  groupPolicies,
  groupPoliciesConfig,
  queryGuardConfig,
  savedVersionsConfig,
  WEBSITE_BUILD,
  WEBSITE_FILE_FIELDS,
  websiteBuildRules,
} from "../stacks/backend/policies.ts";
import { WEBSITE_FOLDER } from "../stacks/backend/migrations/cyc0007-website-folder.cjs";

const schemas = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")),
}));
const policies = groupPolicies(schemas);
const fieldsOf = (collection: string) => fieldsIn(schemas, collection);
const named = (name: string) => policies.find((policy) => policy.name === name)!;
const collections = (name: string, action: string) =>
  new Set(
    named(name)
      .rules.filter((rule) => rule.action === action)
      .map((rule) => rule.collection),
  );

describe("the group-policies hook", () => {
  it("manages users on every role a person signs in with, Staff included", () => {
    expect(groupPoliciesConfig([]).roles).toEqual(["Community", "Team", "Crew", "Staff", "Admin"]);
  });
});

describe("the policies a group can give", () => {
  it("are the CRM, Medical, Calendar, Catalog, and Plan policies", () => {
    expect(groupPoliciesConfig(policies).grantable).toEqual([
      "CRM Reader",
      "CRM Writer",
      "Calendar Reader",
      "Calendar Writer",
      "Catalog Reader",
      "Catalog Writer",
      "Medical Reader",
      "Medical Writer",
      "Plan Reader",
      "Plan Writer",
    ]);
  });

  it("are the only ones a group's policy list offers, and the list makes none", () => {
    const access = schemas.find(({ name }) => name === "access")!.schema as {
      fields: {
        collection: string;
        field: string;
        meta: { options: { enableCreate: boolean; filter: { name: { _in: string[] } } } };
      }[];
    };
    const { options } = access.fields.find(
      ({ collection, field }) => collection === "groups" && field === "policies",
    )!.meta;
    expect([...options.filter.name._in].sort()).toEqual(groupPoliciesConfig(policies).grantable);
    expect(options.enableCreate).toBe(false);
  });

  it("are coarse: no row filters and no field lists, but a person's writable fields and CRM Writer's two hand-set ones", () => {
    for (const rule of policies.flatMap((policy) => policy.rules)) {
      expect(rule.permissions).toBeUndefined();
    }
    const fielded = named("CRM Writer").rules.filter((rule) => rule.fields && rule.collection !== "people");
    expect(fielded.map(({ collection, fields }) => `${collection}.${fields}`)).toEqual([
      "clubspot_classes.program_id",
      "clubspot_participants.person_id",
    ]);
  });

  it("keep medical information to the Medical policies", () => {
    for (const name of ["CRM Reader", "CRM Writer"]) {
      expect(collections(name, "read").has("medical_profiles")).toBe(false);
    }
    expect([...collections("Medical Reader", "read")]).toEqual(["medical_profiles"]);
    expect([...collections("Medical Writer", "delete")]).toEqual(["medical_profiles"]);
  });

  it("leave groups to admins, and the catalog's money to the Catalog policies", () => {
    for (const policy of policies) {
      const touched = policy.rules.map((rule) => rule.collection);
      for (const collection of ["groups", "group_members", "group_policies"]) {
        expect(touched).not.toContain(collection);
      }
      const changed = policy.rules.filter((rule) => rule.action !== "read").map((rule) => rule.collection);
      if (!policy.name.startsWith("Catalog ")) {
        expect(changed).not.toContain("products");
        expect(changed).not.toContain("accounts");
      }
      if (!policy.name.startsWith("Catalog ") && !policy.name.startsWith("Plan ")) {
        expect(touched).not.toContain("products");
        expect(touched).not.toContain("accounts");
      }
    }
  });

  it("let a CRM Writer change people, but not Clubspot's own records", () => {
    expect(collections("CRM Writer", "update").has("people")).toBe(true);
    expect(collections("CRM Writer", "update").has("clubspot_registrations")).toBe(false);
    expect(collections("CRM Reader", "read")).toEqual(collections("CRM Writer", "read"));
  });
});

describe("the Catalog policies", () => {
  const catalog = [
    "products",
    "program_areas",
    "accounts",
    "qualifications",
    "qualification_covers",
    "boat_classes",
    "resource_kinds",
    "programs",
    "catalog_offerings",
    "organization_cost_accounts",
  ];
  const directory = ["organizations", "venues"];

  it("let a Catalog Reader see the whole catalog and the directory, and change none of it", () => {
    expect([...collections("Catalog Reader", "read")].sort()).toEqual([...catalog, ...directory].sort());
    expect(named("Catalog Reader").rules.every((rule) => rule.action === "read")).toBe(true);
  });

  it("let a Catalog Writer change the whole catalog, and only see the directory", () => {
    for (const action of ["create", "update", "delete"]) {
      expect([...collections("Catalog Writer", action)].sort()).toEqual([...catalog].sort());
    }
    expect([...collections("Catalog Writer", "read")].sort()).toEqual([...catalog, ...directory].sort());
  });

  it("leave the directory to admins: no policy a group gives changes it", () => {
    const writers = policies.filter((policy) =>
      policy.rules.some((rule) => directory.includes(rule.collection) && rule.action !== "read"),
    );
    expect(writers).toEqual([]);
    for (const collection of directory) {
      expect(collections("Plan Reader", "read").has(collection)).toBe(true);
      expect(collections("Plan Writer", "read").has(collection)).toBe(true);
    }
  });

  it("are the only policies that change programs", () => {
    const writers = policies.filter((policy) =>
      policy.rules.some((rule) => rule.collection === "programs" && rule.action !== "read"),
    );
    expect(writers.map(({ name }) => name)).toEqual(["Catalog Writer"]);
    expect(collections("CRM Writer", "read").has("programs")).toBe(true);
  });
});

describe("the Calendar policies", () => {
  const calendar = ["event_series", "events", "events_boat_classes", "calendars", "calendar_dates"];
  const linked = ["organizations", "venues", "boat_classes"];

  it("let a Calendar Reader see the calendar and what its events name, and change none of it", () => {
    expect([...collections("Calendar Reader", "read")].sort()).toEqual([...calendar, ...linked].sort());
    expect(named("Calendar Reader").rules.every((rule) => rule.action === "read")).toBe(true);
  });

  it("let a Calendar Writer change the calendar, and only see what its events name", () => {
    for (const action of ["create", "update", "delete"]) {
      expect([...collections("Calendar Writer", action)].sort()).toEqual([...calendar].sort());
    }
    expect([...collections("Calendar Writer", "read")].sort()).toEqual([...calendar, ...linked].sort());
  });
});

const plans = [
  "plans",
  "plan_versions",
  "plan_programs",
  "plan_offerings",
  "plan_trips",
  "plan_activities",
  "plan_activity_blocks",
  "plan_block_staff",
  "plan_block_resources",
  "plan_block_boats",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_revenue_charges",
  "plan_rates",
  "plan_staff_levels",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_resources",
  "plan_boat_rates",
  "plan_pools",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
  "plan_closed_dates",
  "plan_results",
  "plan_result_lines",
  "plan_result_pnl",
  "plan_result_positions",
  "plan_result_warnings",
  "version_sets",
  "version_set_members",
];
const results = plans.filter((collection) => collection.startsWith("plan_result"));

describe("the Plan policies", () => {
  const catalog = collections("Catalog Reader", "read");

  it("let both see every plan and the catalog, with no field held back", () => {
    for (const name of ["Plan Reader", "Plan Writer"]) {
      const rules = named(name).rules.filter((rule) => rule.collection !== "directus_users");
      expect(
        [...new Set(rules.filter((rule) => rule.action === "read").map((rule) => rule.collection))].sort(),
      ).toEqual([...plans, ...catalog].sort());
      expect(rules.every((rule) => rule.fields === undefined)).toBe(true);
    }
  });

  it("let both see users' first and last names, and nothing else of theirs", () => {
    for (const name of ["Plan Reader", "Plan Writer"]) {
      expect(named(name).rules.filter((rule) => rule.collection === "directus_users")).toEqual([
        { collection: "directus_users", action: "read", fields: ["id", "first_name", "last_name"] },
      ]);
    }
  });

  it("let a Plan Reader change nothing", () => {
    expect(named("Plan Reader").rules.every((rule) => rule.action === "read")).toBe(true);
  });

  it("let a Plan Writer change plans and Financial Plans, and none of the catalog or the results", () => {
    for (const action of ["create", "update", "delete"]) {
      expect([...collections("Plan Writer", action)].sort()).toEqual(
        plans.filter((collection) => !results.includes(collection)).sort(),
      );
    }
  });

  it("are the only policies that see plans", () => {
    for (const policy of policies.filter(({ name }) => !name.startsWith("Plan "))) {
      expect(policy.rules.filter((rule) => plans.includes(rule.collection))).toEqual([]);
    }
    expect(crewRules.filter((rule) => plans.includes(rule.collection))).toEqual([]);
  });
});

describe("savedVersionsConfig", () => {
  it("guards every collection whose rows belong to a plan copy", () => {
    const { versioned, results: written, deletable } = savedVersionsConfig(schemas, false, "1.0.0");
    expect(versioned.sort()).toEqual(
      plans
        .filter(
          (collection) =>
            !["plans", "plan_versions", "version_sets", "version_set_members", ...results].includes(collection),
        )
        .sort(),
    );
    expect(written.sort()).toEqual([...results].sort());
    expect(deletable).toBe(false);
  });

  it("lists every link from a plan row to another, which must stay in the row's version", () => {
    const { links } = savedVersionsConfig(schemas, false, "1.0.0");
    expect(links).toEqual({
      plan_trips: { offering_id: "plan_offerings" },
      plan_activities: { offering_id: "plan_offerings", trip_id: "plan_trips", block_id: "plan_activity_blocks" },
      plan_block_staff: { block_id: "plan_activity_blocks" },
      plan_block_resources: { block_id: "plan_activity_blocks" },
      plan_block_boats: { block_id: "plan_activity_blocks" },
      plan_salaried_positions: { remainder_pool_id: "plan_pools" },
      plan_salaried_bookings: { position_id: "plan_salaried_positions" },
      plan_bonus_owner_products: { bonus_owner_id: "plan_bonus_owners" },
    });
  });
});

describe("a person's login", () => {
  it("is linked only by an admin or the group hook, never through a policy a person can hold", () => {
    const held = [
      ...policies.flatMap((policy) => policy.rules),
      ...crewRules,
      ...familyPolicies.flatMap((policy) => policy.rules),
    ];
    const writes = held.filter(
      (rule) => rule.collection === "people" && rule.action !== "read" && rule.action !== "delete",
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const rule of writes) {
      expect(rule.fields, `${rule.action} on people`).toBeDefined();
      expect(rule.fields).not.toContain("*");
      expect(rule.fields).not.toContain("directus_user_id");
    }
  });

  it("leaves every other field of a person to a CRM Writer", () => {
    const update = named("CRM Writer").rules.find((rule) => rule.collection === "people" && rule.action === "update");
    expect([...(update?.fields ?? []), "directus_user_id"].sort()).toEqual(fieldsOf("people").sort());
  });
});

describe("Crew", () => {
  it("reads every roster, everyone's details and medical information, and the catalog's money, and changes nothing", () => {
    expect(crewRules.every((rule) => rule.action === "read" && rule.permissions === undefined)).toBe(true);
    expect(crewRules.map((rule) => rule.collection)).toEqual(
      expect.arrayContaining([
        "clubspot_registration_entries",
        "people",
        "contacts",
        "contact_points",
        "medical_profiles",
        "offerings",
        "registrations",
        "products",
        "program_areas",
        "accounts",
      ]),
    );
  });

  it("doesn't read Clubspot's sign-up answers or payments", () => {
    for (const collection of [
      "clubspot_custom_field_responses",
      "clubspot_registration_billing",
      "clubspot_participants",
    ]) {
      expect(crewRules.map((rule) => rule.collection)).not.toContain(collection);
    }
  });
});

describe("queryGuardConfig", () => {
  it("records each policy's read rules, their fields, and whether they limit rows", () => {
    const config = queryGuardConfig([...familyPolicies, ...policies]);
    expect(config.policies["CRM Reader"]?.["people"]).toEqual([{ fields: "*", filtered: false }]);
    expect(config.policies["Community: own family"]?.["medical_profiles"]).toEqual([{ fields: "*", filtered: true }]);
    expect(config.policies["Community: own family"]?.["programs"]).toEqual([
      { fields: ["id", "name"], filtered: false },
    ]);
  });
});

describe("the csc-website build's rules", () => {
  const rules = websiteBuildRules(schemas);

  it("only read", () => {
    expect(new Set(rules.map((rule) => rule.action))).toEqual(new Set(["read"]));
  });

  it("read every website collection whole, and no other collection", () => {
    const own = rules.filter((rule) => !rule.collection.startsWith("directus_"));
    expect(own.every((rule) => rule.collection.startsWith("website_"))).toBe(true);
    expect(own.every((rule) => rule.permissions === undefined && rule.fields === undefined)).toBe(true);
    expect(own.map((rule) => rule.collection)).toEqual(
      expect.arrayContaining(["website_settings", "website_programs"]),
    );
  });

  it("read only the files in the Website folder, and that folder", () => {
    expect(rules.filter((rule) => rule.collection.startsWith("directus_"))).toEqual([
      {
        collection: "directus_files",
        action: "read",
        permissions: { folder: { _eq: WEBSITE_FOLDER } },
        fields: WEBSITE_FILE_FIELDS,
      },
      {
        collection: "directus_folders",
        action: "read",
        permissions: { id: { _eq: WEBSITE_FOLDER } },
        fields: ["id", "name"],
      },
    ]);
  });

  it("never read who uploaded a picture, its tags, or its metadata", () => {
    for (const field of ["uploaded_by", "modified_by", "tags", "location", "metadata", "*"]) {
      expect(WEBSITE_FILE_FIELDS).not.toContain(field);
    }
  });
});

describe("the query guard", () => {
  it("knows the csc-website build's rules by its role's name", () => {
    expect(queryGuardConfig([{ name: WEBSITE_BUILD, rules: websiteBuildRules(schemas) }]).policies).toHaveProperty(
      "Website Build.directus_files",
    );
  });
});
