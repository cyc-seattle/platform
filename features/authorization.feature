Feature: Roles and groups
  Everyone who signs in has one of three roles, which decides what they can do to start with:

  - Community, for the club's families and members, who can see their own children and their
    children's teammates.
  - Crew, for the people an admin trusts with every roster, such as staff, directors, officers, and
    trusted volunteers. They can see every roster, the club's products and revenue accounts, and
    their own children like any other parent.
  - Admin, for the people who run the system.

  A program's roster is everyone signed up for it. A sailor's teammates are the others on their
  roster.

  Anything more than a role gives comes from groups, or from a program role such as Parent
  Coordinator, which only counts in that program. A program role is a role someone has in one
  program. A group, such as the Finance Committee, gives its members one or more policies. A policy
  is a named set of permissions. For example, CRM Writer lets someone add, edit, and delete people
  and their details. An admin manages the groups in the Data Studio: who is in each one, and which
  policies each one gives. To change something means to add, edit, or delete it.

  Groups only give policies to people. They never change anyone's role. The syncs sign in with
  accounts of their own, and the first admin account is the one the system was set up with. Groups
  never change what those accounts can do.

  @pending
  Rule: Everyone who signs in has the Community, Crew, or Admin role

    Example: Everyone who has signed in has one of the three roles
      Given the people in the CRM who have signed in
      When an admin looks up their roles
      Then each of them has the Community, Crew, or Admin role

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
    Example: A volunteer with CRM Writer still can't change roles
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change anyone's role, even their own

  @pending
  Rule: Joining a group gives its policies, and doesn't change the person's role

    Example: A volunteer joins a group that gives CRM Writer
      Given a user with the Crew role
      When an admin adds them to a group that gives the CRM Writer policy
      Then they can change people and their details
      And they still have the Crew role

  @pending
  Rule: Leaving a group takes its policies away

    Example: A volunteer leaves the group
      Given a user in a group that gives the CRM Writer policy
      When an admin takes them out of the group
      Then they can't change people and their details

  @pending
  Rule: When a group stops giving a policy, its members lose it

    Example: The group stops giving CRM Writer
      Given a user in a group that gives the CRM Writer policy
      When an admin changes the group so it no longer gives that policy
      Then they can't change people and their details

  @pending
  Rule: A person keeps a policy as long as any of their groups gives it

    Example: A volunteer leaves one of two groups that give the same policy
      Given a user in two groups that each give the CRM Writer policy
      When an admin takes them out of one of the groups
      Then they can change people and their details

  @pending
  Rule: Changing groups never changes what the syncs or the first admin account can do

    Example: A group can't let the Google sync see medical information
      Given the Google sync's service account
      When an admin adds it to a group that gives the Medical Reader policy
      Then it can't see medical information

    Example: A group can't stop the first admin account from changing people's details
      Given the first admin account
      When an admin adds it to a group that gives the CRM Reader policy
      Then it can change people and their details

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

    Example: A volunteer with CRM Writer still can't change groups
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change groups
