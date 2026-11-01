import type { PermissionRuleInput } from "../../src/directus/client.ts";
import { collectionsInSchema } from "../../src/directus/client.ts";

// Plain data (no `@pulumi/*` import): the policies `./index.ts` declares, and what the two hook
// extensions need to know about them. docs/access.md describes the model.

/** A named set of permissions. `./index.ts` declares each one once, then attaches it to roles. */
export interface PolicyData {
  /** Derives the policy's Pulumi resource names. */
  key: string;
  name: string;
  icon: string;
  description: string;
  rules: PermissionRuleInput[];
}

/** The roles every person who signs in has one of. The hook manages only these roles' users. */
export const ROLES = ["Community", "Crew", "Admin"] as const;

/** The domains whose collections the CRM policies cover. Newer domains have policies of their own. */
const CRM_DOMAINS = new Set(["clubspot", "crm", "gsuite", "sync"]);

export interface LoadedSchema {
  name: string;
  schema: unknown;
}

/** The CRM's collections, from the schemas, so a new collection can't be left out. */
export function crmCollections(schemas: LoadedSchema[]): string[] {
  return [
    ...schemas.filter(({ name }) => CRM_DOMAINS.has(name)).flatMap(({ schema }) => collectionsInSchema(schema)),
    // `programs` moved from crm to core, and keeps the access it had.
    "programs",
  ];
}

/** The collections Clubspot owns, which are edited in Clubspot, not here. */
export function clubspotCollections(schemas: LoadedSchema[]): string[] {
  const clubspot = schemas.find(({ name }) => name === "clubspot")?.schema;
  if (clubspot === undefined) {
    throw new Error("backend: expected a schemas/clubspot.yaml to find the collections Clubspot owns");
  }
  return collectionsInSchema(clubspot);
}

/** The CRM's collections the Clubspot sync makes from Clubspot's records, so they're edited in Clubspot. */
export const DERIVED_FROM_CLUBSPOT = ["offerings", "registrations"];

/** A collection's fields in the schemas, aliases included, since a write can set those too. */
export function fieldsIn(schemas: LoadedSchema[], collection: string): string[] {
  return schemas.flatMap(({ schema }) =>
    ((schema as { fields?: { collection: string; field: string }[] }).fields ?? [])
      .filter((field) => field.collection === collection)
      .map(({ field }) => field),
  );
}

/**
 * Fields only an admin writes. A person's login decides whose groups' policies a user gets
 * (docs/access.md), so a writer who could set it could take someone else's.
 */
const ADMIN_ONLY: Record<string, string[]> = { people: ["directus_user_id"] };

/** The catalog's collections: every one in the core schema. */
export function catalogCollections(schemas: LoadedSchema[]): string[] {
  const core = schemas.find(({ name }) => name === "core")?.schema;
  if (core === undefined) {
    throw new Error("backend: expected a schemas/core.yaml to find the catalog's collections");
  }
  return collectionsInSchema(core);
}

/** The plans' collections: every one in the planning schema. */
export function planCollections(schemas: LoadedSchema[]): string[] {
  const planning = schemas.find(({ name }) => name === "planning")?.schema;
  if (planning === undefined) {
    throw new Error("backend: expected a schemas/planning.yaml to find the plans' collections");
  }
  return collectionsInSchema(planning);
}

/** The log of which saved version is active. A writer adds to it, and never rewrites it. */
const ACTIVATIONS = "plan_activations";

/** A saved version's results, which only the saved-versions hook writes, once, when it's saved. */
export function isResultCollection(collection: string): boolean {
  return collection === "plan_results" || collection.startsWith("plan_result_");
}

/**
 * Full CRUD on every collection, except each one in `readOnlyCollections`. Two exceptions:
 * `clubspot_promoted_fields` is staff-authored config despite living in the clubspot schema, and
 * `classes.program_id` and `participants.person_id` are set by hand: a class's program, and a
 * participant's match to a person. `fieldsOf` lists a collection's fields, so a rule can leave out
 * the ones only an admin writes.
 */
