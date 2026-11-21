Feature: Roles and groups
  Everyone who signs in has one of five roles, which decides what they can do to start with:

  - Community, for the club's families and members, who can see their own family.
  - Team, for the families on a team, who can also see everyone on every team.
  - Crew, for the people an admin has vetted and trusts with every roster, such as staff, coaches,
    directors, officers, and trusted volunteers. They can see every roster, everyone's contact
    details and medical information, and the club's products and revenue accounts.
  - Staff, for paid staff, who can do everything Crew can.
  - Admin, for the people who run the system.

  A team is a program the club marks as one, such as a race team. A program's roster is everyone
  signed up for it. A sailor is on a team from when they sign up for it until 12 months after their
  last time on it ends, and a sailor's parents are on the team with them.

  Anything more than a role gives comes from groups. A group gives
  its members one or more policies. A policy is a named set of permissions. For example, CRM Writer lets someone add, edit, and delete people
  and their details. An admin manages the groups in the Data Studio: who is in each one, and which
  policies each one gives. To change something means to add, edit, or delete it.

  Some policies let their holders sign in to another app, and give nothing in the Data Studio:
  FreeScout Agent signs in to FreeScout, the shared inbox, and Listmonk Write and Listmonk Send sign
  in to Listmonk, the newsletter. A policy comes only from a role or a group, so an admin gives these
  through a group too, and nobody gives them in Authentik, the sign-in service, itself.

  Some people sign in with more than one email, and each is a login of its own. Each login a person
  has gets everything the person does: their family, their role, and their groups' policies. A
  person's first login is linked to them by its email, and an admin links any other.

  Groups only give policies to people. They never change anyone's role. The syncs sign in with
  accounts of their own, and the first admin account is the one the system was set up with. Groups
  never change what those accounts can do.

  Rule: Everyone who signs in has the Community, Team, Crew, Staff, or Admin role

    Example: Everyone who has signed in has one of the five roles
      Given the people in the CRM who have signed in
      When an admin looks up their roles
      Then each of them has the Community, Team, Crew, Staff, or Admin role

  Rule: Each of a person's logins sees their family and gets their groups' policies

    Example: Someone who signs in with two emails sees their household with either
      Given a person who signs in with two emails, with a child in their household
      When they look up the people they can see with each email
      Then each email shows themselves and their child, and no one else

    Example: Someone who signs in with two emails gets their group's policies with either
      Given a person who signs in with two emails, in a group that gives the CRM Writer policy
      When they sign in with their second email
      Then they can change people and their details
      And both of their logins have the CRM Writer policy

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

  Rule: Joining or leaving a team never changes the role of Crew, Staff, or an admin

    Scenario Outline: Crew, Staff, or an admin whose child signs up for a team keeps their role
      Given a user with the <role> role
      When their child signs up for a team
      Then they still have the <role> role

      Examples:
        | role  |
        | Crew  |
        | Staff |
        | Admin |

  Rule: Only an admin can change someone's role, apart from moving families between Community and Team

    Example: An admin makes a volunteer Crew
      Given a user with the Community role
      When an admin gives them the Crew role
      Then they have the Crew role
      And they can see the rosters

    Example: An admin makes a paid staffer Staff
      Given a user with the Community role
      When an admin gives them the Staff role
      Then they have the Staff role
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

    Example: A Team member can't change groups
      Given a user with the Team role
      Then they can't change groups

  Rule: A group can let its members sign in to another app

    Example: A volunteer in a group that gives FreeScout Agent can sign in to FreeScout
      Given someone who has signed in, in a group that gives the FreeScout Agent policy
      Then they can sign in to FreeScout

    Example: Leaving the group stops them signing in
      Given someone who has signed in, in a group that gives the FreeScout Agent policy
      When an admin takes them out of the group
      Then they can't sign in to FreeScout

    Example: Someone let in by hand in Authentik is taken out
      Given someone who has signed in with the Community role, in no group
      And an Authentik admin adds them by hand to the people who can sign in to FreeScout
      When the access sync runs
      Then they can't sign in to FreeScout

    Example: An admin in no such group can't sign in to Listmonk
      Given someone who has signed in with the Admin role, in no group
      When the access sync runs
      Then they can't sign in to Listmonk

  Rule: A policy comes only from a role or a group

    Example: The Crew role's policy linked straight to someone's login is taken away
      Given a user with the Community role
      When an admin links the Crew role's policy straight to their login
      Then they can't see the rosters
