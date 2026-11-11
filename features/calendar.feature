Feature: The calendar
  Race and program staff plan around regattas and clinics that other organizations run, and around
  holidays and school days off. The calendar keeps all of these in one place. An event is one
  regatta or clinic on its dates. Each event has an organizer, such as a yacht club or a class
  association, and may have a venue, the place it's sailed. An event can be for one or more boat
  classes, such as Opti or ILCA, and can be marked as one CSC supports. A regatta or clinic that
  comes back every year belongs to a series, so next year's dates can be guessed from this year's.

  Each event on the calendar is confirmed, because its dates are posted, or cancelled. A guess at
  next year's dates, and last year's event, show on the calendar but aren't kept on it, so a guess
  never needs deleting once the real dates are posted.

  The calendar also holds named calendars of dates, each in its own colour: public holidays, a
  school district's days off, and staff's own dates, such as closures or training days. Plans keep
  their own closed dates, and planning never changes the calendar.

  Race and program staff change the calendar. They have the Calendar Writer policy. The Calendar
  Reader policy lets someone see the calendar without changing it. Both can see the organizations,
  venues, and boat classes an event names, but only admins change those. To change something
  means to add, edit, or delete it.

  Rule: Each event has a start date and an organizer

    Scenario Outline: An event with no <detail> isn't allowed
      When an admin adds an event with no <detail>
      Then the calendar doesn't allow it

      Examples:
        | detail     |
        | start date |
        | organizer  |

  Rule: An event is confirmed or cancelled, so a guess at its dates can't be kept as an event

    Example: Adding an event marked as a guess isn't allowed
      When an admin adds an event marked as projected
      Then the calendar doesn't allow it

  Rule: Nothing the calendar uses can be deleted while it's in use

    Scenario Outline: Deleting <thing> isn't allowed
      Given <thing>
      When an admin deletes it
      Then the calendar doesn't allow it
      And it's still there

      Examples:
        | thing                           |
        | an organizer that runs an event |
        | a venue an event is sailed at   |
        | a series with an event in it    |
        | a boat class an event is for    |
        | a calendar with a date on it    |

  Rule: A wrong event can be deleted, even when it names boat classes

    Example: Deleting an event for a boat class
      Given an event for a boat class
      When an admin deletes the event
      Then the event is gone
      But the boat class is still in the catalog

  Rule: A Calendar Reader can see the calendar, but can't change it

    Example: A Calendar Reader looks up the calendar
      Given a user with the Calendar Reader policy
      Then they can see the calendar
      But they can't change the calendar

  Rule: A Calendar Writer can change the calendar

    Example: A Calendar Writer adds, edits, and deletes events, series, calendars, and their dates
      Given a user with the Calendar Writer policy
      Then they can change the calendar

  Rule: The Calendar policies can see the organizations, venues, and boat classes, but can't change them

    Scenario Outline: A <policy> looks up who runs an event, where, and for which boats
      Given a user with the <policy> policy
      Then they can see the organizations and venues
      And they can see boat classes
      But they can't change the organizations and venues
      And they can't change boat classes

      Examples:
        | policy          |
        | Calendar Reader |
        | Calendar Writer |

  Rule: Planners can't change the calendar

    Example: A Plan Writer can't change the calendar
      Given a user with the Plan Writer policy
      Then they can't change the calendar

  Rule: Only admins and people with a Calendar policy can see the calendar

    Example: A family member can't see the calendar
      Given a user with the Community role
      Then they can't see the calendar
