# Who can do what

`features/authentication.feature` and `features/authorization.feature` give the rules. This page says
how `backend` builds them.

## Roles

Everyone who signs in has one of three roles. A role gives base access, and only an admin changes
it, by hand in the Data Studio.

| Role      | Who                                      | What it gives                                                                                            |
| --------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Community | Everyone, on their first sign-in         | Their own children, their children's teammates, and what a program role such as Parent Coordinator gives |
| Crew      | People an admin trusts with every roster | Every roster, the products and revenue accounts to read, and the Community policies                      |
| Admin     | The people who run the system            | Everything                                                                                               |

Every role can open the Data Studio. Directus applies the same policies in the Data Studio, through
the API, and through MCP.

`src/directus/roles.ts` declares the roles. Directus's `AUTH_AUTHENTIK_DEFAULT_ROLE_ID` names
Community, so a first sign-in through Authentik makes the user on it. A later sign-in leaves the role
alone, because Directus's OpenID driver writes a role on a later sign-in only when
`AUTH_AUTHENTIK_ROLE_MAPPING` is set, and `backend` never sets it.

Crew is the old Coach role, renamed, so it kept its ID. Directus's own Administrator role holds only
the first admin account, which Directus made when it was set up. The syncs have roles of their own.

Staff and Guardian were roles until cyc-seattle/workplace#6 step 8a. Staff is kept, retired, until
its users have moved to Crew. Deleting a role leaves its users with no role, so `DirectusRole`
refuses to delete one that still has users.

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

| Policy         | Gives                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| CRM Reader     | Reads every CRM collection but medical information                                          |
| CRM Writer     | Changes every CRM collection but medical information. Clubspot's own records stay read-only |
| Medical Reader | Reads every sailor's medical information                                                    |
| Medical Writer | Changes every sailor's medical information                                                  |

They're coarse: whole collections, with no row filters and no hidden fields. A Medical policy is
given with a CRM policy.

To add a policy, add a `PolicyData` to `groupPolicies`, or to the list a role gets. `declarePolicy` in
`stacks/backend/index.ts` declares it once, with its rules, and attaches it to each role it's given
to. A role that shares another role's policy gets a `DirectusAccess` link, not a copy.

## Groups

`schemas/access.yaml` holds the groups:

- `groups`: a set of people, such as a committee
- `group_members`: who is in each group, as people in the CRM
- `group_policies`: which policies each group gives

Only admins can see or change them. A group never sets a role.

The `group-policies` hook (`stacks/backend/group-policies.cjs`) keeps each user's own policy links
equal to what their groups give. It runs after any change to a group, a member, or a grant, when a
user is made, and when a person's email or login changes. It also runs every 15 minutes, to catch a
change that emitted no event, such as a cascade.

- A person's login is `people.directus_user_id`, or else the user with their email. So someone added
  to a group before they first sign in gets its policies once they do.
- It manages only links to the policies a group can give, and only for users on Community, Crew,
  Admin, or the retired Staff. It never touches a role, a sync's user, the first admin account, or
  an admin's own admin grant.
- It refuses a `group_policies` row that names any other policy.
- It changes links through Directus's `AccessService`, which clears Directus's permission caches.

A person merge stops while a duplicate is still in a group, since moving a membership changes who
has access. An admin moves the membership by hand, and the next sync finishes the merge.

## The query guard

Directus checks only that a filter's field is readable on some row, and joins a relational filter's
rows without permissions. Once a user has a rule that limits rows, they could use a filter to probe
what that rule hides. The query guard (`stacks/backend/community-query-guard.cjs`) refuses such a
query: a filter, sort, group, or aggregate on a field the user can't read on every row, or a relation
into a collection they can't read every row of.

It works from the user's policies, through their role and their own account, so a Crew member can't
probe other sailors' medical information through the rule that shows them their own child's, while a
CRM Writer, who reads everything, isn't held back. A user whose rules never limit rows, such as a
sync, isn't checked. `backend` writes each policy's read rules into the guard's config.

## Moving to these roles

`scripts/migrate-roles.ts` moves an environment's users onto the three roles, after the deploy that
built them (cyc-seattle/workplace#6 step 8a). It's a dry run without `--apply`, and safe to run
again:

- A Guardian user becomes Community. This step works before the deploy too.
- A Staff user is linked to their person in the CRM, or one is added. They join the Staff group,
  which gives CRM Writer and Medical Writer. Once the hook has given those, they become Crew. The
  script checks that their new access covers their old, and puts them back on Staff if it doesn't.
- Coaches are Crew already. Admins stay Admin.

For prod, back up Directus's database first, then:

1. `PULUMI_STACK=prod mise exec -- node scripts/migrate-roles.ts`, before the deploy. It counts users by role.
2. If it finds Guardian users, `PULUMI_STACK=prod mise exec -- node scripts/migrate-roles.ts --apply`, so the deploy's
   deletion of Guardian leaves no one without a role.
3. Deploy.
4. `PULUMI_STACK=prod mise exec -- node scripts/migrate-roles.ts --apply`. Check the census it prints after: no one left
   on Staff, Coach, Guardian, or no role.
5. Check that each admin can still sign in to the Data Studio as an admin.

A later PR deletes the Staff role and the admins' own admin grants.