export function writerRules(
  collections: string[],
  readOnlyCollections: string[],
  fieldsOf: (collection: string) => string[],
): PermissionRuleInput[] {
  const readOnly = new Set(readOnlyCollections.filter((collection) => collection !== "clubspot_promoted_fields"));
  const rules: PermissionRuleInput[] = [];
  for (const collection of collections) {
    if (readOnly.has(collection)) {
      rules.push({ collection, action: "read" });
      continue;
    }
    const withheld = ADMIN_ONLY[collection];
    for (const action of ["create", "read", "update", "delete"] as const) {
      if (withheld !== undefined && (action === "create" || action === "update")) {
        const fields = fieldsOf(collection).filter((field) => !withheld.includes(field));
        rules.push({ collection, action, fields });
      } else {
        rules.push({ collection, action });
      }
    }
  }
  rules.push({ collection: "clubspot_classes", action: "update", fields: ["program_id"] });
  rules.push({ collection: "clubspot_participants", action: "update", fields: ["person_id"] });
  return rules;
}

const MEDICAL = "medical_profiles";

/** The policies a group can give. Each is coarse: whole collections, with no row filter. */
export function groupPolicies(schemas: LoadedSchema[]): PolicyData[] {
  const collections = crmCollections(schemas).filter((collection) => collection !== MEDICAL);
  const catalog = catalogCollections(schemas);
  const plans = planCollections(schemas);
  const readCatalog = catalog.map((collection) => ({ collection, action: "read" as const }));
  return [
    {
      key: "crm-reader",
      name: "CRM Reader",
      icon: "person_search",
      description: "Sees people, their details, and Clubspot's events and registrations. No medical information.",
      rules: collections.map((collection) => ({ collection, action: "read" })),
    },
    {
      key: "crm-writer",
      name: "CRM Writer",
      icon: "person_edit",
      description: "Changes people and their details. Clubspot's own records stay read-only. No medical information.",
      // Programs belong to the catalog, so only a Catalog Writer changes them.
      rules: writerRules(
        collections,
        [...clubspotCollections(schemas), ...DERIVED_FROM_CLUBSPOT, "programs"],
        (collection) => fieldsIn(schemas, collection),
      ),
    },
    {
      key: "medical-reader",
      name: "Medical Reader",
      icon: "medical_information",
      description: "Sees every sailor's medical information. Given with a CRM policy.",
      rules: [{ collection: MEDICAL, action: "read" }],
    },
    {
      key: "medical-writer",
      name: "Medical Writer",
      icon: "medical_services",
      description: "Changes every sailor's medical information. Given with a CRM policy.",
      rules: (["create", "read", "update", "delete"] as const).map((action) => ({ collection: MEDICAL, action })),
    },
    {
      key: "catalog-reader",
      name: "Catalog Reader",
      icon: "menu_book",
      description: "Sees the catalog: products, program areas, revenue accounts, programs, and the rest.",
      rules: readCatalog,
    },
    {
      key: "catalog-writer",
      name: "Catalog Writer",
      icon: "edit_note",
      description: "Changes the catalog: products, program areas, revenue accounts, programs, and the rest.",
      rules: catalog.flatMap((collection) =>
        (["create", "read", "update", "delete"] as const).map((action) => ({ collection, action })),
      ),
    },
    // Planners read wages and bonus rates with the rest of a plan: no field is hidden.
    {
      key: "plan-reader",
      name: "Plan Reader",
      icon: "event_note",
      description: "Sees every plan, wages and bonus rates included, and the catalog.",
      rules: [...readCatalog, ...plans.map((collection) => ({ collection, action: "read" as const }))],
    },
    // The saved-versions hook keeps a saved version from changing, for every user (docs/planning-schema.md).
    {
      key: "plan-writer",
      name: "Plan Writer",
      icon: "edit_calendar",
      description:
        "Changes any plan's draft, saves it as a version, and makes a saved version active. Sees the catalog.",
      rules: [
        ...readCatalog,
        ...plans.flatMap((collection) =>
          (isResultCollection(collection)
            ? (["read"] as const)
            : collection === ACTIVATIONS
              ? (["create", "read"] as const)
              : (["create", "read", "update", "delete"] as const)
          ).map((action) => ({ collection, action })),
        ),
      ],
    },
  ];
}

