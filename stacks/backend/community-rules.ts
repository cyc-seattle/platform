import type { PermissionAction } from "../../src/directus/client.ts";

// Plain data (no `@pulumi/*` import) describing the Community and Team roles' policies
// (cyc-seattle/workplace#6 decisions 26-29). `./index.ts` turns each policy into a `DirectusPolicy`
// plus its `DirectusPermissionRule` rows, and features/crm.feature checks them on dev. They match the
// signed-in user by the login the group-policies hook links to their person, not by email.

type Filter = Record<string, unknown>;

/** A null date of birth fails `_lte`, so an unknown birthdate counts as a minor with no special
 * case. */
const ADULT: Filter = { date_of_birth: { _lte: "$NOW(-18 years)" } };

/** Guardians usually have a null date of birth, so `ADULT` alone would lock them out; this only
 * rules out a contact who is *known* to be a minor. */
const NOT_KNOWN_MINOR: Filter = { _or: [{ date_of_birth: { _null: true } }, ADULT] };

export interface CommunityRuleFields {
  collection: string;
  action: PermissionAction;
  /** Omit for unrestricted access to the allowed fields, for a row with nothing sensitive in them. */
  permissions?: Filter;
  /** `["*"]` for every field. */
  fields: string[];
}

export interface CommunityPolicyData {
  /** Derives this policy's Pulumi resource names. */
  key: string;
  name: string;
  icon: string;
  description: string;
  rules: CommunityRuleFields[];
}

/** The signed-in user's own `people` row. */
const MY_LOGIN: Filter = { directus_user_id: { _eq: "$CURRENT_USER" } };

/** A `contacts` row naming the signed-in user as a guardian. */
const MY_CHILD_LINK: Filter = { _and: [{ relationship_type: { _eq: "guardian" } }, { contact_id: MY_LOGIN }] };

/** The signed-in user and their children. */
const MY_FAMILY: Filter = { _or: [MY_LOGIN, { my_contacts: MY_CHILD_LINK }] };

/** Everyone in the signed-in user's household. */
const MY_HOUSEHOLD: Filter = { household_id: { members: MY_LOGIN } };

/** The signed-in user, if they're an adult. Parents' dates of birth are seldom on file, so a parent
 * with none counts too, unless they have a guardian of their own, as a teen listed as a sibling's
 * guardian would. A sailor with none counts as a child. */
const ME_AS_ADULT: Filter = {
  _and: [
    MY_LOGIN,
    {
      _or: [
        ADULT,
        {
          _and: [
            { date_of_birth: { _null: true } },
            { contact_for: { relationship_type: { _eq: "guardian" } } },
            { my_contacts: { _none: { relationship_type: { _eq: "guardian" } } } },
          ],
        },
      ],
    },
  ],
};

/** Someone known to be under 18. With no date of birth on file, a co-parent and a child look alike,
 * so neither counts. */
const CHILD: Filter = { date_of_birth: { _gt: "$NOW(-18 years)" } };

/** A row in a household where the signed-in user is an adult. */
const MY_HOUSEHOLD_AS_ADULT: Filter = { household_id: { members: ME_AS_ADULT } };

/** How long after their last team offering ends someone stays on the team. The group-policies hook
 * uses the same window, so the Team role and the rosters agree. */
export const TEAM_MONTHS = 12;

/** A `registrations` row that puts its person on a team: confirmed, in a team's offering that ended
 * less than `TEAM_MONTHS` ago, or hasn't ended. */
export const TEAM_REGISTRATION: Filter = {
  _and: [
    { status: { _eq: "confirmed" } },
    { offering_id: { program_id: { team: { _eq: true } } } },
    {
      offering_id: {
        _or: [{ ends_on: { _null: true } }, { ends_on: { _gte: `$NOW(-${TEAM_MONTHS} months)` } }],
      },
    },
  ],
};

/** Someone signed up for a team. */
const TEAM_SAILOR: Filter = { registrations: TEAM_REGISTRATION };

/** A `contacts` row naming the guardian of someone signed up for a team. */
const TEAM_GUARDIAN_LINK: Filter = { _and: [{ relationship_type: { _eq: "guardian" } }, { subject_id: TEAM_SAILOR }] };

/** Everyone on a team: the sailors, and their parents with them. */
const ON_A_TEAM: Filter = { _or: [TEAM_SAILOR, { contact_for: TEAM_GUARDIAN_LINK }] };

/** An adult on a team whose household chose to share. A minor never shares their own email or phone. */
const SHARES_WITH_TEAMS: Filter = {
  _and: [
    { household_id: { share_contact: { _eq: true } } },
    { _or: [{ _and: [TEAM_SAILOR, ADULT] }, { _and: [{ contact_for: TEAM_GUARDIAN_LINK }, NOT_KNOWN_MINOR] }] },
  ],
};

const TEAM_PROGRAM: Filter = { team: { _eq: true } };

/** A team's offering, inside the window. */
const TEAM_OFFERING: Filter = {
  _and: [
    { program_id: { team: { _eq: true } } },
    { _or: [{ ends_on: { _null: true } }, { ends_on: { _gte: `$NOW(-${TEAM_MONTHS} months)` } }] },
  ],
};

