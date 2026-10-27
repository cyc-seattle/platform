Feature: Who can see and change the catalog, plans, and results
  These scenarios are the planning model's permission requirements
  (https://github.com/cyc-seattle/workplace/issues/6 step 8). Steps 9 to 12 build the collections,
  policies, groups, and machine user that turn them green. Until then each is tagged `@pending`, so
  dev's integration run skips it.

  The catalog is the `core` domain: products, accounts, qualifications and their covers, boat
  classes, and resource kinds. A plan holds one product's offerings, or, for the Operations Plan,
  what products share. A plan has one draft, which changes, and saved versions, which never do.
  Results are the engine's P&L lines and metrics for a plan. Wages are staff levels' hourly rates and
  salaried positions' salaries. Bonus rates are bonus owners' rates.

  Code defines four policies: Catalog Reader, Catalog Writer, Plan Reader, and Plan Writer. Who holds
  them is data. A group links people to policies, and an admin edits groups, their members, and
  their grants in the Data Studio. A user holds the policies their person's groups grant, and no
  others.

  Each run signs in once as each of these throwaway users:
  - Catalog Reader, Catalog Writer, Plan Reader, and Plan Writer: each a person with no role, in a
    group that grants only that policy.
  - Admin: an admin.
  - Staff, Coach, Guardian, and Community: one of each role, in no group.
  - Engine: the engine's machine user.
  - clubspot-sync and gsuite-sync, as today.

  The run's rows are a product in the catalog, with a plan that has a draft and a saved version.
  Another user started the plan. Each version has a row in every planning collection, and the engine
  has written results for the saved version. A scenario that changes a group's members or grants
  uses a person and a group of its own.

  Background:
    Given this run's people, groups, catalog, and plans on dev's Directus

  @pending
  Scenario Outline: Catalog Reader reads the catalog, and changes nothing
    Then "Catalog Reader" reads "<collection>"
    And "Catalog Reader" can't create, update, or delete "<collection>"

    Examples:
      | collection           |
      | products             |
      | accounts             |
      | qualifications       |
      | qualification_covers |
      | boat_classes         |
      | resource_kinds       |

  @pending
  Scenario Outline: Catalog Writer keeps the catalog
    Then "Catalog Writer" can create, read, update, and delete "<collection>"

    Examples:
      | collection           |
      | products             |
      | accounts             |
      | qualifications       |
      | qualification_covers |
      | boat_classes         |
      | resource_kinds       |

  @pending
  Scenario: Plan Reader reads every plan and its results, wages and bonus rates included
    Then "Plan Reader" reads every plan's draft and saved versions, with wages and bonus rates
    And "Plan Reader" reads the results

  @pending
  Scenario: Plan Reader changes nothing
    Then "Plan Reader" can't change any plan
    And "Plan Reader" can't change the results

  @pending
  Scenario: Plan Writer reads everything Plan Reader does
    Then "Plan Writer" reads every plan's draft and saved versions, with wages and bonus rates
    And "Plan Writer" reads the results

  @pending
  Scenario: Plan Writer starts a plan for a product, with a draft
    Then "Plan Writer" can start a plan for a product, with a draft

  @pending
  Scenario: Plan Writer edits any plan's draft, including one someone else started
    Then "Plan Writer" can create, read, update, and delete the draft's rows

  @pending
  Scenario: Plan Writer saves a draft as a version, and activates it
    Then "Plan Writer" can save the draft as a version
    And "Plan Writer" can activate a saved version

  @pending
  Scenario: Plan Writer doesn't write results
    Then "Plan Writer" can't change the results

  # DECISION: Each policy reaches only its own domain, as the four are defined. A group whose members
  # plan grants Catalog Reader too, since a plan names its product and accounts. The alternative is
  # that both plan policies also read the catalog.
  @pending
  Scenario: The plan policies don't reach the catalog, and the catalog policies don't reach plans
    Then "Plan Writer" can't read the catalog
    And "Catalog Writer" can't read any plan, or the results

  @pending
  Scenario Outline: Nobody changes a saved version, not even an admin
    Then "<login>" reads the saved version's rows
    And "<login>" can't create, update, or delete the saved version's rows
    And "<login>" can't move a draft's row into the saved version
    And "<login>" can't make the saved version a draft again

    Examples:
      | login       |
      | Plan Writer |
      | Admin       |

  @pending
  Scenario Outline: Each policy opens the Data Studio
    Then "<login>" can sign in to the Data Studio

    Examples:
      | login          |
      | Catalog Reader |
      | Catalog Writer |
      | Plan Reader    |
      | Plan Writer    |

  @pending
  Scenario: MCP reaches what the REST API does, and no more
    Then "Plan Writer" can edit the draft's rows over MCP
    And "Plan Writer" can't change the saved version's rows over MCP
    And "Plan Reader" can't change any plan over MCP

  @pending
  Scenario: Joining a group grants its policies
    Given a person in no group
    When an admin adds them to a group that grants "Plan Reader"
    Then they read every plan's draft and saved versions

  @pending
  Scenario: Leaving a group takes its policies away
    Given a person in a group that grants "Plan Reader"
    When an admin removes them from the group
    Then they can't read any plan, or the results

  @pending
  Scenario: Dropping a group's grant takes it from every member
    Given a person in a group that grants "Plan Reader"
    When an admin drops "Plan Reader" from the group
    Then they can't read any plan, or the results

  @pending
  Scenario: A policy two groups grant stays until both drop it
    Given a person in two groups that grant "Plan Reader"
    When an admin removes them from one of the groups
    Then they read every plan's draft and saved versions

  @pending
  Scenario: A community member in a group keeps what Community gives them
    Given a community member in a group that grants "Plan Reader"
    Then they read every plan's draft and saved versions
    And they read their teammates, as Community does

  @pending
  Scenario: A person added before their first sign-in gets the group's policies once they sign in
    Given a person with no login, in a group that grants "Plan Reader"
    When they sign in for the first time
    Then they read every plan's draft and saved versions

  @pending
  Scenario Outline: Only an admin manages groups, their members, and their grants
    Then "Admin" can create, read, update, and delete "<collection>"
    And "Staff" can't create, update, or delete "<collection>"
    And "Plan Writer" can't create, update, or delete "<collection>"
    And "Community" can't create, update, or delete "<collection>"

    Examples:
      | collection     |
      | groups         |
      | group_members  |
      | group_policies |

  # DECISION: Staff's role reads the catalog with no group, because staff set a program's product
  # (step 9) and pick it from the catalog. Every other planning grant comes from a group. The
  # alternative keeps roles out of planning entirely, and an admin puts staff in a group instead.
  @pending
  Scenario: Staff in no planning group read the catalog, and see no plans
    Then "Staff" reads the catalog
    And "Staff" can't change the catalog
    And "Staff" can't read any plan, or the results

  @pending
  Scenario Outline: Coaches, guardians, and community members in no planning group see no catalog, plans, or results
    Then "<login>" can't read the catalog, any plan, or the results

    Examples:
      | login     |
      | Coach     |
      | Guardian  |
      | Community |

  @pending
  Scenario: The engine writes results and metrics
    Then "Engine" can create, read, update, and delete "plan_results"
    And "Engine" can create, read, update, and delete "plan_metrics"

  @pending
  Scenario: The engine reads the catalog and every plan, wages included, and changes none of it
    Then "Engine" reads the catalog
    And "Engine" reads every plan's draft and saved versions, with wages and bonus rates
    And "Engine" can't change the catalog
    And "Engine" can't change any plan

  @pending
  Scenario: The engine reads nothing about people
    Then "Engine" can't read the CRM, Clubspot's records, the syncs' records, or groups

  @pending
  Scenario: clubspot-sync sees no catalog, plans, or results
    Then "clubspot-sync" can't read the catalog, any plan, or the results

  # gsuite-sync's revenue-account audit reads the catalog once step 10 moves it off
  # `programs.revenue_account`.
  @pending
  Scenario: gsuite-sync reads products and their revenue accounts, and no plans or results
    Then "gsuite-sync" reads "products"
    And "gsuite-sync" reads "accounts"
    And "gsuite-sync" can't read any plan, or the results
