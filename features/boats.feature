Feature: CSC's boats
  The boat list is every boat CSC owns, for planning the year. Each boat has a boat class from the
  catalog, such as Opti or 420, and can have a name, a sail number, a hull number, and what it's
  worth. It can also have the dates CSC got it, first sailed it in a program, and stopped using it.
  A boat with no retired date is still in use. Sailors' own boats aren't on the list.

  The boat list is part of the catalog, so the same people keep it: admins, and people with the
  Catalog Writer policy. The Catalog Reader policy lets someone see it without changing it. So do
  the Plan Reader and Plan Writer policies, since planners count the boats they plan with. To change
  something means to add, edit, or delete it.

  Rule: A Catalog Writer can change the boat list

    Example: A Catalog Writer adds, edits, and deletes boats
      Given a user with the Catalog Writer policy
      Then they can change the boat list

  Rule: Catalog Readers and planners can see the boat list, but can't change it

    Scenario Outline: Each Catalog Reader and planning policy can see the boat list
      Given a user with the <policy> policy
      Then they can see the boat list
      But they can't change the boat list

      Examples:
        | policy         |
        | Catalog Reader |
        | Plan Reader    |
        | Plan Writer    |

  Rule: Only admins and people with a Catalog or Plan policy can see the boat list

    Example: A Crew member can't see the boat list
      Given a user with the Crew role
      Then they can't see the boat list

    Example: A family member can't see the boat list
      Given a user with the Community role
      Then they can't see the boat list