/** Community's rules. Team and Crew have them too. */
export const familyPolicies: CommunityPolicyData[] = [
  {
    key: "own-family",
    name: "Community: own family",
    icon: "family_restroom",
    description:
      "Their own household and family: the people in their household and their details, their children's sign-ups " +
      "and medical information. An adult in a household changes whether it shares its email and phones, and each " +
      "person's display name and school, and their own phone and their children's. See docs/access.md.",
    rules: [
      {
        collection: "people",
        action: "read",
        // The login lets a page find the user's own row, with the one filter the query guard allows on it. One
        // rule, so every field reads the same on every row and the guard has nothing to hide from Community.
        fields: [
          "id",
          "first_name",
          "last_name",
          "display_name",
          "email",
          "phone",
          "school",
          "date_of_birth",
          "household_id",
          "share_contact",
          "directus_user_id",
        ],
        permissions: { _or: [MY_FAMILY, MY_HOUSEHOLD] },
      },
      // Not email: it links a login to a person (docs/access.md), so changing it could hand one to someone else.
      {
        collection: "people",
        action: "update",
        fields: ["display_name", "school"],
        permissions: MY_HOUSEHOLD_AS_ADULT,
      },
      {
        collection: "people",
        action: "update",
        fields: ["phone"],
        permissions: { _or: [ME_AS_ADULT, { _and: [MY_HOUSEHOLD_AS_ADULT, CHILD] }] },
      },
      {
        collection: "households",
        action: "read",
        fields: ["id", "share_contact", "members"],
        permissions: { members: MY_LOGIN },
      },
      { collection: "households", action: "update", fields: ["share_contact"], permissions: { members: ME_AS_ADULT } },
      {
        collection: "contacts",
        action: "read",
        fields: ["subject_id", "contact_id", "relationship_type"],
        permissions: {
          _or: [MY_CHILD_LINK, { _and: [{ relationship_type: { _eq: "guardian" } }, { subject_id: MY_HOUSEHOLD }] }],
        },
      },
      {
        collection: "registrations",
        action: "read",
        fields: ["id", "person_id", "offering_id", "status"],
        permissions: { person_id: MY_FAMILY },
      },
      {
        collection: "offerings",
        action: "read",
        fields: ["id", "program_id", "starts_on", "ends_on"],
        permissions: { registrations: { person_id: MY_FAMILY } },
      },
      // A program's name isn't private, and a page shows it beside each sign-up.
      { collection: "programs", action: "read", fields: ["id", "name"] },
      // Anyone who signs in can see the program areas, but not the revenue accounts they book to.
      { collection: "program_areas", action: "read", fields: ["id", "name"] },
      { collection: "medical_profiles", action: "read", fields: ["*"], permissions: { person_id: MY_FAMILY } },
    ],
  },
];

/** Team's own rules, beside Community's. */
export const teamPolicies: CommunityPolicyData[] = [
  {
    key: "names",
    name: "Team: names",
    icon: "groups",
    description:
      "Everyone on every team by name, which parent belongs to which sailor, and the teams' rosters. See docs/access.md.",
    rules: [
      { collection: "people", action: "read", fields: ["id", "first_name", "last_name"], permissions: ON_A_TEAM },
      {
        collection: "contacts",
        action: "read",
        fields: ["subject_id", "contact_id", "relationship_type"],
        permissions: TEAM_GUARDIAN_LINK,
      },
      {
        collection: "programs",
        action: "read",
        fields: ["id", "name", "team", "product_id", "google_group_id"],
        permissions: TEAM_PROGRAM,
      },
      // A team's program area is its product's, and the rosters group teams by it.
      {
        collection: "products",
        action: "read",
        fields: ["id", "program_area_id"],
        permissions: { programs: TEAM_PROGRAM },
      },
      {
        collection: "google_groups",
        action: "read",
        fields: ["id", "name", "email"],
        permissions: { programs: TEAM_PROGRAM },
      },
      {
        collection: "offerings",
        action: "read",
        fields: ["id", "program_id", "starts_on", "ends_on"],
        permissions: TEAM_OFFERING,
      },
      {
        collection: "registrations",
        action: "read",
        fields: ["id", "person_id", "offering_id", "status"],
        permissions: TEAM_REGISTRATION,
      },
    ],
  },
  {
    key: "contacts",
    name: "Team: contacts",
    icon: "contact_mail",
    description: "The email and phone of each adult on a team who chose to share. See docs/access.md.",
    rules: [
      {
        collection: "people",
        action: "read",
        fields: ["id", "first_name", "last_name", "email", "phone"],
        permissions: SHARES_WITH_TEAMS,
      },
    ],
  },
  {
    key: "schools",
    name: "Team: schools",
    icon: "school",
    description: "The school of each sailor on a team, but not their parents'. See docs/access.md.",
    rules: [
      // Names too, which the names rule already shows them, so the query guard still lets a filter on a name through.
      {
        collection: "people",
        action: "read",
        fields: ["id", "first_name", "last_name", "school"],
        permissions: TEAM_SAILOR,
      },
    ],
  },
];
