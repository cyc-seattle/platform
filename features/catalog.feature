Feature: The catalog
  The catalog lists what the club sells and how it accounts for the money. A product is something
  the club sells year after year, such as the J-Pod Race Team, boat charters, or storage. Each
  product is one of these kinds: a program, a charter, a storage lease, merchandise, event hosting,
  or other. Some products are programs, which sailors sign up for, such as Summer Camp or the race
  team. A program has details of its own, such as its Google group and the ages it takes. The
  catalog's offerings say what CSC sells: one product for one dated period, such as Guppies week 3
  of summer 2027, with its price and how many sailors it takes. An offering's schedule gives the
  days and times it meets each week, such as Tuesdays and Thursdays from 4:15 to 7:30 pm, and the
  catalog lists each day it meets too. Each offering is on a registration form, such as 2027 Summer
  Sailing Camps, which says when registration opens. Clubspot's camps are built from them, and each
  offering is linked to the Clubspot class that sells it. The catalog also lists the revenue accounts
  the club's money is booked to, the qualifications a coach can hold, and the boat classes, such as
  Opti, 420, or RIB for a coach boat. It lists the staff levels hourly staff are paid at, too. Each
  is a role, such as Instructor, Coach, or Office, at a grade: Volunteer, Junior, Standard, Senior,
  or Head, such as Senior Instructor. A standard grade adds no word to the name, so it's just
  "Instructor". Each Financial Plan sets what each level is paid an hour.

  The catalog also lists the program areas. A program area is one part of the club's programs, such
  as Summer or Singlehanded, and is what the club reports to the IRS as one of its program
  services. Each program area has one revenue account, which its programs' fees are booked to, and
  people in roles such as Director, who plan it. Every program belongs to one program area.
  Merchandise, storage, and charters belong to none. Anyone who signs in can see the program areas.

  Planners use the catalog to build plans. They have the Plan Reader or Plan Writer policy. Besides
  admins, only the few people who manage the club's products and revenue accounts can change the
  catalog. They have the Catalog Writer policy. The Catalog Reader policy lets someone see the
  catalog without changing it. Crew, the people an admin trusts with every roster, can see products
  and revenue accounts too. Anyone who signs in can see products' names, which name the offerings.
  People with a CRM policy can see programs' details too, but not the rest of the products or the
  revenue accounts unless they're also Crew. To change something means to add, edit, or
  delete it.

  Rule: A program can't be deleted while it has details of its own

    Example: Deleting a program with details isn't allowed
      Given a program with details of its own
      When an admin deletes the program's product
      Then the catalog doesn't allow it
      And the product is still in the catalog

  Rule: An offering a sailor is registered in can't be deleted

    Example: Deleting an offering with a registration isn't allowed
      Given an offering with a sailor registered in it
      When an admin deletes the offering
      Then the catalog doesn't allow it
      And the offering is still in the catalog

  Rule: A program area can't be deleted while it has programs

    Example: Deleting a program area with programs isn't allowed
      Given a program area with a program in it
      When an admin deletes the program area
      Then the catalog doesn't allow it
      And the program area is still in the catalog

  Rule: Each program area has a revenue account

    Example: A program area with no revenue account isn't allowed
      When an admin adds a program area with no revenue account
      Then the catalog doesn't allow it

  Rule: Each revenue account has its own number

    Example: A second revenue account with the same number isn't allowed
      Given a revenue account in the catalog
      When an admin adds another revenue account with the same number
      Then the catalog doesn't allow it

  Rule: A Catalog Reader can see the catalog, but can't change it

    Example: A Catalog Reader looks up the catalog
      Given a user with the Catalog Reader policy
      Then they can see the catalog
      But they can't change the catalog

  Rule: A Catalog Writer can change the catalog, programs' details included

    Example: A Catalog Writer adds, edits, and deletes products, revenue accounts, and programs' details
      Given a user with the Catalog Writer policy
      Then they can change the catalog

  Rule: Planners can see the catalog, but can't change it

    Scenario Outline: Each planning policy can see the catalog
      Given a user with the <policy> policy
      Then they can see the catalog
      But they can't change the catalog

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  Rule: A CRM Reader or CRM Writer can see programs' details, such as their Google group, but can't change them

    Scenario Outline: A CRM policy can see programs' details, but can't change them
      Given a user with the <policy> policy
      Then they can see programs' details
      But they can't change programs' details

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  Rule: Crew can see products and revenue accounts, but can't change them

    Example: A Crew member looks up products and revenue accounts
      Given a user with the Crew role
      Then they can see products
      And they can see revenue accounts
      But they can't change products
      And they can't change revenue accounts

  Rule: Crew can see program areas, but can't change them

    Example: A Crew member looks up program areas
      Given a user with the Crew role
      Then they can see program areas
      But they can't change program areas

  Rule: Only admins, Crew, people with a Catalog or Plan policy, and the Google sync can see more of a product than its name, or see revenue accounts

    Example: A family member can see products' names, but not the rest of the products or revenue accounts
      Given a user with the Community role
      Then they can see products' names
      But they can't see the rest of the products
      And they can't see revenue accounts

    Example: A CRM Writer who isn't Crew can see a program's details, but not the rest of its product or its revenue account
      Given a user with the Community role and the CRM Writer policy
      Then they can see programs' details
      And they can see products' names
      But they can't see the rest of the products
      And they can't see revenue accounts

  Rule: Anyone who signs in can see program areas

    Example: A family member can see program areas
      Given a user with the Community role
      Then they can see program areas
      But they can't change program areas
