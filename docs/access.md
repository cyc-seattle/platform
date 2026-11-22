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
  matches the signed-in user by their login's person, `directus_users.person_id`, not their email,
  so each of a person's logins sees the same. It gives everyone in their household with their
  details, their children's registrations and medical information, the names of programs and
  program areas, and the list of schools. It reads their own login's `person_id` too, so an app
  finds their row with a filter on `id` for `$CURRENT_USER.person_id`. Directus reads that variable
  with the user's own access in a query, though not in a permission rule.
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
- Community, Team, Crew, and Staff share Sail Team: read, which reads Sail Team's links and
  announcements whole (`schemas/sail-team.yaml`).
- Staff has Crew's policy and the Community policy. Its own policy is empty, for whatever more
  access paid staff are given later.

Groups give the rest. `groupPolicies` in `stacks/backend/policies.ts` declares the policies a group
can give, attached to no role:

| Policy              | Gives                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CRM Reader          | Reads every CRM collection but medical information                                                                     |
| CRM Writer          | Changes every CRM collection but medical information. Clubspot's records and programs stay read-only                   |
| Medical Reader      | Reads every sailor's medical information                                                                               |
| Medical Writer      | Changes every sailor's medical information                                                                             |
| Catalog Reader      | Reads the catalog: every collection in `schemas/core.yaml`, programs included, and the directory                       |
| Catalog Writer      | Changes the catalog, and reads the directory                                                                           |
| Plan Reader         | Reads every plan, wages and bonus rates included, the catalog, and users' names                                        |
| Plan Writer         | Starts and deletes a draft Financial Plan, and changes any Program Plan in a draft. Reads what Plan Reader does        |
| Plan Admin          | Changes the Operations Plan in a draft, and a Financial Plan's plans; freezes, dates, and archives one. Reads the same |
| Link Writer         | Changes Sail Team's links, but not their previews                                                                      |
| Announcement Writer | Changes Sail Team's announcements                                                                                      |
| FreeScout Agent     | Signs in to FreeScout, the shared inbox. Nothing in Directus                                                           |
| Listmonk Write      | Signs in to Listmonk with its Write role: writes and tests newsletters, and manages subscribers. Nothing in Directus   |
| Listmonk Send       | Signs in to Listmonk with its Send role: Listmonk Write's, and sends newsletters. Nothing in Directus                  |

They're coarse: whole collections, with no row filters and no hidden fields, but for users and link
previews: a Plan policy reads only each user's first and last name, so a frozen Financial Plan names
who froze it, and a Link Writer can't write a link's preview.
And the planners' writes split by the kind of plan a row is in (cyc-seattle/platform#251). A Plan
Admin is given with Plan Writer. A Plan Writer changes a row only in a Program Plan, through the one many-to-one path
`plan_id.kind`, and none of the collections only an Operations Plan uses
(`OPERATIONS_ONLY`), such as rates, staff levels, pools, terms, and bonuses. On a Financial Plan it sets
only the name, note, and parent, and on a Program Plan only its notes. A Plan Admin changes a row only in an Operations Plan, and a
Financial Plan's status, the date it's active from, and whether it's archived. Every Plan Writer reads
and writes every program area: there's no per-area access. A
frozen Financial Plan never changes, even for an admin, so the `frozen-plans` hook enforces that
rather than a policy (`docs/planning-schema.md`). A Medical policy is given with a CRM policy.
Programs belong to the catalog, so only a Catalog Writer changes them. A CRM policy reads them, and
so do Crew and the Google sync, but none of them changes them. The directory, `schemas/directory.yaml`, is the organizations and venues; every catalog and plan policy reads it, and only an admin changes it.

One field is held back: no policy a person can hold sets a login's person,
`directus_users.person_id`, or the list of a person's logins, `people.logins`, because a login's
person decides whose family and groups' policies it gets. Only an admin or the group hook sets it.
The Clubspot sync's own policy moves a linked login, since a merge moves a duplicate's logins onto
the person it keeps.

One risk is known and accepted: a CRM Writer can edit guardian links in `contacts`, so they could
make themselves a child's guardian and read that child's medical information. CRM Writers are people
an admin trusts, and the change log is the check.

To add a policy, add a `PolicyData` to `groupPolicies`, or to the list a role gets. `declarePolicy` in
`stacks/backend/index.ts` declares it once, with its rules, and attaches it to each role it's given
to. A role that shares another role's policy gets a `DirectusAccess` link, not a copy.

## Link previews

Each link on Sail Team's Links page shows a card for the page it leads to, the way a social
network does. Browsers can't read another site's page, so the `link-preview` hook
(`stacks/backend/link-preview.cjs`) does: after a link is added, or its address saved, it reads the
page's Open Graph title, description, and picture, or its `<title>` and description when it has none,
into the link's `preview_*` fields and sets `previewed_at`. It never holds up or fails the save.

Directus reads the page from inside the cluster, so the hook reads only an https page on port 443
whose host resolves to a public address, checked again on each of at most 3 redirects. It stops
after 5 seconds or 512 KB, and keeps a picture only at an https address. A page it can't read leaves
the preview empty and `previewed_at` null, and saving the address again retries. Only the hook writes
the preview: a Link Writer's rules leave those fields out.

## Seeing what someone sees

An admin can sign in as someone else to check what they see, in sail-team or the Data Studio, through
Authentik's impersonation:

1. In Authentik's admin interface, under Directory, then Users, choose Impersonate on the person, and
   give a reason.
2. Sign out of the Data Studio, then open sail-team. Directus signs you in as them.
3. When you're done, choose Sign out in sail-team's menu under their name, then sign in as yourself.
   It ends the Directus session, then Authentik's (`/flows/-/default/invalidation/` on the `login.`
   host, the login brand's sign-out flow), which ends the impersonation with it.

