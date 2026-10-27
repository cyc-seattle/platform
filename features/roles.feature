Feature: The three roles
  Every user holds one of three roles, each with its own base access. Community is every user's role
  when they first sign in: a family's view of its own children and their teammates, which
  `community-rules.feature` pins in full. Crew is volunteers and staff: it reads rosters, and carries
  Community's policies too, so a volunteer who is also a parent keeps their family view. Admin has
  Directus's admin access. An admin changes a user's role by hand. Groups never set a role; they only
  grant more policies (`groups.feature`).

  Step 8a of https://github.com/cyc-seattle/workplace/issues/6 builds the Crew and Admin roles, and
  folds Guardian's rules into Community. Until then, the Crew login signs in on today's Coach role,
  whose rules Crew keeps.

  Each run works on rows of its own: a program, a camp with one session and class, and a child
  registered in it, with one guardian and a medical profile. The Community login is that child's
  guardian. A second child, in another family, is registered in the same class.

  Background:
    Given this run's users and rows on dev's Directus

  @pending
  Scenario: Every person's user holds exactly one of the three roles
    Then every person's user holds one of "Community, Crew, Admin"

  @pending
  Scenario: A new sign-in gets Community
    Given "Pat" is a person with no login
    When "Pat" signs in for the first time
    Then "Pat" holds the "Community" role

  @pending
  Scenario: An admin makes a person Crew
    Given "Pat" is a person with a login
    When an admin gives "Pat" the "Crew" role
    Then "Pat" holds the "Crew" role
    And "Pat" can read "registration_entries"

  @pending
  Scenario: A Crew member who signs in again is still Crew
    Given "Pat" is a person on the "Crew" role
    When "Pat" signs in again
    Then "Pat" holds the "Crew" role

  @pending
  Scenario Outline: Only an admin changes a user's role
    Then "<login>" can't change a user's role, their own included

    Examples:
      | login      |
      | Community  |
      | Crew       |
      | CRM Writer |

  # Community's Data Studio access is https://github.com/cyc-seattle/platform/issues/49.
  @pending
  Scenario Outline: Each role opens the Data Studio
    Then "<login>" can sign in to the Data Studio

    Examples:
      | login     |
      | Community |
      | Crew      |
      | Admin     |

  Scenario Outline: Crew reads rosters, and changes nothing
    Then "Crew" can read "<collection>"
    And "Crew" can't create, update, or delete "<collection>"

    Examples:
      | collection           |
      | programs             |
      | camps                |
      | sessions             |
      | classes              |
      | registration_entries |
      | people               |

  Scenario Outline: Crew reads nothing else
    Then "Crew" can't read "<collection>"

    Examples:
      | collection               |
      | medical_profiles         |
      | contacts                 |
      | contact_points           |
      | participants             |
      | registrations            |
      | registration_billing     |
      | program_role_assignments |
      | sync_tasks               |
      | audit_findings           |

  @pending
  Scenario: A Crew member who is also a parent keeps their family view
    Given "Pat" is the run's child's guardian, on the "Crew" role
    Then "Pat" can read "medical_profiles"

  @pending
  Scenario Outline: A Community member reads their own child's records
    Then "Community" can read "<collection>"

    Examples:
      | collection           |
      | people               |
      | medical_profiles     |
      | participants         |
      | registrations        |
      | registration_entries |

  @pending
  Scenario Outline: A Community member can't change their child's person or medical profile
    Then "Community" can't update "<collection>"

    Examples:
      | collection       |
      | people           |
      | medical_profiles |
