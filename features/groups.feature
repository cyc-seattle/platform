Feature: Groups grant policies
  Who holds a policy beyond their role's is data, not code. A group links people to policies, and an
  admin edits groups, their members, and their grants in the Data Studio. A hook keeps each user's
  own policies equal to what their groups grant. A group never sets a role (`roles.feature`), and the
  hook leaves machine users and the bootstrap admin alone. Step 8a of
  https://github.com/cyc-seattle/workplace/issues/6 builds groups, and turns these scenarios green.

  These scenarios grant CRM Writer, which reads medical profiles, where a Community or Crew user
  reads none of the run's.

  Background:
    Given this run's users and rows on dev's Directus

  @pending
  Scenario: Joining a group adds its policies, and leaves the role alone
    Given "Pat" is a person on the "Crew" role
    When an admin adds "Pat" to a group that grants "CRM Writer"
    Then "Pat" can read "medical_profiles"
    And "Pat" holds the "Crew" role

  @pending
  Scenario: Leaving a group takes its policies away
    Given "Pat" is in a group that grants "CRM Writer"
    When an admin removes "Pat" from the group
    Then "Pat" can't read "medical_profiles"

  @pending
  Scenario: Dropping a group's grant takes it from every member
    Given "Pat" is in a group that grants "CRM Writer"
    When an admin drops "CRM Writer" from the group
    Then "Pat" can't read "medical_profiles"

  @pending
  Scenario: A policy two groups grant stays until both drop it
    Given "Pat" is in two groups that grant "CRM Writer"
    When an admin removes "Pat" from one of them
    Then "Pat" can read "medical_profiles"

  @pending
  Scenario: A person added before their first sign-in gets the group's policies once they sign in
    Given "Pat" is a person with no login, in a group that grants "CRM Writer"
    When "Pat" signs in for the first time
    Then "Pat" can read "medical_profiles"
    And "Pat" holds the "Community" role

  @pending
  Scenario Outline: The hook leaves machine users and the bootstrap admin alone
    Given "Pat" is a person with a login
    When an admin adds "Pat" to a group that grants "CRM Writer"
    Then "<user>" keeps its role and policies

    Examples:
      | user                |
      | clubspot-sync       |
      | gsuite-sync         |
      | the bootstrap admin |

  @pending
  Scenario Outline: Only an admin manages groups, their members, and their grants
    Then "Admin" can create, read, update, and delete "<collection>"
    And "CRM Writer" can't create, update, or delete "<collection>"
    And "Crew" can't create, update, or delete "<collection>"
    And "Community" can't create, update, or delete "<collection>"

    Examples:
      | collection     |
      | groups         |
      | group_members  |
      | group_policies |
