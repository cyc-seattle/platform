# Who can do what

`features/authentication.feature` and `features/authorization.feature` give the rules. This page says
how `backend` builds them.

## Roles

Everyone who signs in has one of five roles. A role gives base access. The `group-policies` hook
moves families between Community and Team, and only an admin changes any other role, by hand in the
Data Studio.

| Role      | Who                                   | What it gives                                                                                                                                 |
| --------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Community | Everyone, on their first sign-in      | Their own household                                                                                                                           |
| Team      | Households on a team, set by the hook | The Community policy, everyone on every team by name and sailors by school, and the email and phone of team adults who chose to share         |
| Crew      | People an admin vets and trusts       | Every roster, everyone's contact details and medical information, the catalog's money and the Google Groups to read, and the Community policy |
| Staff     | Paid staff                            | Everything Crew has                                                                                                                           |
| Admin     | The people who run the system         | Everything                                                                                                                                    |

A team is a program with `team` set. Someone is on a team while they have a confirmed registration in
one of its offerings that hasn't ended, or ended less than 12 months ago, and a sailor's guardians are
on the team with them.

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

- Community has one policy, Community: own family, in `stacks/backend/community-rules.ts`. It
  matches the signed-in user by their login, `people.directus_user_id`, not their email. It gives
  everyone in their household with their details, their children's registrations and medical
  information, the names of programs and program areas, and the list of schools. It reads their own
  login too, so an app finds their row with a filter on `directus_user_id` for `$CURRENT_USER`.
  Anyone in a household, a child who signs in too, changes anyone in it's `display_name`, `phone`,
  `school_id`, and `school`. Only an adult changes whether it shares, `households.share_contact`.

  An adult is someone 18 or over, or with no date of birth who is someone's guardian. A teen with no
  date of birth listed as a sibling's guardian counts as one too: Directus refuses `_none`, which
  ruling them out needs, in a permission rule.

  No one in a household changes an email, a date of birth, or who's in it. The group-policies hook links a login to a person by email,
  so changing one could hand someone else's person to a stranger. Who's in a household is Clubspot's,
  through the sync. Medical information follows guardian links, never the household.

- A program role, such as Parent Coordinator, gives no access. It only sets Google Groups.
- Team has the Community policy, plus Team: names, Team: contacts, and Team: schools. Names cover every team's
  sailors and their parents, and which parent belongs to which sailor, whether they shared or not. A
  team member's email and phone show only if they're an adult, or a guardian not known to be under
  18, whose household's `share_contact` is yes. A child's own never show. Names also cover each team's program area and
  Google Group, which sail-team's rosters group and link teams by. Schools cover each sailor's school, but not
  their parents'.
- Crew has its own rules, in `stacks/backend/policies.ts`, plus the Community policy, so a Crew
  member who is a parent sees what any parent sees. It reads every person, contact, contact point,
  medical profile, offering, and registration, but not Clubspot's sign-up answers or payments.
- Staff has Crew's policy and the Community policy. Its own policy is empty, for whatever more
  access paid staff are given later.

Groups give the rest. `groupPolicies` in `stacks/backend/policies.ts` declares the policies a group
can give, attached to no role:

| Policy           | Gives                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| CRM Reader       | Reads every CRM collection but medical information                                                                    |
| CRM Writer       | Changes every CRM collection but medical information. Clubspot's records and programs stay read-only                  |
| Medical Reader   | Reads every sailor's medical information                                                                              |
| Medical Writer   | Changes every sailor's medical information                                                                            |
| Catalog Reader   | Reads the catalog: every collection in `schemas/core.yaml`, programs included, and the directory                      |
| Catalog Writer   | Changes the catalog, and reads the directory                                                                          |
| Inventory Reader | Reads CSC's boats, charters, damage and storage, the boat classes and products they name, and sailors' names          |
| Inventory Writer | Changes the inventory, and moves a boat to its next stage. Reads what Inventory Reader does                           |
| Plan Reader      | Reads every plan, wages and bonus rates included, the catalog, and users' names                                       |
| Plan Writer      | Changes any plan's draft, saves it as a version, and makes a saved version active. Reads the catalog and users' names |

