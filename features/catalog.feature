Feature: Who can see and change the catalog
  The catalog is the `core` domain: products, accounts, qualifications and their covers, boat
  classes, and resource kinds. Code defines Catalog Reader and Catalog Writer, and an admin grants
  them through groups. Step 9 of https://github.com/cyc-seattle/workplace/issues/6 builds the
  catalog and its policies, and turns these scenarios green, except gsuite-sync's, which step 10
  does.

  Each login named for a policy is a Community user in a group that grants only that policy. The
  run's rows include a product in the catalog.

  Background:
    Given this run's users and rows on dev's Directus

  @pending
  Scenario Outline: Catalog Reader reads the catalog, and changes nothing
    Then "Catalog Reader" can read "<collection>"
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
  Scenario Outline: The plan policies and the engine read the catalog, and change none of it
    Then "<login>" can read "the catalog"
    And "<login>" can't change "the catalog"

    Examples:
      | login       |
      | Plan Reader |
      | Plan Writer |
      | Engine      |

  # gsuite-sync's revenue-account audit reads the catalog once step 10 moves it off
  # `programs.revenue_account`.
  @pending
  Scenario: gsuite-sync reads products and their revenue accounts
    Then "gsuite-sync" can read "products"
    And "gsuite-sync" can read "accounts"

  @pending
  Scenario Outline: Nobody else reads the catalog
    Then "<login>" can't read "the catalog"

    Examples:
      | login         |
      | Community     |
      | Crew          |
      | CRM Writer    |
      | clubspot-sync |