Authentik's own Stop impersonation button is only in its user and admin interfaces, and the
`login.` host sends its user interface on to sail-team, so you won't see it. To stop without signing
out of Authentik, open `/api/v3/core/users/impersonate_end/` on the `login.` host in the same browser,
which is what that button calls, then sign out of Directus, whose session as them outlasts the
impersonation.

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

The token is in Secret Manager for the build to read: `csc-website-directus-token`. Dev's Website
Build user has its own, `dev-csc-website-directus-token`, which `infra` generates, since `deploy-dev`
can't write a secret. The site has no PR previews, so no build reads dev's.

## Groups

`schemas/access.yaml` holds the groups:

- `groups`: a set of people, such as a committee
- `group_members`: who is in each group, as people in the CRM
- `group_policies`: which policies each group gives

Only admins can see or change them. A group never sets a role. A group can also fill a Google
Group, which the Google sync keeps equal to its members ([syncs.md](syncs.md#gsuite-sync)).

An admin changes a group from its own page in the Data Studio. Members and Policies are
many-to-many lists: "Add existing" picks a person, or one of the policies a group can give. Neither
list creates a new row, so someone not yet in People is added there first.

The `group-policies` hook (`stacks/backend/group-policies.cjs`) keeps each user's own policy links
equal to what their groups give. It runs after any change to a group, a member, or a grant, when a
user or person is made or a person deleted, when a login's role, email, or person changes, and when
a person's email, logins, or name changes. It also runs every 15
minutes, to catch a change that emitted no event, such as a cascade.

- A login's person is `directus_users.person_id`, and a person can have any number of logins, such
  as someone who signs in with a personal and a work email. Each login gets the person's groups'
  policies. A login with no person is linked by its email, once, and the hook stores the link. So
  someone added to a group before they first sign in gets its policies once they do, and a later
  change to their email doesn't move their access.
- It links every signed-in user this way, not only group members, since the Community rules match
  by a login's person.
- It links by email only a person's first login: when exactly one person has that email, or when
  everyone else with the email is that person's child, and that person has no login yet. Otherwise
  it links nobody, logs it, and an admin links the login by hand. Anyone can sign up, and a CRM
  Writer or the Clubspot sync can change a person's email, so linking a second login by email would
  hand the person's access to whoever signs in with the new address. An admin links every second
  login, such as a Workspace alias or a work email, from the login's page or the person's Logins.
  It never moves a linked login by email.
- Deleting a person empties their logins' `person_id`, and keeps the logins.
- It manages only links to the policies a group can give, and only for users on Community, Team,
  Crew, Staff, or Admin. It never touches a sync's user or the first admin account.
- It moves each Community login whose person is on a team to Team, and a Team user who isn't back to
  Community. It never changes Crew, Staff, or Admin. Registrations, offerings, programs, and contacts set it
  off too, and the 15-minute run closes the 12-month window as time passes.
- It gives each user their person's first and last name, so the Data Studio, comments, and
  revisions show a name, not an email. People is the source of truth, so the next run puts back a
  name changed on the user.
- It removes any other policy linked straight to one of those users, so a policy comes only from a
  role or a group.
- It refuses a `group_policies` row that names any other policy.
- It changes links through Directus's `AccessService`, which clears Directus's permission caches.

A person merge stops while a duplicate is still in a group, since moving a membership changes who
has access. An admin moves the membership by hand, and the next sync finishes the merge. For the
same reason the Clubspot sync never changes the email of someone in a group. It logs the new
address, which it still keeps among the person's other emails.

## Signing in to other apps

Who may sign in to another app is a policy, named for what it lets someone do there, and an admin
gives it through a group like any other: FreeScout Agent, Listmonk Write, and Listmonk Send
(`SIGN_IN_POLICIES` in `stacks/backend/policies.ts`). It allows nothing in Directus. No role gives
one, Admin included.

The `authentik` stack makes an Authentik group of each one's name, and each app lets in only its
groups. The `group-policies` hook keeps each group's members equal to the active logins whose person
holds the policy, on the same passes as the policy links, so someone added to a group in Authentik by
hand is taken out, and so is a suspended login. It matches an Authentik account by its email, so
someone who has never signed in has none, and joins on the first pass after they do. It takes people
out of a group before adding anyone. Authentik is a copy: a group it can't update is logged, the
others still are, and the next pass catches it up. If Directus has none of the policies a group can
give, the hook changes no links and no sign-in group, and warns.

Any change to a sign-in group in the `authentik` stack, such as a new name, replaces it with an
empty one, which the hook fills on its next pass, within 15 minutes. Updating it in place would send
back the members Pulumi last saw.

The hook signs in to Authentik as the `directus-access-sync` service account, whose token the
`authentik` stack writes to the `directus-authentik-access` Secret. Directus mounts the Secret
optionally, since `backend` deploys first, and the hook reads it on each pass. The account sees
users, and adds to and takes out of only the sign-in groups: it can't touch a superuser group.

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
- A filter on `people.id` passes, since every rule shows it, so an app finds the user's own row
  with `$CURRENT_USER.person_id`. A filter on a person's logins is refused.
- A filter into `directus_users` is refused unless the user is an admin. Directus lets everyone else
  read only their own account, so a filter could probe other people's.

It works from the user's policies, through their role and their own account, so a Crew member can't
probe other sailors' medical information through the rule that shows them their own child's, while a
CRM Writer, who reads everything, isn't held back. A user whose rules never limit rows, such as a
sync, isn't checked. `backend` writes each policy's read rules into the guard's config.
