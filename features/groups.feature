Feature: How groups grant access
  Beyond their role, a person's access comes from the groups they're in. A group, such as the
  Finance Committee, grants one or more policies. A policy is a set of things its holders may see or
  change, such as CRM Writer or Plan Reader. An admin keeps the groups, their members, and what each
  grants, in the Data Studio. A group's members are people in the CRM, so someone added to a group
  before they ever sign in gets its access when they first do. Groups grant policies to people only:
  they never set a role, and they never touch the syncs' service accounts or the admin account the
  platform was set up with.

  @pending
  Rule: Joining a group grants its policies, and leaves the person's role alone

    Example: A volunteer joins a group that keeps the CRM
      Given a user with the Crew role
      When an admin adds them to a group that grants the CRM Writer policy
      Then they can change the CRM
      And they still hold the Crew role

  @pending
  Rule: Leaving a group takes its policies away

    Example: A volunteer leaves the group
      Given a user in a group that grants the CRM Writer policy
      When an admin removes them from the group
      Then they can't change the CRM

  @pending
  Rule: A group that stops granting a policy takes it from every member

    Example: The group stops granting CRM Writer
      Given a user in a group that grants the CRM Writer policy
      When an admin stops the group granting it
      Then they can't change the CRM

  @pending
  Rule: A person keeps a policy while any of their groups grants it

    Example: A volunteer leaves one of two groups that grant the same policy
      Given a user in two groups that each grant the CRM Writer policy
      When an admin removes them from one of the groups
      Then they can change the CRM

  @pending
  Rule: Someone added to a group before they first sign in gets its policies when they do

    Example: A new committee member signs in for the first time
      Given a person in the CRM who has never signed in, in a group that grants the CRM Writer policy
      When they sign in for the first time
      Then they can change the CRM
      And they hold the Community role

  @pending
  Rule: Groups never change the syncs' service accounts or the setup admin

    Example: Editing a group leaves the service accounts and the setup admin as they were
      Given a user with the Crew role
      When an admin adds them to a group that grants the CRM Writer policy
      Then clubspot-sync's and gsuite-sync's service accounts keep their roles and policies
      And so does the admin account the platform was set up with

  @pending
  Rule: Only an admin keeps groups

    Example: An admin keeps groups, their members, and their grants
      Given a user with the Admin role
      Then they can change groups

    Scenario Outline: No other role keeps groups
      Given a user with the <role> role
      Then they can't change groups

      Examples:
        | role      |
        | Community |
        | Crew      |

    Example: Keeping the CRM doesn't let a volunteer keep groups
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change groups
