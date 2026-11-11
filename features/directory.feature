Feature: The directory
  The directory lists the organizations our programs sail with and the venues where events are
  sailed. An organization is a yacht club, a class association, a regional organizer, a governing
  body, a sailing center, or one of our own. A venue can be run by one of these organizations, or by
  no one we track, such as a public marina.

  Only admins can change the directory. People with a Catalog or Plan policy can see it. To change
  something means to add, edit, or delete it.

  Rule: A venue doesn't need an organization

    Example: An admin adds a public marina
      When an admin adds a venue with no organization
      Then the venue is in the directory

  Rule: An organization that runs a venue can't be deleted

    Example: Deleting an organization with a venue isn't allowed
      Given an organization that runs a venue
      When an admin deletes the organization
      Then the directory doesn't allow it
      And the organization is still in the directory

  Rule: Only admins can change the directory

    Example: An admin can change the directory
      Given a user with the Admin role
      Then they can change the directory

    Scenario Outline: Each Catalog and Plan policy can see the directory, but can't change it
      Given a user with the <policy> policy
      Then they can see the directory
      But they can't change the directory

      Examples:
        | policy         |
        | Catalog Reader |
        | Catalog Writer |
        | Plan Reader    |
        | Plan Writer    |
