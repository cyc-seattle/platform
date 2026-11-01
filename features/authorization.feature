Feature: Roles and groups
  Everyone who signs in has one of four roles, which decides what they can do to start with:

  - Community, for the club's families and members, who can see their own family.
  - Team, for the families on a team, who can also see everyone on every team.
  - Crew, for the people an admin has vetted and trusts with every roster, such as staff, coaches,
    directors, officers, and trusted volunteers. They can see every roster, everyone's contact
    details and medical information, and the club's products and revenue accounts.
  - Admin, for the people who run the system.

  A team is a program the club marks as one, such as a race team. A program's roster is everyone
  signed up for it. A sailor is on a team from when they sign up for it until 12 months after their
  last time on it ends, and a sailor's parents are on the team with them.

  Anything more than a role gives comes from groups. A group, such as the Finance Committee, gives
  its members one or more policies. A policy is a named set of permissions. For example, CRM Writer lets someone add, edit, and delete people
  and their details. An admin manages the groups in the Data Studio: who is in each one, and which
  policies each one gives. To change something means to add, edit, or delete it.

  Groups only give policies to people. They never change anyone's role. The syncs sign in with
  accounts of their own, and the first admin account is the one the system was set up with. Groups
  never change what those accounts can do.

  Rule: Everyone who signs in has the Community, Team, Crew, or Admin role

    Example: Everyone who has signed in has one of the four roles
      Given the people in the CRM who have signed in
      When an admin looks up their roles
      Then each of them has the Community, Team, Crew, or Admin role

  @pending
  Rule: A family on a team has the Team role, and goes back to Community once they're no longer on one

    Example: A parent whose child signs up for a team becomes Team
      Given a user with the Community role
      When their child signs up for a team
      Then they have the Team role

    Example: An adult sailor who signs up for a team becomes Team
      Given a user with the Community role
      When they sign up for a team
      Then they have the Team role

    Example: A parent whose child's last time on a team ended a month ago is still Team
      Given a user with the Team role
      When their child's last time on a team ended a month ago
      Then they still have the Team role

    Example: A parent whose child's last time on a team ended 13 months ago goes back to Community
      Given a user with the Team role
      When their child's last time on a team ended 13 months ago
      Then they have the Community role

  @pending
  Rule: Joining or leaving a team never changes a Crew member's or an admin's role

    Scenario Outline: A Crew member or admin whose child signs up for a team keeps their role
      Given a user with the <role> role
      When their child signs up for a team
      Then they still have the <role> role

      Examples:
        | role  |
        | Crew  |
        | Admin |

  Rule: Only an admin can change someone's role, apart from moving families between Community and Team

    Example: An admin makes a volunteer Crew
      Given a user with the Community role
      When an admin gives them the Crew role
      Then they have the Crew role
      And they can see the rosters

    Scenario Outline: No other role can change anyone's role, even their own
      Given a user with the <role> role
      Then they can't change anyone's role, even their own

      Examples:
        | role      |
        | Community |
        | Crew      |

    Example: A volunteer with CRM Writer still can't change roles
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change anyone's role, even their own

    @pending
    Example: A Team member can't change anyone's role
      Given a user with the Team role
      Then they can't change anyone's role, even their own

  Rule: Joining a group gives its policies, and doesn't change the person's role

    Example: A volunteer joins a group that gives CRM Writer
      Given a user with the Crew role
      When an admin adds them to a group that gives the CRM Writer policy
      Then they can change people and their details
      And they still have the Crew role

  Rule: Leaving a group takes its policies away

    Example: A volunteer leaves the group
      Given a user in a group that gives the CRM Writer policy
      When an admin takes them out of the group
      Then they can't change people and their details

  Rule: When a group stops giving a policy, its members lose it

    Example: The group stops giving CRM Writer
      Given a user in a group that gives the CRM Writer policy
      When an admin changes the group so it no longer gives that policy
      Then they can't change people and their details

  Rule: A person keeps a policy as long as any of their groups gives it

    Example: A volunteer leaves one of two groups that give the same policy
      Given a user in two groups that each give the CRM Writer policy
      When an admin takes them out of one of the groups
      Then they can change people and their details

  Rule: Changing groups never changes what the syncs or the first admin account can do

    Example: A group can't let the Google sync see medical information
      Given the Google sync's service account
      When an admin adds it to a group that gives the Medical Reader policy
      Then it can't see medical information

    Example: A group can't stop the first admin account from changing people's details
      Given the first admin account
      When an admin adds it to a group that gives the CRM Reader policy
      Then it can change people and their details

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

    @pending
    Example: A Team member can't change groups
      Given a user with the Team role
      Then they can't change groups
