Feature: Today's Directus roles
  isthmia's `crm` project deploys dev's Directus, with its roles and policies. These scenarios pin
  what each role can do there today, so moving them to platform can be shown to change nothing
  (https://github.com/cyc-seattle/workplace/issues/6). The Community role's rules are left to their
  redesign. Directus enforces permission rules only with a license, and dev's Directus has one.

  Each run signs in once on each role as a throwaway user, and works on rows of its own: a program,
  a camp with one session and class, and a child registered in it, with one guardian and a medical
  profile. The Guardian signs in as that child's guardian. A second child, in another family, is
  registered in the same class.

  Background:
    Given this run's users and rows on dev's Directus

  Scenario Outline: Staff has full access to the CRM's own collections
    Then "Staff" can create, read, update, and delete "<collection>"

    Examples:
      | collection               |
      | programs                 |
      | program_roles            |
      | people                   |
      | contacts                 |
      | contact_points           |
      | medical_profiles         |
      | program_role_assignments |
      | sync_tasks               |
      | sync_runs                |
      | audit_findings           |
      | google_groups            |
      | google_group_memberships |

  Scenario Outline: Staff reads Clubspot's collections, but Clubspot edits them
    Then "Staff" reads "<collection>"
    And "Staff" can't create "<collection>"
    And "Staff" can't update "<collection>"
    And "Staff" can't delete "<collection>"

    Examples:
      | collection               |
      | camps                    |
      | sessions                 |
      | classes                  |
      | session_classes          |
      | entry_caps               |
      | custom_field_definitions |
      | custom_field_responses   |
      | participants             |
      | registrations            |
      | registration_entries     |
      | registration_billing     |
      | event_staff              |

  Scenario: Staff sets a class's program and matches a participant to a person
    Then "Staff" can set "program_id" on "classes"
    And "Staff" can set "person_id" on "participants"

  Scenario: Staff reads the promoted fields
    Then "Staff" reads "promoted_fields"

  Scenario Outline: A Coach reads rosters, and changes nothing
    Then "Coach" reads "<collection>"
    And "Coach" can't create "<collection>"
    And "Coach" can't update "<collection>"
    And "Coach" can't delete "<collection>"

    Examples:
      | collection           |
      | programs             |
      | camps                |
      | sessions             |
      | classes              |
      | registration_entries |
      | people               |

  Scenario Outline: A Coach reads nothing else
    Then "Coach" can't read "<collection>"

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

  Scenario Outline: A guardian reads their own child's records, and no one else's
    When "Guardian" lists "<collection>"
    Then they see only their child's row

    Examples:
      | collection           |
      | people               |
      | medical_profiles     |
      | participants         |
      | registrations        |
      | registration_entries |

  Scenario Outline: A guardian can't change their child's records
    Then "Guardian" can't update "<collection>"

    Examples:
      | collection       |
      | people           |
      | medical_profiles |
      | registrations    |

  Scenario Outline: A guardian reads nothing else
    Then "Guardian" can't read "<collection>"

    Examples:
      | collection     |
      | programs       |
      | camps          |
      | sessions       |
      | classes        |
      | contacts       |
      | contact_points |

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
    Then "clubspot-sync" can't read "programs"
    And "clubspot-sync" can't create "programs"

  Scenario Outline: clubspot-sync repoints a merged person on rows owned elsewhere
    Then "clubspot-sync" reads "<collection>"
    And "clubspot-sync" can set "person_id" on "<collection>"
    And "clubspot-sync" can't create "<collection>"
    And "clubspot-sync" can't delete "<collection>"

    Examples:
      | collection               |
      | program_role_assignments |
      | event_staff              |
      | google_group_memberships |

  Scenario: clubspot-sync reads the promoted fields, which staff maintain
    Then "clubspot-sync" reads "promoted_fields"
    And "clubspot-sync" can't create "promoted_fields"

  Scenario Outline: gsuite-sync reads what it maps into Google Groups
    Then "gsuite-sync" reads "<collection>"
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
    Then "gsuite-sync" reads only "<fields>" of "<collection>"

    Examples:
      | collection     | fields                         |
      | participants   | id, person_id                  |
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
    Then "gsuite-sync" can't create "people"
    And "gsuite-sync" can't update "people"
