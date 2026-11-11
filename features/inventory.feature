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

  Each year, CSC sets money aside to replace its boats as they wear out: the boat replacement
  reserve. A boat's value is set aside evenly over the years its boat class lasts, whether or not
  it's sailed. A plan shows each offering's share of the reserve below operating net, for
  information only, so it doesn't change any net. Every figure here is made up.

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

  @pending
  Rule: A boat's value is set aside evenly over its boat class's years, whether or not it's sailed

    Example: An Opti worth $3,650 sets aside $730 a year
      Given Optis that last 5 years
      And an Opti worth $3,650, in service for the whole plan year
      When a planner looks at the plan
      Then the organization's boat replacement reserve is $730

  @pending
  Rule: A boat sets aside money only for the days of the year it's in service

    Example: An Opti that goes into service halfway through the year sets aside half
      Given Optis that last 5 years
      And an Opti worth $3,650 that goes into service halfway through the plan year
      When a planner looks at the plan
      Then the organization's boat replacement reserve is $365

  @pending
  Rule: A boat stops setting money aside when it retires, or when its years are up

    Example: An Opti that retires halfway through the year sets aside half
      Given Optis that last 5 years
      And an Opti worth $3,650 that retires halfway through the plan year
      When a planner looks at the plan
      Then the organization's boat replacement reserve is $365

    Example: An Opti whose 5 years are up sets aside nothing
      Given Optis that last 5 years
      And an Opti worth $3,650 that went into service 5 years before the plan year
      When a planner looks at the plan
      Then the organization's boat replacement reserve is $0

  @pending
  Rule: A boat class's reserve is split among the offerings that sail it, by their time on the water

    Example: Two offerings split the Optis' reserve 2 to 1
      Given Optis that last 5 years
      And an Opti worth $3,650, in service for the whole plan year
      And Guppies sails 4 of CSC's Optis for 2 hours, and Minnows sails 2 for 2 hours
      When a planner looks at the plan
      Then Guppies' boat replacement reserve is $486.67
      And Minnows' boat replacement reserve is $243.33

  @pending
  Rule: Boats sailors bring don't count toward an offering's time on the water

    Example: An offering that sails only its sailors' own Optis gets none of the reserve
      Given Optis that last 5 years
      And an Opti worth $3,650, in service for the whole plan year
      And Guppies sails 4 of CSC's Optis for 2 hours, and Minnows sails only Optis its sailors bring
      When a planner looks at the plan
      Then Guppies' boat replacement reserve is $730
      And Minnows' boat replacement reserve is $0

  @pending
  Rule: A chartered boat's reserve is split like any other boat's

    Example: A charter doesn't take a share of the reserve
      Given Optis that last 5 years
      And an Opti worth $3,650, chartered to a sailor for the whole plan year
      And Guppies sails 4 of CSC's Optis for 2 hours
      When a planner looks at the plan
      Then Guppies' boat replacement reserve is $730

  @pending
  Rule: A boat class no offering sails keeps its reserve with the organization, and the planner is warned

    Example: No offering sails the Optis
      Given Optis that last 5 years
      And an Opti worth $3,650, in service for the whole plan year
      And no offering sails Optis
      When a planner looks at the plan
      Then the organization's boat replacement reserve is $730
      And the planner is warned that no offering sails CSC's Opti boats

  @pending
  Rule: The boat replacement reserve doesn't change any offering's net

    Example: Guppies' net is the same with the reserve as without it
      Given Optis that last 5 years
      And an Opti worth $3,650, in service for the whole plan year
      And Guppies sails 4 of CSC's Optis for 2 hours
      When a planner looks at the plan
      Then Guppies' net is the same as with no boats in the inventory
