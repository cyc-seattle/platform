Feature: The catalog
  The catalog lists what the club sells and how it accounts for the money. A product is something the
  club sells year after year, such as the J-Pod Race Team, boat charters, or storage. Each product
  is one kind: a program, a charter, a storage lease, merchandise, event hosting, or other. A program
  is a product of the program kind, with details of its own. The catalog also lists the accounts the
  club's money is booked to, the qualifications a coach can hold, the boat classes the club sails,
  such as Opti or 420, and the kinds of equipment programs share, such as coach boats and trailers.

  Planners use the catalog to build plans. Only the few people who set prices and accounts can
  change it. They have the Catalog Writer policy. The Catalog Reader policy lets someone look things
  up without changing them.

  Rule: A product that runs a program can't be deleted

    Example: Deleting a product with a program is refused
      Given a product that runs a program
      When an admin deletes the product
      Then they're refused, and the product stays

  Rule: Each account has its own number

    Example: A second account with the same number is refused
      Given an account in the catalog
      When an admin adds another account with the same number
      Then the catalog refuses it

  @pending
  Rule: A Catalog Reader can see the catalog, but can't change it

    Example: A Catalog Reader looks up the catalog
      Given a user with the Catalog Reader policy
      Then they can see the catalog
      But they can't change the catalog

  @pending
  Rule: A Catalog Writer can edit the catalog, programs included

    Example: A Catalog Writer adds, edits, and deletes products, accounts, and programs
      Given a user with the Catalog Writer policy
      Then they can change the catalog

  @pending
  Rule: Planners can see the catalog, but can't change it

    Scenario Outline: Each planning policy can see the catalog
      Given a user with the <policy> policy
      Then they can see the catalog
      But they can't change the catalog

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  @pending
  Rule: Programs belong to the catalog, so a CRM Reader or CRM Writer can see them but can't change them

    Scenario Outline: A CRM policy can see programs, but can't change them
      Given a user with the <policy> policy
      Then they can see programs
      But they can't change programs

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  @pending
  Rule: Only people who manage the catalog or plan can see prices and accounts

    Scenario Outline: A role on its own doesn't show prices and accounts
      Given a user with the <role> role
      Then they can't see products and accounts

      Examples:
        | role      |
        | Community |
        | Crew      |

    Example: Being able to edit the CRM doesn't show prices and accounts
      Given a user with the CRM Writer policy
      Then they can't see products and accounts
