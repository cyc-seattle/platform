Feature: Tracking the year
  A program area's directors track how the year is going against its plan: how many sailors have
  registered, and how much money has come in, for each offering they planned. Tracking covers one
  program area for one year, with no terms or seasons, because not every program has them.

  Tracking compares against the active Financial Plan. A planner marks one saved Financial Plan
  active for its year, once it's the one the organization is running. There can be several saved
  Financial Plans for a year, and a new one can start from any of them, so the newest isn't always
  the one being run. Marking another one active replaces it, and the earlier marks are kept, so
  anyone can see which Financial Plan was active when.

  A planned offering is an offering in a plan, such as Guppies Summer, with its price and the
  number of sailors expected. A Clubspot offering is what families sign up for in Clubspot: one of a
  program's classes in one session, such as Guppies week 3. The Clubspot sync makes the Clubspot
  offerings, and registers each sailor in theirs. A planner links each Clubspot offering, by hand, to
  the planned offering it belongs to. Several Clubspot offerings can link to one planned offering,
  such as the eight weeks of Guppies. A new Financial Plan copies its planned offerings from the one
  it started from, so a link made once still holds in it.

  Money collected is what families have paid, less what they've been refunded. A family can pay for
  several Clubspot offerings with one payment. Tracking then splits that payment among them by their
  planned offerings' prices.

  Planners are the people with the Plan Reader or Plan Writer policy. Every figure here is made up.

  @pending
  Rule: Only one Financial Plan is active for a year at a time

    Example: Marking another Financial Plan active replaces the first
      Given a user with the Plan Writer policy
      And two saved Financial Plans for next year, "Board budget" and "Smaller fleet"
      And "Board budget" is active
      When they mark "Smaller fleet" active
      Then "Smaller fleet" is next year's active Financial Plan
      And they can see that "Board budget" was active before it

    Example: A draft Financial Plan can't be active
      Given a user with the Plan Writer policy
      And a draft Financial Plan for next year
      When they try to mark it active
      Then they're told that only a saved Financial Plan can be active

  @pending
  Rule: A planner links each Clubspot offering to a planned offering by hand

    Example: Three weeks of Guppies link to one planned offering
      Given a user with the Plan Writer policy
      And an active Financial Plan with a planned offering "Guppies Summer"
      And three Clubspot offerings of Guppies, for weeks 1, 2, and 3
      When they link all three to "Guppies Summer"
      Then tracking counts all three Clubspot offerings under "Guppies Summer"

    Example: A link still holds in a Financial Plan started from the one it was made in
      Given a Clubspot offering linked to "Guppies Summer" in "Board budget"
      And a planner starts a new Financial Plan from "Board budget"
      When the new Financial Plan is marked active
      Then tracking counts the Clubspot offering under "Guppies Summer" in the new Financial Plan

  @pending
  Rule: Tracking compares registered sailors with planned sailors for each planned offering

    Example: Only confirmed sailors count as registered
      Given an active Financial Plan that expects 10 sailors in "Guppies Summer"
      And a Clubspot offering linked to it, with 6 confirmed sailors, 2 on the waitlist, and 1 cancelled
      When a planner looks at tracking for the program area
      Then "Guppies Summer" shows 6 sailors registered of 10 planned

  @pending
  Rule: Tracking compares money collected with planned revenue for each planned offering

    Example: Refunds come off what's been collected
      Given an active Financial Plan that expects 10 sailors in "Guppies Summer" at $400 a sailor
      And a Clubspot offering linked to it, where families have paid $2,400 and been refunded $400
      When a planner looks at tracking for the program area
      Then "Guppies Summer" shows $2,000 collected of $4,000 planned

    Example: One payment for two offerings is split by their planned prices
      Given an active Financial Plan with "Guppies Summer" at $400 a sailor and "Opti Summer" at $200 a sailor
      And a family who paid $600 once for a Clubspot offering of each
      When a planner looks at tracking for the program area
      Then "Guppies Summer" shows $400 collected from that payment
      And "Opti Summer" shows $200 collected from that payment

  @pending
  Rule: Tracking lists Clubspot offerings that aren't linked to any planned offering

    Example: A Clubspot offering with sailors but no link is not in the plan
      Given an active Financial Plan for the program area
      And a Clubspot offering of one of its programs, with 4 confirmed sailors and no link
      When a planner looks at tracking for the program area
      Then the Clubspot offering is listed as not in the plan, with its 4 sailors

  @pending
  Rule: A Clubspot offering keeps its link when the Clubspot sync runs again

    Example: A linked Clubspot offering whose session is archived in Clubspot stays
      Given a Clubspot offering linked to "Guppies Summer"
      And its session is archived in Clubspot
      When the Clubspot sync runs again
      Then the Clubspot offering is still linked to "Guppies Summer", marked archived

  @pending
  Rule: A Plan Reader can see tracking, but can't link offerings or mark a Financial Plan active

    Example: A Plan Reader looks at tracking
      Given a user with the Plan Reader policy
      Then they can see tracking for a program area, money collected included
      But they can't link a Clubspot offering to a planned offering
      And they can't mark a Financial Plan active

  @pending
  Rule: Crew can't see tracking or what families have paid

    Example: A Crew member looks for tracking
      Given a user with the Crew role
      Then they can't see tracking for a program area
      And they can't see what families have paid
