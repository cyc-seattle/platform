Feature: Crew
  Crew is everyone who works for CSC, volunteers and paid staff. Each crew member is someone in the
  CRM. A position is a job, such as Treasurer, Head Coach, or Parent Coordinator. A term is one crew member in one position, from a start date to an end date, and ended
  terms are kept. A term can say which program or program area the job is in, such as the team a
  Parent Coordinator helps, and what it pays: a staff level, a rate of the crew member's own, and
  whether they get a share of the profit. A crew member holds qualifications, such as first aid or
  SafeSport, each earned on a date, and most expiring on one.

  To change something means to add, edit, or delete it.

  - Crew Writer: can change everything in Crew, pay included.
  - Crew Reader: can see Crew, but not pay, and can't change it.
  - CRM Reader and CRM Writer: can see who holds which position, but not pay or qualifications.
  - Plan Reader, Plan Writer, and Plan Admin, the planners: can see who holds which position, and
    their pay.

  A group gives each of these, and an admin adds its members by hand. A committee, such as the
  Finance Committee, is a group too. Being on Crew or holding a position gives no access, and puts
  no one in a group.

  Rule: A person can be on Crew only once

    Example: Adding someone who's already on Crew isn't allowed
      Given a crew member
      When an admin adds the same person to Crew again
      Then the CRM doesn't allow it

  Rule: A person can't be deleted while they're on Crew

    Example: Deleting a crew member's person isn't allowed
      Given a crew member
      When an admin deletes that person from the CRM
      Then the CRM doesn't allow it

  Rule: A position someone has held can't be deleted

    Example: Deleting a position with a term isn't allowed
      Given a crew member with a term as Treasurer
      When an admin deletes the Treasurer position
      Then the CRM doesn't allow it

  Rule: A program can't be deleted while a term names it

    Example: Deleting the program a Parent Coordinator helps isn't allowed
      Given a crew member who is Parent Coordinator for a program
      When an admin deletes that program
      Then the catalog doesn't allow it

  Rule: A Crew Writer can change Crew

    Example: A Crew Writer adds, edits, and deletes everything in Crew
      Given a user with the Crew Writer policy
      Then they can add, see, edit, and delete Crew
      And they can see a term's pay

    Example: A Crew Writer sees people's names and emails, but nothing else about them
      Given a user with the Crew Writer policy
      Then they can see people's names and emails, but nothing else about them

    Example: Only an admin changes groups
      Given a user with the Crew Writer policy
      Then they can't add, see, edit, or delete groups

  Rule: A Crew Reader can see Crew, but not pay, and can't change it

    Example: A Crew Reader looks at Crew
      Given a user with the Crew Reader policy
      Then they can see Crew
      But they can't change Crew
      And they can't see a term's pay

  Rule: The CRM policies can see who holds which position, but not pay or qualifications

    Scenario Outline: A <policy> looks up who holds which position
      Given a user with the <policy> policy
      Then they can see who holds which position
      But they can't see a term's pay
      And they can't see qualifications held

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  Rule: Planners can see who holds which position, and their pay

    Scenario Outline: A <policy> sees a term's pay
      Given a user with the <policy> policy
      Then they can see who holds which position
      And they can see a term's pay

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |
        | Plan Admin  |

  Rule: Families and the Crew role can't see Crew, unless they also have a policy that shows it

    Scenario Outline: A user with the <role> role can't see Crew
      Given a user with the <role> role
      Then they can't see crew members

      Examples:
        | role      |
        | Community |
        | Team      |
        | Crew      |

  Rule: Being on Crew doesn't give a crew member any access

    Example: A crew member signs in for the first time
      Given a crew member in the CRM who has never signed in
      When they sign in for the first time
      Then they have the Community role
      And they can't see crew members
