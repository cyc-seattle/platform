Feature: Sail Team's links and announcements
  Sail Team has a Links page, which lists the pages staff and families use most, such as the draft
  of CSC's new website. Each link shows a preview of the page it leads to, the way a social network
  does: the page's own title, summary, and picture, read from the page when the link is saved. Sail
  Team's home page shows announcements, such as what's new in Sail Team, newest first.

  Everyone who signs in can see the links and the announcements. Admins, and people with the Link
  Writer policy, change the links. Admins, and people with the Announcement Writer policy, change
  the announcements. To change something means to add, edit, or delete it.

  Rule: Everyone who signs in can see the links and the announcements, but can't change them

    Scenario Outline: A user with the <role> role can see the links and the announcements
      Given a user with the <role> role
      Then they can see Sail Team's links
      And they can see Sail Team's announcements
      But they can't change Sail Team's links
      And they can't change Sail Team's announcements

      Examples:
        | role      |
        | Community |
        | Team      |
        | Crew      |
        | Staff     |

  Rule: A Link Writer can change the links, but not the announcements

    Example: A Link Writer adds, edits, and deletes links
      Given a user with the Community role and the Link Writer policy
      Then they can change Sail Team's links
      But they can't change Sail Team's announcements

  Rule: An Announcement Writer can change the announcements, but not the links

    Example: An Announcement Writer adds, edits, and deletes announcements
      Given a user with the Community role and the Announcement Writer policy
      Then they can change Sail Team's announcements
      But they can't change Sail Team's links

  Rule: A link shows a preview of the page it leads to

    Example: A new link to the draft website shows the website's own title
      Given a user with the Community role and the Link Writer policy
      When they add a link to https://csc-website.web.app
      Then the link's preview shows the title "CYC Community Sailing Center"

  Rule: Only the page a link leads to sets its preview

    Example: A Link Writer can't write a link's preview themselves
      Given a user with the Community role and the Link Writer policy
      When they set a link's preview title themselves
      Then it isn't allowed
