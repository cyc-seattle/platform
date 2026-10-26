Feature: Who can see and change the catalog, plans, and results
  These scenarios are the planning model's permission requirements (cyc-seattle/workplace#6 step 8,
  cyc-seattle/isthmia#213 §4). Steps 9 to 12 build the collections, policies, and machine user that
  turn them green. Until then each is tagged `@pending`, so dev's integration run skips it.

  The catalog is the `core` domain: products, accounts, qualifications, boat classes, and resource
  kinds. A plan holds one product's offerings, or, for the Operations Plan, what products share. A
  plan has one draft, which planners edit, and saved versions, which nobody changes. Results are the
  engine's P&L lines and metrics for a plan. Wages are staff levels' hourly rates and salaried
  positions' salaries. Bonus rates are bonus owners' rates.

  Each run signs in once as each of these throwaway users:
  - Staff: a staff member, with neither Planner nor Finance.
  - Planner: a volunteer with the Planner policy, and no staff role.
  - Finance: a staff member with the Finance policy.
  - Engine: the engine's machine user.
  - Coach, Guardian, Community, clubspot-sync, and gsuite-sync, as today.

  The run's rows are a product in the catalog, with a plan that has a draft and a saved version.
  Another user started the plan. Each version has a row in every planning collection, and the engine
  has written results for the saved version.

  Background:
    Given this run's users, catalog, and plans on dev's Directus

  @pending
  Scenario Outline: Staff keep the catalog, as Catalog editors
    Then "Staff" can create, read, update, and delete "<collection>"

    Examples:
      | collection           |
      | products             |
      | accounts             |
      | qualifications       |
      | qualification_covers |
      | boat_classes         |
      | resource_kinds       |

  # DECISION: Planner is a policy that a volunteer can hold without being staff, so a planner who
  # isn't staff reads the catalog but can't change it. If every planner is staff, this scenario goes.
  @pending
  Scenario: A planner reads the catalog, but only staff change it
    Then "Planner" reads the catalog
    And "Planner" can't change the catalog

  @pending
  Scenario: A planner starts a plan for a product, with a draft
    Then "Planner" can start a plan for a product, with a draft

  # DECISION: Plans have no owner. Any planner edits any plan's draft, including one another planner
  # started.
  @pending
  Scenario: A planner edits every part of a draft, including one someone else started
    Then "Planner" can create, read, update, and delete the draft's rows

  @pending
  Scenario: A saved version can't be changed
    Then "Planner" reads the saved version's rows
    And "Planner" can't create, update, or delete the saved version's rows
    And "Planner" can't move a draft's row into the saved version
    And "Planner" can't make the saved version a draft again

  # DECISION: A planner retires a plan by archiving it. Deleting a plan or a version takes the
  # maintainer, because results and version sets point at them.
  @pending
  Scenario: A planner archives a plan, but deletes no plan or version
    Then "Planner" can archive a plan
    And "Planner" can't delete a plan or a version

  # DECISION: Finance holds the separate permission to activate and freeze, rather than a fourth
  # policy. Both need collections that come after step 11, so this scenario stays pending until then.
  @pending
  Scenario: Only Finance activates a version or freezes a baseline
    Then "Planner" can't activate a version
    And "Planner" can't freeze a baseline
    And "Finance" can activate a version
    And "Finance" can freeze a baseline

  # DECISION: Wages and bonus rates are hidden field by field, not collection by collection. A
  # planner still reads a staff level's name, to pick an offering's coach level, and a bonus owner's
  # products.
  @pending
  Scenario Outline: Only Finance reads wages and bonus rates
    Then "Finance" reads "<field>" of "<collection>"
    And "Planner" can't read "<field>" of "<collection>"
    And "Staff" can't read "<field>" of "<collection>"
    And "Planner" reads the rest of "<collection>"

    Examples:
      | collection              | field               |
      | plan_staff_levels       | hourly_rate_cents   |
      | plan_salaried_positions | annual_salary_cents |
      | plan_bonus_owners       | bonus_rate          |

  # DECISION: Finance sets wages and bonus rates, under the same draft rule as a planner. A planner
  # adds a staff level or a position without its pay, and Finance fills it in.
  @pending
  Scenario: Only Finance sets wages and bonus rates, and only in a draft
    Then "Finance" can set "hourly_rate_cents" on the draft's "plan_staff_levels"
    And "Finance" can't set "hourly_rate_cents" on the saved version's "plan_staff_levels"
    And "Planner" can't set "hourly_rate_cents" on the draft's "plan_staff_levels"

  # DECISION: Staff without Planner read every plan, except wages and bonus rates, and change
  # nothing. The blanket Staff rule doesn't reach plans (cyc-seattle/isthmia#213 §4).
  @pending
  Scenario: Staff without Planner read plans, but change nothing
    Then "Staff" reads every plan's draft and saved versions
    And "Staff" can't change any plan

  # DECISION: Planners read results, because the P&L is what they plan for. A program's wages divided
  # by its paid hours can show an hourly rate, so the alternative is results for Finance only.
  @pending
  Scenario: Planners and Finance read the engine's results, and other staff don't
    Then "Finance" reads the results
    And "Planner" reads the results
    And "Staff" can't read the results

  @pending
  Scenario Outline: Only the engine writes results
    Then "<login>" can't change the results

    Examples:
      | login   |
      | Staff   |
      | Planner |
      | Finance |

  @pending
  Scenario: The engine replaces a plan's results
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
    Then "Engine" can't read the CRM, Clubspot's records, or the syncs' records

  @pending
  Scenario Outline: Coaches, families, community members, and clubspot-sync see no catalog, plans, or results
    Then "<login>" can't read the catalog, any plan, or the results

    Examples:
      | login         |
      | Coach         |
      | Guardian      |
      | Community     |
      | clubspot-sync |

  # gsuite-sync's revenue-account audit reads the catalog once step 10 moves it off
  # `programs.revenue_account`.
  @pending
  Scenario: gsuite-sync reads products and their revenue accounts, and no plans or results
    Then "gsuite-sync" reads "products"
    And "gsuite-sync" reads "accounts"
    And "gsuite-sync" can't read any plan, or the results
