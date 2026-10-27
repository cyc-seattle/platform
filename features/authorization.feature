Feature: Roles and groups
  Everyone who signs in has one of three roles, which decides what they can do to start with:

  - Community, for the club's families and members, who can see their own children and their
    children's teammates.
  - Crew, for coaches and volunteers, who can see the rosters they run programs from, and their own
    children like any other parent.
  - Admin, for the people who run the system.

  Anything more, such as editing the CRM or planning a season, comes from groups. A group, such as
  the Finance Committee, gives its members one or more policies. A policy is a named set of
  permissions. For example, CRM Writer lets someone add, edit, and delete people in the CRM. An admin
  manages the groups in the Data Studio: who is in each one, and which policies each one gives.

  Groups only give policies to people. They never change anyone's role. They also never change the
  accounts the syncs sign in with, or the admin account the system was set up with.

  @pending
  Rule: Everyone who signs in has the Community, Crew, or Admin role

    Example: No one has any other role
      Then everyone who signs in has the Community, Crew, or Admin role

  Rule: Only an admin can change someone's role

    @pending
    Example: An admin makes a volunteer Crew
      Given a user with the Community role
      When an admin gives them the Crew role
      Then they have the Crew role
      And they can see the rosters

    @pending
    Scenario Outline: No other role can change anyone's role, even their own
      Given a user with the <role> role
      Then they can't change anyone's role, even their own

      Examples:
        | role      |
        | Community |
        | Crew      |

    @pending
    Example: A volunteer who can edit the CRM still can't change roles
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change anyone's role, even their own

  @pending
  Rule: Joining a group gives its policies, and doesn't change the person's role

    Example: A volunteer joins a group that can edit the CRM
      Given a user with the Crew role
      When an admin adds them to a group that gives the CRM Writer policy
      Then they can change the CRM
      And they still have the Crew role

  @pending
  Rule: Leaving a group takes its policies away

    Example: A volunteer leaves the group
      Given a user in a group that gives the CRM Writer policy
      When an admin takes them out of the group
      Then they can't change the CRM

  @pending
  Rule: When a group stops giving a policy, its members lose it

    Example: The group stops giving CRM Writer
      Given a user in a group that gives the CRM Writer policy
      When an admin changes the group so it no longer gives that policy
      Then they can't change the CRM

  @pending
  Rule: A person keeps a policy as long as any of their groups gives it

    Example: A volunteer leaves one of two groups that give the same policy
      Given a user in two groups that each give the CRM Writer policy
      When an admin takes them out of one of the groups
      Then they can change the CRM

  @pending
  Rule: Groups never change the syncs' accounts or the original admin account

    Example: Changing a group leaves the syncs' accounts and the original admin account alone
      Given a user with the Crew role
      When an admin adds them to a group that gives the CRM Writer policy
      Then the syncs' accounts still have the same role and policies
      And so does the admin account the system was set up with

  @pending
  Rule: Only an admin can change groups

    Example: An admin can change groups, who is in them, and what they give
      Given a user with the Admin role
      Then they can change groups

    Scenario Outline: No other role can change groups
      Given a user with the <role> role
      Then they can't change groups

      Examples:
        | role      |
        | Community |
        | Crew      |

    Example: A volunteer who can edit the CRM still can't change groups
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change groups
