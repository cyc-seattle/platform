Feature: Who can see and change the catalog
  The catalog lists what the club offers and how it accounts for it: its products and their prices,
  the revenue accounts they post to, the qualifications a sailor can hold, the boat classes, the kinds
  of resource a program uses, and the programs each product runs. Planners read it to build plans.
  Only the few people who set prices and accounts may change it, through the Catalog Writer policy a
  group grants. Catalog Reader lets someone look it up without changing it.

  @pending
  Rule: A Catalog Reader reads the catalog, and changes nothing

    Example: A Catalog Reader looks up the catalog
      Given a user with the Catalog Reader policy
      Then they can read the catalog
      But they can't change the catalog

  @pending
  Rule: A Catalog Writer keeps the catalog, programs included

    Example: A Catalog Writer adds, edits, and removes the catalog's records
      Given a user with the Catalog Writer policy
      Then they can change the catalog

  @pending
  Rule: A product that runs programs can't be deleted

    Example: A Catalog Writer tries to delete a product with a program
      Given a user with the Catalog Writer policy
      And a product that runs a program
      When they delete the product
      Then they're refused, and the product stays

  @pending
  Rule: Planners read the catalog, and change nothing in it

    Scenario Outline: Each plan policy reads the catalog
      Given a user with the <policy> policy
      Then they can read the catalog
      But they can't change the catalog

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  @pending
  Rule: Only those who keep the catalog or plan see prices and accounts

    Scenario Outline: A role alone doesn't show prices and accounts
      Given a user with the <role> role
      Then they can't read products and accounts

      Examples:
        | role      |
        | Community |
        | Crew      |

    Example: Keeping the CRM doesn't show prices and accounts
      Given a user with the CRM Writer policy
      Then they can't read products and accounts
