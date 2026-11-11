Feature: The coach list
  CSC keeps a list of the coaches it employs. Each coach on the list is a person in the CRM, at a
  staff level, such as head coach or junior instructor. A coach is paid their level's hourly rate,
  unless the list gives them a rate of their own. The list also says whether each coach gets a share
  of the profit, and whether they still coach for CSC. A coach who leaves is archived: they stay on
  the list, marked as no longer coaching.

  Plans budget coaches by staff level, not by name. Each year's plan has its own staff levels. A
  level CSC no longer uses stays in the plan, so the coaches at that level keep it.

  Coaches' pay is on the list, so only admins and these policies can see it. To change something
  means to add, edit, or delete it.

  - CRM Reader: can see the coach list, but can't change it.
  - CRM Writer: can add coaches and edit them, but can't delete them.
  - Plan Reader and Plan Writer, the planners: can see the coach list, and each person's name, but
    nothing else about them.

  Being on the coach list doesn't give a coach any access. Crew, the people an admin trusts with
  every roster, is still an admin's decision.

  Rule: A person can be on the coach list only once

    Example: Adding a coach who's already on the list isn't allowed
      Given a coach on the list
      When an admin adds the same person to the coach list again
      Then the CRM doesn't allow it

  Rule: Every coach has a staff level

    Example: Adding a coach with no staff level isn't allowed
      When an admin adds a coach with no staff level
      Then the CRM doesn't allow it

  Rule: A person can't be deleted while they're on the coach list

    Example: Deleting a coach from the CRM isn't allowed
      Given a coach on the list
      When an admin deletes that person from the CRM
      Then the CRM doesn't allow it
      And that person is still in the CRM

  Rule: A coach who leaves is archived, not deleted

    Example: A CRM Writer archives a coach who has left
      Given a user with the CRM Writer policy
      And a coach on the list
      When they archive the coach
      Then the coach is still on the list, marked as no longer coaching

    Example: A CRM Writer can't delete a coach
      Given a user with the CRM Writer policy
      Then they can't delete coaches

  Rule: A CRM Reader can see coaches, but can't change them

    Example: A CRM Reader looks up the coach list
      Given a user with the CRM Reader policy
      Then they can see coaches
      But they can't change coaches

  Rule: A CRM Writer can add, see, and edit coaches

    Example: A CRM Writer adds a coach and edits them
      Given a user with the CRM Writer policy
      Then they can add, see, and edit coaches

  Rule: Planners can see coaches, but can't change them

    Scenario Outline: Each planning policy can see the coach list
      Given a user with the <policy> policy
      Then they can see coaches
      But they can't change coaches

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  Rule: Planners can see each person's name, but nothing else about them

    Scenario Outline: A planner sees a coach's name, but not their email or phone
      Given a user with the <policy> policy
      Then they can see people's names, but nothing else about them

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  Rule: Crew and families can't see coaches, unless they also have a CRM or Plan policy

    Scenario Outline: A Crew member or a family member can't see the coach list
      Given a user with the <role> role
      Then they can't see coaches

      Examples:
        | role      |
        | Community |
        | Crew      |

  Rule: Being on the coach list doesn't give a coach any access

    Example: A coach signs in for the first time
      Given a coach in the CRM who has never signed in
      When they sign in for the first time
      Then they have the Community role
      And they can't see coaches