/** Crew's own rules, beside the Community policies it also has: every roster, and the catalog's money. */
export const crewRules: PermissionRuleInput[] = [
  ...[
    "clubspot_sessions",
    "clubspot_registration_entries",
    "people",
    "programs",
    "clubspot_camps",
    "clubspot_classes",
    ...DERIVED_FROM_CLUBSPOT,
  ].map((collection) => ({
    collection,
    action: "read" as const,
  })),
  { collection: "products", action: "read" },
  { collection: "program_areas", action: "read" },
  { collection: "accounts", action: "read" },
];

/** One read rule as the query guard sees it: which fields, and whether it limits rows. */
export interface GuardRule {
  fields: string[] | "*";
  filtered: boolean;
}

export interface QueryGuardConfig {
  /** Per policy name, per collection, its read rules. */
  policies: Record<string, Record<string, GuardRule[]>>;
}

/** What ./community-query-guard.cjs needs to reject a query that probes a hidden field. */
export function queryGuardConfig(policies: Pick<PolicyData, "name" | "rules">[]): QueryGuardConfig {
  const config: QueryGuardConfig = { policies: {} };
  for (const { name, rules } of policies) {
    const reads: Record<string, GuardRule[]> = {};
    for (const rule of rules.filter(({ action }) => action === "read")) {
      const fields = rule.fields === undefined || rule.fields.includes("*") ? "*" : [...rule.fields].sort();
      const filtered = rule.permissions !== undefined && Object.keys(rule.permissions).length > 0;
      (reads[rule.collection] ??= []).push({ fields, filtered });
    }
    config.policies[name] = reads;
  }
  return config;
}

export interface GroupPoliciesConfig {
  /** The policies a group may give, by name. */
  grantable: string[];
  /** The roles whose users the hook manages, by name. */
  roles: string[];
}

/** What ./group-policies.cjs needs. */
export function groupPoliciesConfig(policies: PolicyData[]): GroupPoliciesConfig {
  return { grantable: policies.map(({ name }) => name).sort(), roles: [...ROLES] };
}

export interface SavedVersionsConfig {
  /** The collections whose rows belong to one plan version. */
  versioned: string[];
  /** Those that hold a saved version's results, which only the hook writes. */
  results: string[];
  /** The engine version the hook calculates results with, which it records on each saved version. */
  platformVersion: string;
  /** Each table's decimal fields, which the database returns as strings and the engine needs as numbers. */
  decimals: Record<string, string[]>;
  /** Each of those collections' links to another one's rows, by field, which must be in the same version. */
  links: Record<string, Record<string, string>>;
  /** Whether the first admin account may delete a saved version, so the tests can clean up. Dev only. */
  deletable: boolean;
}

/** What ./saved-versions.cjs needs. */
export function savedVersionsConfig(
  schemas: LoadedSchema[],
  deletable: boolean,
  platformVersion: string,
): SavedVersionsConfig {
  const versioned = planCollections(schemas).filter(
    (collection) => collection !== ACTIVATIONS && fieldsIn(schemas, collection).includes("version_id"),
  );
  const relations = schemas.flatMap(
    ({ schema }) =>
      (schema as { relations?: { collection: string; field: string; related_collection: string | null }[] })
        .relations ?? [],
  );
  const links: Record<string, Record<string, string>> = {};
  for (const { collection, field, related_collection: related } of relations) {
    if (versioned.includes(collection) && related !== null && versioned.includes(related)) {
      (links[collection] ??= {})[field] = related;
    }
  }
  const decimals: Record<string, string[]> = {};
  for (const { schema } of schemas) {
    for (const { collection, field, type } of (
      schema as { fields?: { collection: string; field: string; type: string }[] }
    ).fields ?? []) {
      if (type === "decimal") (decimals[collection] ??= []).push(field);
    }
  }
  return {
    versioned,
    results: versioned.filter(isResultCollection),
    links,
    deletable,
    platformVersion,
    decimals,
  };
}
