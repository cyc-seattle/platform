Feature: The catalog
  The catalog lists what the club sells and how it accounts for the money. A product is something the
  club sells year after year, such as the J-Pod Race Team, boat charters, or storage. Each product
  is one kind: a program, a charter, a storage lease, merchandise, event hosting, or other. A program
  is a product that sailors sign up for, such as a summer camp or the race team. It has details of
  its own, such as its Google group. The catalog also lists the revenue accounts the club's money is
  booked to, the qualifications a coach can hold, the boat classes the club sails, such as Opti or
  420, and the kinds of equipment programs share, such as coach boats and trailers.

  Planners use the catalog to build plans. They have the Plan Reader or Plan Writer policy. Only the
  few people who manage the club's products and revenue accounts can change the catalog. They have
  the Catalog Writer policy. The Catalog Reader policy lets someone see the catalog without changing
  it. Crew, the club's coaches and volunteers, can see products and revenue accounts too. Staff with
  a CRM policy can see programs and their details, but not products or revenue accounts unless
  they're also Crew. To change something means to add, edit, or delete it.

  Rule: A product that runs a program can't be deleted

    Example: Deleting a product with a program isn't allowed
      Given a product that runs a program
      When an admin deletes the product
      Then the catalog doesn't allow it
      And the product is still in the catalog

  Rule: Each revenue account has its own number

    Example: A second revenue account with the same number isn't allowed
      Given a revenue account in the catalog
      When an admin adds another revenue account with the same number
      Then the catalog doesn't allow it

  @pending
  Rule: A Catalog Reader can see the catalog, but can't change it

    Example: A Catalog Reader looks up the catalog
      Given a user with the Catalog Reader policy
      Then they can see the catalog
      But they can't change the catalog

  @pending
  Rule: A Catalog Writer can change the catalog, programs included

    Example: A Catalog Writer adds, edits, and deletes products, revenue accounts, and programs
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
  Rule: A CRM Reader or CRM Writer can see programs and their details, such as their Google group, but can't change them

    Scenario Outline: A CRM policy can see programs, but can't change them
      Given a user with the <policy> policy
      Then they can see programs
      But they can't change programs

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  @pending
  Rule: Crew can see products and revenue accounts, but can't change them

    Example: A coach looks up products and revenue accounts
      Given a user with the Crew role
      Then they can see products
      And they can see revenue accounts
      But they can't change products
      And they can't change revenue accounts

  @pending
  Rule: Only Crew, people with a Catalog or Plan policy, and the Google sync can see products and revenue accounts

    Example: A family member can't see products or revenue accounts
      Given a user with the Community role
      Then they can't see products
      And they can't see revenue accounts

    Example: A CRM Writer who isn't Crew can see a program's details, but not its product or revenue account
      Given a user with the Community role and the CRM Writer policy
      Then they can see programs
      But they can't see products
      And they can't see revenue accounts
