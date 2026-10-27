Feature: What the syncs' machine users can do
  clubspot-sync and gsuite-sync each sign in as a machine user, whose role the backend stack defines
  in code. `clubspot-sync.feature` and `gsuite-sync.feature` run the syncs themselves. Directus
  enforces permission rules only with a license, and dev's Directus has one.

  Each run signs in as a throwaway user on each sync's role, and works on rows of its own: a program,
  a camp with one session and class, and a child registered in it, with one guardian and a medical
  profile.

  Background:
    Given this run's users and rows on dev's Directus

  Scenario Outline: clubspot-sync writes the collections it syncs
    Then "clubspot-sync" can create, read, and update "<collection>"

    Examples:
      | collection               |
      | camps                    |
      | sessions                 |
      | classes                  |
      | session_classes          |
      | entry_caps               |
      | custom_field_definitions |
      | custom_field_responses   |
      | people                   |
      | contacts                 |
      | contact_points           |
      | medical_profiles         |
      | participants             |
      | registrations            |
      | registration_entries     |
      | registration_billing     |
      | sync_tasks               |
      | sync_runs                |
      | audit_findings           |

  Scenario Outline: clubspot-sync deletes only what a merge or a resync replaces
    Then "clubspot-sync" can delete "<collection>"

    Examples:
      | collection           |
      | people               |
      | contacts             |
      | contact_points       |
      | medical_profiles     |
      | session_classes      |
      | registration_billing |

  Scenario Outline: clubspot-sync deletes nothing else it syncs
    Then "clubspot-sync" can't delete "<collection>"

    Examples:
      | collection           |
      | camps                |
      | sessions             |
      | classes              |
      | participants         |
      | registrations        |
      | registration_entries |
      | sync_runs            |
      | audit_findings       |

  Scenario: clubspot-sync can't read or create programs, which staff create
    Then "clubspot-sync" can't create or read "programs"

  Scenario Outline: clubspot-sync repoints a merged person on rows owned elsewhere
    Then "clubspot-sync" can read "<collection>"
    And "clubspot-sync" can set "person_id" on "<collection>"
    And "clubspot-sync" can't create or delete "<collection>"

    Examples:
      | collection               |
      | program_role_assignments |
      | event_staff              |
      | google_group_memberships |

  Scenario: clubspot-sync reads the promoted fields, which staff maintain
    Then "clubspot-sync" can read "promoted_fields"
    And "clubspot-sync" can't create "promoted_fields"

  Scenario Outline: gsuite-sync reads what it maps into Google Groups
    Then "gsuite-sync" can read "<collection>"
    And "gsuite-sync" can't update "<collection>"

    Examples:
      | collection               |
      | programs                 |
      | camps                    |
      | classes                  |
      | people                   |
      | contacts                 |
      | registrations            |
      | registration_entries     |
      | program_role_assignments |

  Scenario Outline: gsuite-sync reads only the fields it needs from participants and contact points
    Then "gsuite-sync" can read only "<fields>" of "<collection>"

    Examples:
      | collection     | fields                          |
      | participants   | id, person_id                   |
      | contact_points | id, person_id, kind, normalized |

  Scenario Outline: gsuite-sync reads nothing else
    Then "gsuite-sync" can't read "<collection>"

    Examples:
      | collection           |
      | medical_profiles     |
      | sessions             |
      | registration_billing |
      | sync_runs            |

  Scenario Outline: gsuite-sync writes its own queue, findings, groups, and memberships, but deletes none
    Then "gsuite-sync" can create, read, and update "<collection>"
    And "gsuite-sync" can't delete "<collection>"

    Examples:
      | collection               |
      | sync_tasks               |
      | audit_findings           |
      | google_groups            |
      | google_group_memberships |

  Scenario: gsuite-sync can't change people
    Then "gsuite-sync" can't create or update "people"
