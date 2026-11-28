Feature: The plan-to-catalog sync
  After the board approves a Financial Plan, a Catalog Writer brings it into the catalog with a sync. The sync
  compares the frozen Financial Plan in force for a year with the catalog offerings its offerings plan, and shows
  each difference: an offering's dates, capacity and price, its schedule, and its activities. The Catalog Writer
  reviews the differences in Sail Team and applies the ones they choose. Nothing is kept between syncs, so a
  difference shows every time until the plan and the catalog agree.

  An offering's schedule is the days of the week it meets, worked out from the plan's activities: each weekday with
  an activity in at least half the weeks that have any, at the times most of them share. Every figure here is made
  up.

  Rule: The sync shows each value the plan gives an offering that its catalog offering doesn't have

    Example: The board raised a price
      Given a frozen Financial Plan that plans an offering at $395 a sailor
      And its catalog offering is $350 a sailor
      When the sync compares the plan with the catalog
      Then it shows the offering's price changing from $350 to $395

  Rule: The sync adds the plan's activities to the catalog, and archives one the plan doesn't have

    Example: Two practices to add, and one to archive
      Given a frozen Financial Plan that plans an offering with practices on June 21 and June 23
      And its catalog offering has a practice on June 24
      When the sync compares the plan with the catalog
      Then it adds the practices on June 21 and June 23
      And it archives the practice on June 24

  Rule: A plan activity with no start or end time stays out of the catalog

    Example: A practice with no times yet
      Given a frozen Financial Plan that plans an offering with a practice on June 21 with no times
      When the sync compares the plan with the catalog
      Then it skips the practice on June 21

  Rule: An offering's schedule is each weekday with an activity in at least half the weeks

    Example: Tuesdays and Thursdays, and one Saturday
      Given a frozen Financial Plan that plans an offering with practices every Tuesday and Thursday for four weeks
      And a practice on one Saturday
      When the sync compares the plan with the catalog
      Then it shows the offering's schedule as Tuesdays and Thursdays

  Rule: The sync reads only a frozen Financial Plan, whose numbers the board approved

    Example: A draft
      Given a draft Financial Plan that plans an offering at $395 a sailor
      When the sync compares the plan with the catalog
      Then it refuses, since the plan is a draft

  Rule: A catalog offering another of the year's Financial Plans plans, but the plan in force doesn't, is archived

    Example: A week the board cut
      Given a frozen Financial Plan that plans an offering at $395 a sailor
      And another of the year's Financial Plans plans another offering
      When the sync compares the plan with the catalog
      Then it archives the other offering