They're coarse: whole collections, with no row filters and no hidden fields, but for users: a Plan
policy reads only each user's first and last name, so a saved Financial Plan names who saved it. An
Inventory policy reads only each person's name. A
saved plan version never changes, even for an admin, so the `saved-versions` hook enforces that
rather than a policy (`docs/planning-schema.md`). A Medical policy is given with a CRM policy.
Programs belong to the catalog, so only a Catalog Writer changes them. A CRM policy reads them, and
so do Crew and the Google sync, but none of them changes them. The directory, `schemas/directory.yaml`, is the organizations and venues; every catalog and plan policy reads it, and only an admin changes it.

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

## Seeing what someone sees

An admin can sign in as someone else to check what they see, in sail-team or the Data Studio, through
Authentik's impersonation:

1. In Authentik's admin interface, under Directory, then Users, choose Impersonate on the person, and
   give a reason.
2. Sign out of the Data Studio, then open sail-team. Directus signs you in as them.
3. When you're done, stop impersonating in Authentik, and sign out of Directus again. The Directus
   session as them outlasts the impersonation.

Look, don't change. Directus records anything changed this way as theirs. Authentik records who
impersonated whom, when, and why, in its event log. Someone who has never signed in has no Authentik
account yet, so they can't be impersonated until they do.

The `authentik` stack makes everyone in `backend:directusAdmins` a member of its `Admins` group, an
Authentik superuser, once they've signed in. The permission to impersonate alone would be no
narrower, since it lets its holder impersonate a superuser.

## The website build

cyc-seattle/csc-website builds the public website from Directus ([website.md](website.md)). Its build
signs in as the Website Build machine user, with a static token `backend` generates. Its policy reads
every `website_*` collection whole, and the files in the Website folder, and nothing else: anything it
can read could end up on the public site. `features/website.feature` gives the rule.

Anything in the Website folder is public: never put a file there that the public website shouldn't show.

The token is in Secret Manager for the build to read: `csc-website-directus-token` in prod, and
`dev-csc-website-directus-token` in dev, which `infra` generates, since `deploy-dev` can't write a
secret.

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
user or person is made, and when a person's email, login, or name changes. It also runs every 15
minutes, to catch a change that emitted no event, such as a cascade.

- A person's login is `people.directus_user_id`. A group member with none is linked by their email,
  once, and the hook stores the link. So someone added to a group before they first sign in gets its
  policies once they do, and a later change to their email doesn't move their access.
- It links every signed-in user's person this way, not only group members', since the Community
  rules match by login.
- It links by email only when exactly one person has that email and no person is linked to that
  login yet, or when everyone else with the email is that person's child. Otherwise a shared email
  links nobody. The hook logs it, and an admin links the login by hand.
- It manages only links to the policies a group can give, and only for users on Community, Team,
  Crew, Staff, or Admin. It never touches a sync's user or the first admin account.
- It moves a Community user whose person is on a team to Team, and a Team user who isn't back to
  Community. It never changes Crew, Staff, or Admin. Registrations, offerings, programs, and contacts set it
  off too, and the 15-minute run closes the 12-month window as time passes.
- It gives each user their person's first and last name, so the Data Studio, comments, and
  revisions show a name, not an email. People is the source of truth, so the next run puts back a
  name changed on the user.
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
- A filter of `people.directus_user_id` equal to the user's own login passes. It can match only their
  own row, so it reveals nothing, and any other filter on a login is refused.
- A filter into `directus_users` is refused unless the user is an admin. Directus lets everyone else
  read only their own account, so a filter could probe other people's.

It works from the user's policies, through their role and their own account, so a Crew member can't
probe other sailors' medical information through the rule that shows them their own child's, while a
CRM Writer, who reads everything, isn't held back. A user whose rules never limit rows, such as a
sync, isn't checked. `backend` writes each policy's read rules into the guard's config.
