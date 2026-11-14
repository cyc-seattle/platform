Feature: CSC's boats and equipment
  The asset list is the boats and equipment CSC owns: sailboats, such as Optis and 420s, powerboats,
  such as the coach boats, motors, and other things, such as trailers and the van. Each can have a
  name, a make and model, the number that identifies it (a boat's hull number, a vehicle's VIN, or a
  serial number), a registration number, its book value, the date CSC got it, and the date CSC
  disposed of it. One with no disposed date is still CSC's. A sailboat has a boat class from the
  catalog, such as Opti or 420, which is its model, and can have a sail number. Sailors' own boats
  aren't on the list.

  Planning counts the sailboats and powerboats on each day: CSC has a boat from the day it got it
  until the day it disposed of it, and one with no date CSC got it counts from the start. A boat CSC plans to
  buy goes on the list with the date it's expected, so it counts from then in every plan.

  The asset list is part of the catalog, so the same people keep it: admins, and people with the
  Catalog Writer policy. The Catalog Reader policy lets someone see it without changing it. So do
  the Plan Reader and Plan Writer policies, since planners count the boats they plan with. To change
  something means to add, edit, or delete it.

  Rule: A Catalog Writer can change the asset list

    Example: A Catalog Writer adds, edits, and deletes boats and equipment
      Given a user with the Catalog Writer policy
      Then they can change the asset list

  Rule: Catalog Readers and planners can see the asset list, but can't change it

    Scenario Outline: Each Catalog Reader and planning policy can see the asset list
      Given a user with the <policy> policy
      Then they can see the asset list
      But they can't change the asset list

      Examples:
        | policy         |
        | Catalog Reader |
        | Plan Reader    |
        | Plan Writer    |

  Rule: Only admins and people with a Catalog or Plan policy can see the asset list

    Example: A Crew member can't see the asset list
      Given a user with the Crew role
      Then they can't see the asset list

    Example: A family member can't see the asset list
      Given a user with the Community role
      Then they can't see the asset list
