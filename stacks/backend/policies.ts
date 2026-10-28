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

/** Retired by cyc-seattle/workplace#6 step 8a. Its users move to Crew, then a later PR deletes it. */
export const RETIRED_ROLES = ["Staff"];

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

/**
 * Full CRUD on every collection, except each one Clubspot owns, which is read-only. Two exceptions:
 * `promoted_fields` is staff-authored config despite living in the clubspot schema, and
 * `classes.program_id` and `participants.person_id` are set by hand: a class's program, and a
 * participant's match to a person. `fieldsOf` lists a collection's fields, so a rule can leave out
 * the ones only an admin writes.
 */
export function writerRules(
  collections: string[],
  clubspotOwned: string[],
  fieldsOf: (collection: string) => string[],
): PermissionRuleInput[] {
  const readOnly = new Set(clubspotOwned.filter((collection) => collection !== "promoted_fields"));
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
  rules.push({ collection: "classes", action: "update", fields: ["program_id"] });
  rules.push({ collection: "participants", action: "update", fields: ["person_id"] });
  return rules;
}

const MEDICAL = "medical_profiles";

/** The policies a group can give. Each is coarse: whole collections, with no row filter. */
export function groupPolicies(schemas: LoadedSchema[]): PolicyData[] {
  const collections = crmCollections(schemas).filter((collection) => collection !== MEDICAL);
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
      rules: writerRules(collections, clubspotCollections(schemas), (collection) => fieldsIn(schemas, collection)),
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
  ];
}

/** Crew's own rules, beside the Community policies it also has: every roster, and the catalog's money. */
export const crewRules: PermissionRuleInput[] = [
  ...["sessions", "registration_entries", "people", "programs", "camps", "classes"].map((collection) => ({
    collection,
    action: "read" as const,
  })),
  { collection: "products", action: "read" },
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
  // Staff stays managed until its users move to Crew, so they gain their group's policies first.
  return { grantable: policies.map(({ name }) => name).sort(), roles: [...ROLES, ...RETIRED_ROLES] };
}
