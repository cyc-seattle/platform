# Who can do what

`features/authentication.feature` and `features/authorization.feature` give the rules. This page says
how `backend` builds them.

## Roles

Everyone who signs in has one of three roles. A role gives base access, and only an admin changes
it, by hand in the Data Studio.

| Role      | Who                                      | What it gives                                                                                            |
| --------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Community | Everyone, on their first sign-in         | Their own children, their children's teammates, and what a program role such as Parent Coordinator gives |
| Crew      | People an admin trusts with every roster | Every roster, the products, program areas and revenue accounts to read, and the Community policies       |
| Admin     | The people who run the system            | Everything                                                                                               |

Every role can open the Data Studio. Directus applies the same policies in the Data Studio, through
the API, and through MCP.

`src/directus/roles.ts` declares the roles. Directus's `AUTH_AUTHENTIK_DEFAULT_ROLE_ID` names
Community, so a first sign-in through Authentik makes the user on it. A later sign-in leaves the role
alone, because Directus's OpenID driver writes a role on a later sign-in only when
`AUTH_AUTHENTIK_ROLE_MAPPING` is set, and `backend` never sets it.

Crew is the old Coach role, renamed, so it kept its ID. Directus's own Administrator role holds only
the first admin account, which Directus made when it was set up. The syncs have roles of their own.

Deleting a role leaves its users with no role, so `DirectusRole` refuses to delete one that still
has users.

## Policies

A policy is a named set of permissions. Each role has a policy of its own, which holds its base
permissions, plus any shared policies it's given:

- Community has the Community policies in `stacks/backend/community-rules.ts`: names, contacts,
  family, own children, and the coordinator policies. Own children gives only a child's medical
  information: Directus searches every field a rule grants on any row, so a rule giving a child's
  whole row would let a parent search their child's teammates by their hidden fields.
- Crew has its own rules, in `stacks/backend/policies.ts`, plus every Community policy, so a Crew
  member who is a parent sees what any parent sees.

Groups give the rest. `groupPolicies` in `stacks/backend/policies.ts` declares the policies a group
can give, attached to no role:

| Policy         | Gives                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| CRM Reader     | Reads every CRM collection but medical information                                                   |
| CRM Writer     | Changes every CRM collection but medical information. Clubspot's records and programs stay read-only |
| Medical Reader | Reads every sailor's medical information                                                             |
| Medical Writer | Changes every sailor's medical information                                                           |
| Catalog Reader | Reads the catalog: every collection in `schemas/core.yaml`, programs included                        |
| Catalog Writer | Changes the catalog                                                                                  |
| Plan Reader    | Reads every plan, wages and bonus rates included, and the catalog                                    |
| Plan Writer    | Changes any plan's draft, saves it as a version, and makes a saved version active. Reads the catalog |

They're coarse: whole collections, with no row filters and no hidden fields. A saved plan version never
changes, even for an admin, so the `saved-versions` hook enforces that rather than a policy
(`docs/planning-schema.md`). A Medical policy is
given with a CRM policy. Programs belong to the catalog, so only a Catalog Writer changes them. A CRM
policy reads them, and so do Crew and the Google sync, but none of them changes them.

One field is held back: no policy a person can hold sets a person's login,
`people.directus_user_id`, because the login decides whose groups' policies a user gets. Only an
admin or the group hook sets it. The Clubspot sync's own policy still can, since a merge moves a
duplicate's login onto the person it keeps.

One risk is known and accepted: a CRM Writer can edit guardian links in `contacts`, so they could
make themselves a child's guardian and read that child's medical information. CRM Writers are people
an admin trusts, and the change log is the check.

To add a policy, add a `PolicyData` to `groupPolicies`, or to the list a role gets. `declarePolicy` in
`stacks/backend/index.ts` declares it once, with its rules, and attaches it to each role it's given
to. A role that shares another role's policy gets a `DirectusAccess` link, not a copy.

## Groups

`schemas/access.yaml` holds the groups:

- `groups`: a set of people, such as a committee
- `group_members`: who is in each group, as people in the CRM
- `group_policies`: which policies each group gives

Only admins can see or change them. A group never sets a role.

An admin changes a group from its own page in the Data Studio. Members and Policies are
many-to-many lists: "Add existing" picks a person, or one of the policies a group can give. Neither
list creates a new row, so someone not yet in People is added there first.

The `group-policies` hook (`stacks/backend/group-policies.cjs`) keeps each user's own policy links
equal to what their groups give. It runs after any change to a group, a member, or a grant, when a
user is made, and when a person's email or login changes. It also runs every 15 minutes, to catch a
change that emitted no event, such as a cascade.

- A person's login is `people.directus_user_id`. A group member with none is linked by their email,
  once, and the hook stores the link. So someone added to a group before they first sign in gets its
  policies once they do, and a later change to their email doesn't move their access.
- It links by email only when exactly one person has that email and no person is linked to that
  login yet. Families often share an email, so a shared one links nobody. The hook logs it, and an
  admin links the login by hand.
- It manages only links to the policies a group can give, and only for users on Community, Crew, or
  Admin. It never touches a role, a sync's user, or the first admin account.
- It refuses a `group_policies` row that names any other policy.
- It changes links through Directus's `AccessService`, which clears Directus's permission caches.

A person merge stops while a duplicate is still in a group, since moving a membership changes who
has access. An admin moves the membership by hand, and the next sync finishes the merge. For the
same reason the Clubspot sync never changes the email of someone in a group. It logs the new
address, which it still keeps among the person's other emails.

## The query guard

Directus checks only that a filter's field is readable on some row, and joins a relational filter's
rows without permissions. Once a user has a rule that limits rows, they could use a filter to probe
what that rule hides. The query guard (`stacks/backend/community-query-guard.cjs`) refuses such a
query: a filter, sort, group, or aggregate on a field the user can't read on every row, or a relation
into a collection they can't read every row of. Everything else passes:

- A relational filter or sort passes when every collection on its path is one the user reads whole.
  That holds for `$FOLLOW` too.
- A `deep` query reads its related rows with permissions, as a top-level query does, so its own
  filter and sort get the same checks as one.
- A filter into `directus_users` is refused unless the user is an admin. Directus lets everyone else
  read only their own account, so a filter could probe other people's.

It works from the user's policies, through their role and their own account, so a Crew member can't
probe other sailors' medical information through the rule that shows them their own child's, while a
CRM Writer, who reads everything, isn't held back. A user whose rules never limit rows, such as a
sync, isn't checked. `backend` writes each policy's read rules into the guard's config.
