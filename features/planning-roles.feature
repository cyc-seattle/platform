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

  Code defines the policies: Catalog Reader, Catalog Writer, Plan Reader, and Plan Writer, beside
  Staff, Coach, Guardian, and Community. Who holds them is data. People hold no Directus role. A
  group links people to policies, and an admin edits groups, their members, and their grants in the
  Data Studio. A person's user holds the policies their groups grant, and Community from signing
  in. Staff, say, is a group an admin sets up, granting the Staff policy and Catalog Reader. Machine
  users keep their policies in code.

  Each run signs in once as each of these throwaway users:
  - Catalog Reader, Catalog Writer, Plan Reader, Plan Writer, Staff, Coach, and Guardian: each a
    person in a group that grants only that policy.
  - Admin: a person in a group that grants Directus's Administrator policy.
  - Ungrouped: a person with a login, in no group.
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
  Scenario: A person's user has no role
    Then no user of this run's people has a role

  # DECISION: Signing in grants the Community policy to every user with a login. Its rules already
  # scope it to the person's own family and teammates, and everything else comes from groups. The
  # alternative is a Community group an admin adds each family to.
  @pending
  Scenario: Signing in grants Community, and nothing else
    Then "Ungrouped" holds the Community policy, and no other
    And "Ungrouped" reads their teammates, as Community does

  @pending
  Scenario: A signed-in person in no group sees no catalog, plans, or results
    Then "Ungrouped" can't read the catalog, any plan, or the results

  @pending
  Scenario: A person in a group that grants Staff gets what the Staff role gives today
    Then "Staff" reaches what the Staff role reaches today

  @pending
  Scenario: Plan Reader reads every plan and its results, wages and bonus rates included
    Then "Plan Reader" reads every plan's draft and saved versions, with wages and bonus rates
    And "Plan Reader" reads the results

  @pending
  Scenario: Plan Reader changes nothing
    Then "Plan Reader" can't change any plan
    And "Plan Reader" can't change the results
    And "Plan Reader" can't change the catalog

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

  @pending
  Scenario Outline: The plan policies read the catalog, and change none of it
    Then "<login>" reads the catalog
    And "<login>" can't change the catalog

    Examples:
      | login       |
      | Plan Reader |
      | Plan Writer |

  @pending
  Scenario: The catalog policies don't reach plans
    Then "Catalog Writer" can't read any plan, or the results

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
    And "Ungrouped" can't create, update, or delete "<collection>"

    Examples:
      | collection     |
      | groups         |
      | group_members  |
      | group_policies |

  @pending
  Scenario Outline: The Staff, Coach, and Guardian policies give no catalog, plans, or results
    Then "<login>" can't read the catalog, any plan, or the results

    Examples:
      | login    |
      | Staff    |
      | Coach    |
      | Guardian |

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
