@licensed
Feature: Signing in
  Staff, coaches, volunteers, and families all sign in with an email address. When someone signs in,
  the club looks them up in the CRM by their email address, and that tells the club who they are and
  whose children are theirs. Everyone who signs in can open the Data Studio, the website where
  the club looks at and changes its data. Families mostly use the roster page on cycsail.team instead.

  What someone can do once they're signed in depends on their role and their groups (see "Roles and
  groups").

  Rule: Signing in finds a person in the CRM by their email, even if they type it in capitals

    Example: A parent who types their email in capitals still sees their child's team
      Given a parent in the CRM whose child sails on a team
      When they sign in, typing their email in capitals
      Then they see their child's team

    Example: Someone whose email isn't in the CRM sees no one
      Given a user with the Community role whose email isn't in the CRM
      When they look at the roster
      Then they see no one

  @pending
  Rule: Someone signing in for the first time gets the Community role

    Example: A parent signs in for the first time
      Given a person in the CRM who has never signed in
      When they sign in for the first time
      Then they have the Community role

  @pending
  Rule: Signing in again doesn't change a person's role

    Example: A Crew member signs in again
      Given a user with the Crew role
      When they sign in again
      Then they still have the Crew role

  @pending
  Rule: Someone added to a group before they first sign in gets the group's policies when they do

    Example: A new committee member signs in for the first time
      Given a person in the CRM who has never signed in, in a group that gives the CRM Writer policy
      When they sign in for the first time
      Then they can change people and their details
      And they have the Community role

  Rule: Every role can open the Data Studio

    Scenario Outline: Crew and admins can open the Data Studio
      Given a user with the <role> role
      Then they can open the Data Studio

      Examples:
        | role  |
        | Crew  |
        | Admin |

    @pending
    Example: A family member can open the Data Studio
      Given a user with the Community role
      Then they can open the Data Studio
