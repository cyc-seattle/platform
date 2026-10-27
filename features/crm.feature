Feature: What the CRM Writer policy reaches
  CRM Writer is full access to the CRM, medical data included, and read access to Clubspot's
  records, which clubspot-sync edits. An admin grants it through a group, since a Crew role holding it
  would hand every volunteer medical data. Directus enforces permission rules only with a license, and
  dev's Directus has one.

  The CRM Writer login is a Crew user in a group that grants CRM Writer. Until step 8a of
  https://github.com/cyc-seattle/workplace/issues/6 builds groups, it signs in on today's Staff
  role, which grants the same.

  Each run works on rows of its own: a program, a camp with one session and class, and a child
  registered in it, with one guardian and a medical profile.

  Background:
    Given this run's users and rows on dev's Directus

  Scenario Outline: CRM Writer has full access to the CRM's own collections
    Then "CRM Writer" can create, read, update, and delete "<collection>"

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

  Scenario Outline: CRM Writer reads Clubspot's collections, but Clubspot edits them
    Then "CRM Writer" can read "<collection>"
    And "CRM Writer" can't create, update, or delete "<collection>"

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

  Scenario: CRM Writer sets a class's program and matches a participant to a person
    Then "CRM Writer" can set "program_id" on "classes"
    And "CRM Writer" can set "person_id" on "participants"

  Scenario: CRM Writer reads the promoted fields
    Then "CRM Writer" can read "promoted_fields"
