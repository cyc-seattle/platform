Feature: The inventory
  The inventory lists CSC's own boats, and what happens to them: who charters them, the damage they
  take, and where they're stored. It also lists the racks and deck space CSC stores boats on, and the
  storage CSC sells to sailors for their own boats. Sailors' own boats aren't in the inventory.

  Each boat has a boat class from the catalog, such as Opti or 420. A boat goes through stages: it
  starts its charter life, moves to its beginner life, and then retires. A boat's stage is the last
  one it moved to. To move a boat to its next stage, someone adds a stage change: the stage, and the
  date it starts.

  A charter is a sailor renting one of CSC's boats, from one date to another, for a fee. A storage
  agreement is a sailor paying to keep their own boat on one of CSC's racks or deck spaces. Each one
  is sold as a product from the catalog. Damage is logged with what happened, what the repair cost,
  and what the sailor was charged. It's open, repaired, or written off.

  Program directors keep the inventory up to date. They have the Inventory Writer policy. The
  Inventory Reader policy lets someone see the inventory without changing it. Both policies let
  someone see the boat classes and products the inventory names, and the names of the sailors on
  charters, damage, and storage, but not the rest of those sailors' details. To change something
  means to add, edit, or delete it.

  Rule: Each boat has a boat class, a hull number, a value, and whether it was bought or donated

    Example: A boat with no hull number isn't allowed
      When an admin adds a boat with no hull number
      Then the inventory doesn't allow it

  Rule: No two boats have the same hull number

    Example: A second boat with the same hull number isn't allowed
      Given a boat in the inventory
      When an admin adds another boat with the same hull number
      Then the inventory doesn't allow it

  Rule: A boat with a stage change, a charter, or damage can't be deleted

    Example: Deleting a boat that has moved to its beginner life isn't allowed
      Given a boat that has moved to its beginner life
      When an admin deletes the boat
      Then the inventory doesn't allow it
      And the boat is still in the inventory

  Rule: A rack or deck space with storage agreements can't be deleted

    Example: Deleting a rack a sailor stores their boat on isn't allowed
      Given a rack with a sailor's storage agreement on it
      When an admin deletes the rack
      Then the inventory doesn't allow it
      And the rack is still in the inventory

  Rule: Deleting a rack or deck space leaves the boats on it stored nowhere

    Example: Deleting a rack keeps its boats in the inventory
      Given one of CSC's boats on a rack no sailor stores a boat on
      When an admin deletes the rack
      Then the boat is still in the inventory, stored nowhere

  Rule: Each charter has a boat, a sailor, a charter product, its dates, and its fee

    Example: A charter with no sailor isn't allowed
      When an admin adds a charter with no sailor
      Then the inventory doesn't allow it

  Rule: Each storage agreement has a sailor, a rack or deck space, a storage product, a start date, and a fee

    Example: A storage agreement with no start date isn't allowed
      When an admin adds a storage agreement with no start date
      Then the inventory doesn't allow it

  Rule: Damage is open, repaired, or written off

    Example: Damage with no status isn't allowed
      When an admin logs damage with no status
      Then the inventory doesn't allow it

  Rule: An Inventory Reader can see the inventory, but can't change it

    Example: An Inventory Reader looks up the inventory
      Given a user with the Inventory Reader policy
      Then they can see the inventory
      But they can't change the inventory

  Rule: An Inventory Writer can change boats, charters, damage, and storage

    Example: An Inventory Writer adds, edits, and deletes boats, charters, damage, and storage
      Given a user with the Inventory Writer policy
      Then they can change boats, charters, damage, and storage

  Rule: An Inventory Writer moves a boat to its next stage by adding a stage change, and only an admin can edit or delete one

    Example: An Inventory Writer can add stage changes, but can't edit or delete them
      Given a user with the Inventory Writer policy
      Then they can add and see stage changes
      But they can't edit or delete stage changes

  Rule: The Inventory policies can see boat classes and products, but can't change them

    Scenario Outline: Each Inventory policy can see boat classes and products
      Given a user with the <policy> policy
      Then they can see boat classes and products
      But they can't change boat classes and products

      Examples:
        | policy           |
        | Inventory Reader |
        | Inventory Writer |

  Rule: The Inventory policies can see sailors' names, but not the rest of their details

    Scenario Outline: Each Inventory policy can see a sailor's name, but not their email
      Given a user with the <policy> policy
      Then they can see sailors' names
      But they can't see sailors' emails or phone numbers

      Examples:
        | policy           |
        | Inventory Reader |
        | Inventory Writer |

  Rule: Only admins and people with an Inventory policy can see the inventory

    Scenario Outline: Other policies can't see the inventory
      Given a user with the <policy> policy
      Then they can't see the inventory

      Examples:
        | policy         |
        | CRM Writer     |
        | Catalog Writer |
        | Plan Writer    |

    Example: A Crew member can't see the inventory
      Given a user with the Crew role
      Then they can't see the inventory
