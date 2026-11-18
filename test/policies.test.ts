import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { discoverSchemaFiles } from "../src/directus/client.ts";
import { familyPolicies } from "../stacks/backend/community-rules.ts";
import {
  ADMIN_ONLY_FIELDS,
  crewRules,
  fieldsIn,
  groupPolicies,
  groupPoliciesConfig,
  OPERATIONS_ONLY,
  queryGuardConfig,
  sailTeamPolicy,
  frozenPlansConfig,
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
  it("are the CRM, Medical, Catalog, Plan, and Sail Team writer policies", () => {
    expect(groupPoliciesConfig(policies).grantable).toEqual([
      "Announcement Writer",
      "CRM Reader",
      "CRM Writer",
      "Catalog Reader",
      "Catalog Writer",
      "Link Writer",
      "Medical Reader",
      "Medical Writer",
      "Plan Admin",
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

  it("are coarse: no row filters but the planners' by kind of plan, and no field lists but a person's writable fields and CRM Writer's two hand-set ones", () => {
    const planners = ["Plan Writer", "Plan Admin"];
    for (const rule of policies.filter(({ name }) => !planners.includes(name)).flatMap((policy) => policy.rules)) {
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

describe("Sail Team's links and announcements", () => {
  it("are read whole by everyone who signs in", () => {
    expect(sailTeamPolicy.rules).toEqual([
      { collection: "links", action: "read" },
      { collection: "announcements", action: "read" },
    ]);
  });

  it("are changed only by their own writer, who can't set a link's preview", () => {
    for (const [name, collection] of [
      ["Link Writer", "links"],
      ["Announcement Writer", "announcements"],
    ] as const) {
      expect(new Set(named(name).rules.map((rule) => rule.collection))).toEqual(new Set([collection]));
      expect(new Set(named(name).rules.map((rule) => rule.action))).toEqual(
        new Set(["create", "read", "update", "delete"]),
      );
    }
    for (const rule of named("Link Writer").rules.filter(({ action }) => action === "create" || action === "update")) {
      expect(rule.fields).toEqual(["id", "title", "url", "note", "sort"]);
    }
    for (const policy of policies.filter(({ name }) => name !== "Link Writer" && name !== "Announcement Writer")) {
      expect(policy.rules.map((rule) => rule.collection)).not.toContain("links");
      expect(policy.rules.map((rule) => rule.collection)).not.toContain("announcements");
    }
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
    "assets",
    "storage_areas",
    "boats",
    "programs",
    "program_boat_classes",
    "catalog_offerings",
    "organization_cost_accounts",
    "staff_roles",
    "staff_levels",
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

const plans = [
  "plans",
  "plan_programs",
  "plan_offerings",
  "plan_trips",
  "plan_activities",
  "plan_activity_blocks",
  "plan_block_staff",
  "plan_block_boats",
  "plan_labor_lines",
  "plan_budget_lines",
  "plan_capital_items",
  "plan_revenue_charges",
  "plan_rates",
  "plan_payroll_taxes",
  "plan_staff_levels",
  "plan_salaried_positions",
  "plan_salaried_bookings",
  "plan_boat_rates",
  "plan_pools",
  "plan_bonus_owners",
  "plan_bonus_owner_products",
  "plan_closed_dates",
  "plan_terms",
  "plan_results",
  "plan_result_lines",
  "plan_result_pnl",
  "plan_result_positions",
  "plan_result_bonuses",
  "plan_result_capital",
  "plan_result_warnings",
  "financial_plans",
];
const results = plans.filter((collection) => collection.startsWith("plan_result"));

describe("the Plan policies", () => {
  const catalog = collections("Catalog Reader", "read");

  it("let each see every plan and the catalog, with no field held back", () => {
    for (const name of ["Plan Reader", "Plan Writer", "Plan Admin"]) {
      const rules = named(name).rules.filter((rule) => rule.collection !== "directus_users");
      expect(
        [...new Set(rules.filter((rule) => rule.action === "read").map((rule) => rule.collection))].sort(),
      ).toEqual([...plans, ...catalog].sort());
      expect(rules.filter((rule) => rule.action === "read").every((rule) => rule.fields === undefined)).toBe(true);
    }
  });

  it("let each see users' first and last names, and nothing else of theirs", () => {
    for (const name of ["Plan Reader", "Plan Writer", "Plan Admin"]) {
      expect(named(name).rules.filter((rule) => rule.collection === "directus_users")).toEqual([
        { collection: "directus_users", action: "read", fields: ["id", "first_name", "last_name"] },
      ]);
    }
  });

  it("let a Plan Reader change nothing", () => {
    expect(named("Plan Reader").rules.every((rule) => rule.action === "read")).toBe(true);
  });

  const writes = (name: string) => named(name).rules.filter((rule) => rule.action !== "read");
  const rows = plans.filter((collection) => !["plans", "financial_plans", ...results].includes(collection));
  const inPlan = (kind: string) => ({ plan_id: { kind: { _eq: kind } } });

  it("let a Plan Writer change a Program Plan's rows, and none of the Operations Plan's own", () => {
    for (const action of ["create", "update", "delete"]) {
      const rules = writes("Plan Writer").filter((rule) => rule.action === action && rows.includes(rule.collection));
      expect(rules.map((rule) => rule.collection).sort()).toEqual(
        rows.filter((collection) => !OPERATIONS_ONLY.includes(collection)).sort(),
      );
      expect(rules.every((rule) => JSON.stringify(rule.permissions) === JSON.stringify(inPlan("program_area")))).toBe(
        true,
      );
    }
  });

  it("let only a Plan Admin set a program's indirect cost rate", () => {
    for (const action of ["create", "update"]) {
      const rule = writes("Plan Writer").find((r) => r.action === action && r.collection === "plan_programs");
      expect(rule?.fields).toContain("sailors_per_coach");
      expect(rule?.fields).not.toContain("indirect_cost_rate");
    }
    expect(writes("Plan Admin").find((r) => r.action === "update" && r.collection === "plan_programs")).toEqual({
      collection: "plan_programs",
      action: "update",
    });
  });

  it("let a Plan Writer start and delete a draft, and name it, but not freeze it, date it, or archive it", () => {
    const sets = writes("Plan Writer").filter((rule) => rule.collection === "financial_plans");
    expect(sets).toEqual([
      {
        collection: "financial_plans",
        action: "create",
        fields: ["id", "organization_id", "fiscal_year", "name", "note", "parent_id", "status"],
      },
      {
        collection: "financial_plans",
        action: "update",
        fields: ["organization_id", "fiscal_year", "name", "note", "parent_id"],
      },
      { collection: "financial_plans", action: "delete", permissions: { status: { _eq: "draft" } } },
    ]);
    expect(writes("Plan Writer").filter((rule) => rule.collection === "plans")).toEqual([
      {
        collection: "plans",
        action: "update",
        fields: ["notes"],
        permissions: { kind: { _eq: "program_area" } },
      },
    ]);
  });

  it("let a Plan Admin change the Operations Plan's rows, which plans a Financial Plan holds, and when it's in force", () => {
    for (const action of ["create", "update", "delete"]) {
      const rules = writes("Plan Admin").filter((rule) => rule.action === action && rows.includes(rule.collection));
      expect(rules.map((rule) => rule.collection).sort()).toEqual([...rows].sort());
      const scoped = rules.filter((rule) => !(action === "update" && rule.collection in ADMIN_ONLY_FIELDS));
      expect(scoped.every((rule) => JSON.stringify(rule.permissions) === JSON.stringify(inPlan("operations")))).toBe(
        true,
      );
      expect(collections("Plan Admin", action).has("plans"), `${action} plans`).toBe(true);
    }
    expect(writes("Plan Admin").filter((rule) => rule.collection === "financial_plans")).toEqual([
      {
        collection: "financial_plans",
        action: "update",
        fields: ["status", "effective_from", "archived_at", "frozen_by", "frozen_at"],
      },
    ]);
  });

  it("let no planner write a Financial Plan's results", () => {
    for (const name of ["Plan Writer", "Plan Admin"]) {
      expect(writes(name).filter((rule) => results.includes(rule.collection))).toEqual([]);
    }
  });

  it("leave none of the Operations Plan's own collections out", () => {
    expect(OPERATIONS_ONLY.every((collection) => rows.includes(collection))).toBe(true);
  });

  it("are the only policies that see plans", () => {
    for (const policy of policies.filter(({ name }) => !name.startsWith("Plan "))) {
      expect(policy.rules.filter((rule) => plans.includes(rule.collection))).toEqual([]);
    }
    expect(crewRules.filter((rule) => plans.includes(rule.collection))).toEqual([]);
  });
});

describe("frozenPlansConfig", () => {
  it("guards every collection whose rows belong to a plan", () => {
    const { rows, results: written, deletable } = frozenPlansConfig(schemas, false, "1.0.0");
    expect(rows.sort()).toEqual(
      plans.filter((collection) => !["plans", "financial_plans", ...results].includes(collection)).sort(),
    );
    expect(written.sort()).toEqual([...results].sort());
    expect(deletable).toBe(false);
  });

  it("lists every link from a plan row to another, which must stay in the row's plan", () => {
    const { links } = frozenPlansConfig(schemas, false, "1.0.0");
    expect(links).toEqual({
      plan_trips: { offering_id: "plan_offerings" },
      plan_activities: { offering_id: "plan_offerings", trip_id: "plan_trips", block_id: "plan_activity_blocks" },
      plan_block_staff: { block_id: "plan_activity_blocks" },
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
      expect(rule.fields).not.toContain("logins");
    }
    expect(held.filter((rule) => rule.collection === "directus_users" && rule.action !== "read")).toEqual([]);
  });

  it("leaves every other field of a person to a CRM Writer", () => {
    const update = named("CRM Writer").rules.find((rule) => rule.collection === "people" && rule.action === "update");
    expect([...(update?.fields ?? []), "logins"].sort()).toEqual(fieldsOf("people").sort());
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
