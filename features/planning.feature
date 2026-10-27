Feature: Who can see and change plans and results
  A plan holds one product's offerings, or, for the Operations Plan, what products share. A plan has
  one draft, which changes, and saved versions, which never do. Results are the engine's P&L lines
  and metrics for a plan. Wages are staff levels' hourly rates and salaried positions' salaries.
  Bonus rates are bonus owners' rates. A plan reader sees them all.

  Code defines Plan Reader and Plan Writer, and an admin grants them through groups. Step 11 of
  https://github.com/cyc-seattle/workplace/issues/6 builds plans and their policies, and turns these
  scenarios green.

  Each login named for a policy is a Community user in a group that grants only that policy. The
  run's rows include a plan for the run's product, with a draft and a saved version. Another user
  started the plan. Each version has a row in every planning collection, and the engine has written
  results for the saved version.

  Background:
    Given this run's users and rows on dev's Directus

  @pending
  Scenario Outline: The plan policies read every plan and its results, wages and bonus rates included
    Then "<login>" can read every field of "plans"
    And "<login>" can read "results"

    Examples:
      | login       |
      | Plan Reader |
      | Plan Writer |

  @pending
  Scenario: Plan Reader changes nothing
    Then "Plan Reader" can't change "plans"
    And "Plan Reader" can't change "results"

  @pending
  Scenario: Plan Writer starts a plan for a product, with a draft
    Then "Plan Writer" can start a plan for a product, with a draft

  @pending
  Scenario: Plan Writer edits any plan's draft, including one someone else started
    Then "Plan Writer" can create, read, update, and delete "the draft"

  @pending
  Scenario: Plan Writer saves a draft as a version, and activates it
    Then "Plan Writer" can save the draft as a version
    And "Plan Writer" can activate a saved version

  @pending
  Scenario Outline: Nobody changes a saved version, not even an admin
    Then "<login>" can read "the saved version"
    And "<login>" can't change "the saved version"
    And "<login>" can't move a draft's row into the saved version
    And "<login>" can't make the saved version a draft again

    Examples:
      | login       |
      | Plan Writer |
      | Admin       |

  @pending
  Scenario: MCP reaches what the REST API does, and no more
    Then "Plan Writer" can create, read, update, and delete "the draft" over MCP
    And "Plan Writer" can't change "the saved version" over MCP
    And "Plan Reader" can't change "plans" over MCP

  @pending
  Scenario Outline: Nobody else reads plans or results
    Then "<login>" can't read "plans"
    And "<login>" can't read "results"

    Examples:
      | login          |
      | Community      |
      | Crew           |
      | CRM Writer     |
      | Catalog Reader |
      | Catalog Writer |
      | clubspot-sync  |
      | gsuite-sync    |
