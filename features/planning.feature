Feature: Plans
  A Financial Plan is the organization's plan for one year. It holds one Operations Plan and a
  Program Plan for any of the organization's program areas, and the P&L they make together. A
  Program Plan covers one program area: what it offers and when, the prices, the schedule, who works
  it, and the budget. The area's directors plan it. The Operations Plan covers what the program
  areas share, such as the office, the boats, and the year's rates. It also plans the products that
  belong to no program area: merchandise, storage, and charters.

  A Financial Plan is worked on as a whole. It starts as a draft, and planners can change any of
  its plans while it's a draft. When it's ready, a planner saves it, and all of its plans are saved
  together, with their P&L. A saved Financial Plan never changes, apart from its name and note, so
  the organization can always look back at what it agreed to. To change the plan after that, a planner starts a new Financial
  Plan from an earlier one, its parent, and the new one begins as a copy of it. A year can have
  several drafts at once, so planners can weigh options side by side, such as two drafts started
  from the same Financial Plan, one with two coaches and one with three. Each Financial Plan has a
  name, and a note that says what it was for, such as "Reviewed with the board". Planners are the
  people with the Plan Reader or Plan Writer policy, which they get from their groups.

  A planner marks one saved Financial Plan active for its year. That's the plan the organization is
  running, and what actually happens during the year is compared against it. Marking another one
  active replaces it, and sets the one before it back to saved. Each Financial Plan's history shows
  who marked it active, and when. Each offering in a plan is of a catalog offering: a named offering
  of a program, such as "J-Pod · fall practices", which Clubspot's offerings are linked to as well.
  So Clubspot's sign-ups find their offering in whichever Financial Plan is active. An offering's
  activities, such as practices and regattas, stay the same ones in a Financial Plan started from
  another.

  The P&L, the profit and loss for the year, is worked out from a Financial Plan's plans together.
  It shows each offering, each program area, and the organization as a whole. A draft's P&L is
  worked out again a moment after every change to it, whether the change was made in the app, in
  the Data Studio, or by an AI. A saved Financial Plan keeps the P&L it had when it was saved, and
  that never changes either. Each line of a saved P&L says in plain words what it is.
  Shared costs are the costs that several offerings share, such as the office. They're divided
  among all of a Financial Plan's offerings by their direct costs, counted the way federal grant
  rules count them, so each Program Plan's P&L includes its share of them. Some charges are set as
  a share of revenue, such as scholarships or card fees. The Operations Plan lists each one, with
  its rate and the kinds of product it applies to. Revenue from programs and other sales pays for
  the organization's running costs. Fundraising pays for capital, such as a new coach boat, so
  capital is never charged to a program area.

  Each Program Plan sets two numbers for each of its programs: the staff level that coaches it, such
  as Level 1 Instructor, and how many sailors each coach can take. These are the program's
  settings, and two drafts can try different ones. Each boat class says how many sailors one boat
  takes. The Operations Plan says how many boats of each class the organization has, and how many
  RIBs and other equipment.

  Each plan can also hold the planner's rules: what they want that the plan's numbers don't
  capture, in their own words, for their AI to follow when it fills in the plan. A program has its
  own rules, such as "if there are more than 12 Guppies, add a Junior Instructor", or "Guppies can
  sail the Harpoon, up to 10 kids, instead of Sailqubes". A Program Plan's rules cover all of its
  programs, such as "J-Pod and K-Pod share coaches on Wednesdays". The Operations Plan's rules cover
  the whole organization, such as "keep one RIB ashore for repairs on summer weekdays". The P&L
  never reads the rules.

  The schedule is planned in blocks. A block is one or more activities on one date that share
  their coaches and boats, such as Guppies and Minnows on the morning of July 13. Each block lists
  its staff (the people who coach it), the RIBs and other equipment it uses, and its boats of each
  class: the organization's own, and the ones sailors bring. A block runs from its first activity's start
  to its last activity's end. The P&L costs only what the blocks are given, and nothing works out
  how many coaches or boats a program needs. The planner, or their AI, decides that from the
  program settings and the rules.

  A planner is warned when the blocks break a limit: more of the organization's boats, RIBs, or
  equipment out at once than it has, too few coaches or boats for a block's sailors, or
  an activity with no staff. Each warning says which plan and date it's about. Each coach
  in a block can safely take the program's number of sailors, if they're at the program's staff
  level. A plan doesn't count on a coach at one level covering another. A salaried coach, such as a
  director, counts as one coach for any program in their block. Each boat can take its class's number of sailors, and the boats that
  sailors bring count too.

  A planner can ask their AI to fill in the blocks. It works in a new draft Financial Plan, started
  from the one the planner names. It tells the planner what it changed and which warnings are left,
  and gives the draft a one-line note, such as "Allocated Summer weeks 3 to 5". If the planner likes
  the draft, they save it. If not, they delete it.

  The Operations Plan also lists closed days, such as Labor Day, so that no one plans a practice on
  one by mistake.

  Plans include wages and bonus rates. Wages are what each staff level is paid per hour, and what
  each salaried position is paid per year. A salaried coach can also be paid by the hour for
  coaching, on top of their salary, at their own hourly rate. Bonus rates set the bonus a director
  earns on the products they run: a share of those products' net, the money they make after their
  costs. A bonus for one program area's products is in that area's Program Plan. A bonus on
  products from more than one area is in the Operations Plan. Anyone who can see plans sees
  all of these. To change something means to add, edit, or delete it.

  Rule: A Financial Plan holds one Operations Plan, and a Program Plan for any of the program areas

    Example: A Financial Plan can start with only an Operations Plan
      Given a user with the Plan Writer policy
      When they start a Financial Plan for next year with only an Operations Plan
      Then the Financial Plan is a draft, with the Operations Plan in it

    Example: A Financial Plan can't be saved without an Operations Plan
      Given a user with the Plan Writer policy
      And a draft Financial Plan with a Program Plan but no Operations Plan
      When they try to save the Financial Plan
      Then they're told that the Financial Plan needs an Operations Plan
      And the Financial Plan is still a draft

  Rule: A Financial Plan holds at most one Program Plan for each program area

    Example: A second Program Plan for the same program area
      Given a user with the Plan Writer policy
      And a draft Financial Plan with a Program Plan for Youth Racing
      When they try to add another Program Plan for Youth Racing to it
      Then they're told that the Financial Plan already has a Program Plan for Youth Racing

  Rule: Saving a Financial Plan saves all of its plans together

    Example: The Operations Plan and both Program Plans are saved with the Financial Plan
      Given a user with the Plan Writer policy
      And a draft Financial Plan with an Operations Plan and two Program Plans
      When they save the Financial Plan
      Then the Financial Plan and all three of its plans are saved at the same moment

  Rule: A year can have several draft Financial Plans at once

    Example: Two options for the same year
      Given a user with the Plan Writer policy
      And a draft Financial Plan for next year named "Two coaches"
      When they start another draft Financial Plan for next year named "Three coaches"
      Then next year has both drafts

  Rule: A new Financial Plan starts as a copy of the one it's started from

    Example: The new Financial Plan has the same offerings and prices
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget" with an offering at $1,000 a sailor
      When they start a new Financial Plan from "Budget"
      Then the new Financial Plan has the same offering at $1,000 a sailor
      And its parent is "Budget"

    Example: Changing the new Financial Plan doesn't change its parent
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget" with an offering at $1,000 a sailor
      And they started a new Financial Plan from "Budget"
      When they change the offering's price to $1,200 a sailor in the new Financial Plan
      Then "Budget" still has the offering at $1,000 a sailor

  Rule: Each Program Plan sets its programs' staff levels and how many sailors each coach can take

    Example: A new draft tries fewer sailors per coach
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget" where Guppies have a coach for every 10 sailors
      And they started a new Financial Plan from "Budget"
      When they change Guppies to a coach for every 8 sailors in the new Financial Plan
      Then "Budget" still has Guppies with a coach for every 10 sailors

  Rule: An offering and its activities stay the same ones in a Financial Plan started from it

    Example: An offering stays of the same catalog offering
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget" with an offering of "J-Pod · fall practices"
      When they start a new Financial Plan from "Budget"
      Then the new Financial Plan's offering is of "J-Pod · fall practices" too

    Example: A practice is the same practice in the new Financial Plan
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget" with a practice on June 6
      When they start a new Financial Plan from "Budget"
      Then its practice on June 6 is the same practice as the one in "Budget"

  Rule: A planner marks one saved Financial Plan active for its year

    Example: Marking another Financial Plan active replaces the active one
      Given a user with the Plan Writer policy
      And two saved Financial Plans for next year, "Budget" marked active and "Adopted budget"
      When they mark "Adopted budget" active
      Then "Adopted budget" is the active Financial Plan for next year
      And "Budget" is saved, and no longer active

    Example: A draft can't be marked active
      Given a user with the Plan Writer policy
      And a draft Financial Plan
      When they try to mark it active
      Then they're told that only a saved Financial Plan can be active

  Rule: A saved Financial Plan never changes, even for an admin

    Example: A Plan Writer can't change a saved Financial Plan
      Given a user with the Plan Writer policy
      And a saved Financial Plan
      Then they can't change the Financial Plan or any of its plans
      And they can't turn the Financial Plan back into a draft
      And they can't delete the Financial Plan

    Example: An admin can't change a saved Financial Plan either
      Given a user with the Admin role
      And a saved Financial Plan
      Then they can't change the Financial Plan or any of its plans
      And they can't turn the Financial Plan back into a draft
      And they can't delete the Financial Plan

  Rule: A Plan Writer can change a saved Financial Plan's name and note

    Example: A plan is noted as reviewed with the board
      Given a user with the Plan Writer policy
      And a saved Financial Plan
      Then they can change its note to "Reviewed with the board"

    Example: A saved plan is renamed after the board adopts it
      Given a user with the Plan Writer policy
      And a saved Financial Plan
      Then they can change its name to "2027 budget as adopted"
      And its P&L stays the same

  Rule: A Program Plan holds only its own program area's programs

    Example: A plan with another program area's program gets a warning
      Given a Program Plan
      And an offering in it of a program from another program area
      When a planner calculates the P&L
      Then the planner is warned that the offering is in the wrong plan

  Rule: Merchandise, storage, and charters are planned in the Operations Plan

    Example: The Operations Plan sells merchandise
      Given the Operations Plan sells $1,000 of merchandise
      When a planner calculates the P&L
      Then the organization's totals include $1,000 of merchandise sales

  Rule: Every program belongs to a program area

    Example: A program with no program area gets a warning
      Given a program with no program area
      And a plan with an offering of that program
      When a planner calculates the P&L
      Then the planner is warned that the program has no program area

  Rule: A program area's P&L adds up its offerings and the costs charged to the area

    Example: A program area's P&L includes its storage
      Given a program area with two offerings that each take in $10,000
      And $3,000 of storage charged to the program area
      When a planner calculates the P&L
      Then the program area takes in $20,000
      And its costs include the $3,000 of storage

  Rule: A cost charged to a program area is shared among the area's offerings by their direct costs

    Example: Storage is split two to one when one offering's direct costs are twice the other's
      Given a program area with two offerings, the first with twice the direct costs of the second
      And $3,000 of storage charged to the program area
      When a planner calculates the P&L
      Then the first offering pays $2,000 of the storage
      And the second offering pays $1,000 of the storage

    Example: A salaried director's hours charged to a program area are shared among its offerings
      Given a program area with two offerings with the same direct costs
      And a salaried director paid $50 an hour, with 100 hours charged to the program area
      When a planner calculates the P&L
      Then each offering pays $2,500 of the director's salary

  Rule: A charge set as a share of revenue follows each offering's price and enrollment

    Scenario Outline: Scholarships are 2% of a program's revenue
      Given the Operations Plan sets scholarships at 2% of programs' revenue
      And an offering of a program at <price> a sailor, with <sailors> sailors
      When a planner calculates the P&L
      Then the offering's scholarships are <scholarships>

      Examples:
        | price | sailors | scholarships |
        | $500  | 20      | $200         |
        | $600  | 20      | $240         |
        | $500  | 10      | $100         |

    Example: A charge applies only to the kinds of product it names
      Given the Operations Plan sets scholarships at 2% of programs' revenue
      And the Operations Plan sells $1,000 of merchandise
      When a planner calculates the P&L
      Then the merchandise has no scholarships

  Rule: Card fees that families pay are revenue, and the card company's fees are a cost

    Example: An offering collects card fees from families and pays them to the card company
      Given the Operations Plan collects card fees from families at 3% of revenue
      And the Operations Plan pays card fees at 3% of revenue
      And an offering of a program that takes in $10,000
      When a planner calculates the P&L
      Then the offering takes in $300 of card fees from families
      And the offering pays $300 of card fees

  Rule: A charge set as a share of revenue counts toward the split of shared costs only if the Operations Plan says so

    Example: Scholarships don't change an offering's share of the office
      Given two offerings with the same direct costs
      And scholarships on the first offering only, which don't count toward the split
      And $1,000 of office costs shared by every offering
      When a planner calculates the P&L
      Then each offering pays $500 of the office costs

  Rule: Capital is never charged to a program area or an offering

    Example: Buying a coach boat shows only in the organization's totals
      Given the Operations Plan buys a $20,000 coach boat
      When a planner calculates the P&L
      Then no offering or program area pays for the coach boat
      And the organization's totals show $20,000 of capital

    Example: A coach boat charged to a program area goes to the organization's totals instead
      Given a $20,000 coach boat charged to a program area
      When a planner calculates the P&L
      Then the program area doesn't pay for the coach boat
      And the organization's totals show $20,000 of capital
      And the planner is warned that capital can't be charged to a program area

  Rule: The organization's totals show the operating net, then fundraising and capital, then the total

    Example: Fundraising pays for capital below the operating net
      Given programs that take in $100,000 and cost $90,000
      And donations of $30,000, which cost $5,000 to raise
      And the Operations Plan buys a $20,000 coach boat
      When a planner calculates the P&L
      Then the organization's totals are:
        | line            | amount   |
        | operating net   | $10,000  |
        | fundraising net | $25,000  |
        | capital         | -$20,000 |
        | total           | $15,000  |

  Rule: A Program Plan can pay a director a bonus on that area's programs

    Example: A director's bonus in a Program Plan
      Given a Program Plan that pays its director 50% of its programs' net
      And its programs make $10,000 after their costs and shared costs
      When a planner calculates the P&L
      Then the director's bonus is $5,000

    Example: A Program Plan can't pay a bonus on another area's program
      Given a Program Plan that pays its director a bonus on a program from another program area
      When a planner calculates the P&L
      Then the planner is warned that the bonus is on another program area's program
      And the other area's program doesn't count toward the bonus

  Rule: A bonus is figured on the net after shared costs, or before them, as the plan says

    Scenario Outline: A director's bonus before and after shared costs
      Given a director who earns 50% of their programs' net <counted>
      And their programs take in $30,000 and cost $20,000, plus $6,000 of shared costs
      When a planner calculates the P&L
      Then the director's bonus is <bonus>

      Examples:
        | counted             | bonus  |
        | after shared costs  | $2,000 |
        | before shared costs | $5,000 |

  Rule: The organization pays payroll tax on a bonus, as on any wage

    Example: A bonus costs payroll tax
      Given payroll tax at 10% of wages
      And a director whose bonus is $5,000
      When a planner calculates the P&L
      Then the organization pays $500 of payroll tax on the bonus

  Rule: A bonus and its payroll tax don't count toward the split of shared costs

    Example: A director's bonus doesn't change an offering's share of the office
      Given two offerings with the same direct costs
      And a director's bonus, with its payroll tax, on the first offering only
      And $1,000 of office costs shared by every offering
      When a planner calculates the P&L
      Then each offering pays $500 of the office costs

  Rule: The P&L costs only the staff, RIBs, and boats each block is given

    Example: A block's coaches are paid for its time
      Given an offering with a practice from 9am to noon, in a block with 2 coaches paid $20 an hour
      When a planner calculates the P&L
      Then the offering pays $120 of coaches' wages

    Example: A block with fewer coaches than the program's settings call for costs only what it has
      Given Guppies have a coach for every 5 sailors
      And a Guppies offering of 10 sailors, with a practice from 9am to noon, in a block with 1 coach paid $20 an hour
      When a planner calculates the P&L
      Then the offering pays $60 of coaches' wages

  Rule: The offerings in a block share its costs by their number of sailors

    Example: Two offerings share a coach
      Given two offerings, of 6 sailors and 4 sailors, in one block from 9am to noon with 1 coach paid $20 an hour
      When a planner calculates the P&L
      Then the first offering pays $36 of coaches' wages
      And the second offering pays $24 of coaches' wages

  Rule: A block runs from its first activity's start to its last activity's end

    Example: Two practices that overlap in one block
      Given two offerings in one block with 1 coach paid $20 an hour
      And one practices from 9am to 11am and the other from 10am to noon
      When a planner calculates the P&L
      Then the two offerings pay $60 of coaches' wages between them

  Rule: A block's RIBs cost their rate for its time on the water

    Example: Two RIBs for a morning practice
      Given RIBs that cost $10 an hour on the water
      And an offering with a practice from 9am to noon, in a block with 2 RIBs
      When a planner calculates the P&L
      Then the offering pays $60 for RIBs

  Rule: The organization's boats cost upkeep for their time on the water, and boats that sailors bring cost nothing

    Example: Four of the organization's Optis and three that sailors bring
      Given Optis that cost $1 an hour on the water in upkeep
      And an offering with a practice from 9am to noon, in a block with 4 of the organization's Optis and 3 Optis that sailors bring
      When a planner calculates the P&L
      Then the offering pays $12 of boat upkeep

  Rule: A salaried coach on a block is paid out of their salary for its hours

    Example: An offering pays for its salaried coach's hours
      Given a salaried director paid $40 an hour
      And an offering with 10 practices of 3 hours, each in a block the director coaches
      When a planner calculates the P&L
      Then the offering pays $1,200 of the director's salary

  Rule: A salaried coach can be paid by the hour for coaching, at their own hourly rate, on top of their salary

    Example: A director is paid by the hour for the blocks they coach
      Given a director on a $20,000 salary, who's paid $30 an hour to coach
      And an offering with 10 practices of 3 hours, each in a block the director coaches by the hour
      When a planner calculates the P&L
      Then the offering pays $900 of coaches' wages
      And the offering pays none of the director's salary

    Example: The block's other coaches are paid their staff level's rate
      Given a director on a $20,000 salary, who's paid $40 an hour to coach
      And an offering with 10 practices of 3 hours, each in a block the director coaches by the hour with a coach paid $30 an hour
      When a planner calculates the P&L
      Then the offering pays $2,100 of coaches' wages

    Example: A director with no hourly rate of their own is paid nothing for those hours
      Given a director on a $20,000 salary, with no hourly rate to coach
      And an offering with 10 practices of 3 hours, each in a block the director coaches by the hour
      When a planner calculates the P&L
      Then the offering pays no coaches' wages
      And the planner is warned that the director has no hourly rate to coach

  Rule: A salaried person's pay for the year adds up their salary, their hourly coaching, and their bonus

    Example: A director's pay for the year
      Given a director on a $20,000 salary, who's paid $30 an hour to coach
      And an offering with 10 practices of 3 hours, each in a block the director coaches by the hour
      And a bonus for the director that comes to $5,000
      When a planner calculates the P&L
      Then the director's pay for the year is:
        | pay             | amount  |
        | salary          | $20,000 |
        | hourly coaching | $900    |
        | bonus           | $5,000  |
        | total           | $25,900 |

  Rule: A salaried coach can't coach two blocks at the same time

    Example: Two blocks at the same time get a warning
      Given a salaried director who coaches two blocks
      And both blocks run from 4pm to 7pm on the same day
      When a planner calculates the P&L
      Then the planner is warned that the director is coaching two blocks at once

    Example: A morning block and an afternoon block don't get a warning
      Given a salaried director who coaches two blocks
      And one block runs from 9am to noon and the other from 1pm to 4pm on the same day
      When a planner calculates the P&L
      Then the planner isn't warned about the director

  Rule: A planner sees how many hours of another coach a double-booked salaried coach needs

    Example: Two blocks overlap for two hours
      Given a salaried director who coaches two blocks
      And one block runs from 9am to noon and the other from 10am to 2pm on the same day
      When a planner calculates the P&L
      Then the director's blocks need 2 hours of another coach

    Example: Three blocks at once need two more coaches
      Given a salaried director who coaches three blocks
      And all three blocks run from 4pm to 7pm on the same day
      When a planner calculates the P&L
      Then the director's blocks need 6 hours of another coach

  Rule: A planner is warned when more of the organization's boats are out at once than it has

    Example: 14 Sailqubes out on a morning when the organization has 12
      Given the Operations Plan says the organization has 12 Sailqubes
      And a Guppies block with 9 Sailqubes and a Minnows block with 5, both on the morning of July 13
      When a planner calculates the P&L
      Then the planner is warned that July 13 has 14 Sailqubes out, but the organization has 12

    Example: A morning block and an afternoon block can use the same boats
      Given the Operations Plan says the organization has 12 Sailqubes
      And a Guppies block with 9 Sailqubes on the morning of July 13, and a Minnows block with 5 that afternoon
      When a planner calculates the P&L
      Then the planner isn't warned about Sailqubes

    Example: Boats that sailors bring don't count against the organization's
      Given the Operations Plan says the organization has 12 Optis
      And a block with 10 of the organization's Optis and 4 Optis that sailors bring
      When a planner calculates the P&L
      Then the planner isn't warned about Optis

  Rule: A planner is warned when more RIBs or other equipment are out at once than the organization has

    Example: 7 RIBs out on a morning when the organization has 6
      Given the Operations Plan says the organization has 6 RIBs
      And two blocks on the morning of July 13, with 4 RIBs and 3 RIBs
      When a planner calculates the P&L
      Then the planner is warned that July 13 has 7 RIBs out, but the organization has 6

  Rule: A planner is warned when a block has too few coaches for its sailors

    Example: One Level 1 Instructor for 14 Guppies
      Given Guppies have a Level 1 Instructor for every 10 sailors
      And a Guppies block of 14 sailors with one Level 1 Instructor and enough boats
      When a planner calculates the P&L
      Then the planner is warned that the block has 14 sailors, but enough coaches for only 10

    Example: A coach at another staff level doesn't count
      Given Guppies have a Level 1 Instructor for every 10 sailors
      And a Guppies block of 10 sailors with one Level 2 Instructor and enough boats
      When a planner calculates the P&L
      Then the planner is warned that the block has 10 sailors and no coach

    Example: A salaried director on a block counts as one coach
      Given Guppies have a Level 1 Instructor for every 10 sailors
      And a salaried director paid $30 an hour
      And a Guppies block of 10 sailors that the director coaches, with enough boats
      When a planner calculates the P&L
      Then the planner isn't warned about the block

    Example: One coach for 5 Guppies and 5 Minnows is too few
      Given Guppies have a coach for every 10 sailors, and Minnows a coach for every 5
      And a block of 5 Guppies and 5 Minnows, with one coach and enough boats
      When a planner calculates the P&L
      Then the planner is warned that the block has too few coaches

    Example: Two coaches for 5 Guppies and 5 Minnows are enough
      Given Guppies have a coach for every 10 sailors, and Minnows a coach for every 5
      And a block of 5 Guppies and 5 Minnows, with two coaches and enough boats
      When a planner calculates the P&L
      Then the planner isn't warned about the block

  Rule: A planner is warned when a block's boats can't hold its sailors

    Example: Five Sailqubes for 14 Guppies
      Given Sailqubes take 2 sailors each
      And a Guppies block of 14 sailors with enough staff and 5 Sailqubes
      When a planner calculates the P&L
      Then the planner is warned that the block has 14 sailors, but the boats hold only 10

    Example: Boats that sailors bring count
      Given Optis take 1 sailor each
      And a block of 12 sailors with enough staff, 8 of the organization's Optis, and 4 Optis that sailors bring
      When a planner calculates the P&L
      Then the planner isn't warned about the block

  Rule: A planner is warned about an activity with no staff

    Example: A practice in no block
      Given an offering with a practice on August 2 that's in no block
      When a planner calculates the P&L
      Then the planner is warned that the practice on August 2 has no staff

    Example: A practice in a block with boats but no staff
      Given an offering with a practice on August 2, in a block with boats but no staff
      When a planner calculates the P&L
      Then the planner is warned that the practice on August 2 has no staff

  Rule: A saved Financial Plan keeps its warnings, each with the plan and date it's about

    Example: A practice with no staff in a saved Financial Plan
      Given a user with the Plan Writer policy
      And a draft Financial Plan whose Program Plan has a practice on August 2 with no staff
      When they save the Financial Plan
      Then the Financial Plan's warnings say that the practice on August 2, in its Program Plan, has no staff

  Rule: A planner is warned about an activity on a closed day

    Example: A practice on Labor Day gets a warning
      Given the Operations Plan lists Labor Day as a closed day
      And an offering with a practice on Labor Day
      When a planner calculates the P&L
      Then the planner is warned that the practice is on a closed day

  Rule: A Program Plan's P&L counts the other Program Plans in its Financial Plan

    Example: The office is split between two Program Plans
      Given $1,000 of office costs shared by every offering
      And a draft Financial Plan with two Program Plans whose offerings have the same direct costs
      When a planner calculates the P&L
      Then each Program Plan's offering pays $500 of the office costs

  Rule: A draft's P&L is up to date after every change to it

    Example: A planner's AI changes a price, then sees the new P&L
      Given a user with the Plan Writer policy
      And a draft Financial Plan whose offering takes in $10,000
      When they change the offering to take in $12,000
      Then they see that the Financial Plan's P&L shows the offering takes in $12,000

  Rule: A saved Financial Plan keeps the P&L it had when it was saved

    Example: A saved Financial Plan shows the P&L it was saved with
      Given a user with the Plan Writer policy
      And a draft Financial Plan whose offering takes in $10,000
      When they save the Financial Plan
      Then the Financial Plan's P&L shows that the offering takes in $10,000

    Example: A Financial Plan started from it doesn't change its P&L
      Given a saved Financial Plan named "Budget" whose offering pays $1,000 of office costs
      When a planner saves a Financial Plan started from "Budget" with $2,000 of office costs
      Then the P&L of "Budget" still shows that the offering pays $1,000 of office costs

  Rule: Each line of a saved P&L says in plain words what it is

    Example: An offering's share of the office is named for its pool and its line
      Given a user with the Plan Writer policy
      And $1,000 of office costs in a pool named "G&A"
      And a draft Financial Plan with one offering that has direct costs
      When they save the Financial Plan
      Then the Financial Plan's P&L names the offering's share of the office "G&A share: Office"

  Rule: No one can write a Financial Plan's P&L by hand, even an admin

    Example: A Plan Writer can't write a Financial Plan's P&L
      Given a user with the Plan Writer policy
      Then they can't change a saved Financial Plan's P&L
      And they can't add a P&L to a draft Financial Plan

    Example: An admin can't write a Financial Plan's P&L either
      Given a user with the Admin role
      Then they can't change a saved Financial Plan's P&L
      And they can't add a P&L to a draft Financial Plan

  Rule: A Plan Writer can write a plan's rules in a draft Financial Plan, and they never change once it's saved

    Example: A Plan Writer writes a Program Plan's rules
      Given a user with the Plan Writer policy
      And a draft Financial Plan
      Then they can write a Program Plan's rules

    Example: A Plan Writer writes a program's rules
      Given a user with the Plan Writer policy
      And a draft Financial Plan
      Then they can write the rules for one of a Program Plan's programs

    Example: A Plan Writer can't change the rules in a saved Financial Plan
      Given a user with the Plan Writer policy
      And a saved Financial Plan whose Program Plan has rules
      Then they can't change the Program Plan's rules

  Rule: A planner keeps the draft their AI filled in by saving it, or rejects it by deleting it

    Example: A planner saves the draft their AI filled in
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget"
      And a draft their AI started from "Budget", with its blocks filled in and a note of what it changed
      When they save the draft
      Then the draft is saved with its blocks, its note, and its P&L
      And its parent is "Budget"

    Example: Deleting the draft leaves the plan it was started from as it was
      Given a user with the Plan Writer policy
      And a saved Financial Plan named "Budget" with an offering at $1,000 a sailor
      And a draft their AI started from "Budget", with its blocks filled in and a note of what it changed
      When they delete the draft
      Then the draft is gone
      And "Budget" still has the offering at $1,000 a sailor

  Rule: Planners can see every plan, including wages and bonus rates

    Scenario Outline: Each planning policy can see a plan's wages and bonus rates
      Given a user with the <policy> policy
      And a plan with wages and bonus rates
      Then they can see every part of the plan, wages and bonus rates included

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  Rule: A Plan Reader can't change plans

    Example: A Plan Reader can't change a plan
      Given a user with the Plan Reader policy
      Then they can't change plans

  Rule: A Plan Writer can change any plan in a draft Financial Plan, even one someone else started

    Example: A Plan Writer changes another planner's Program Plan
      Given a user with the Plan Writer policy
      And a draft Financial Plan someone else started
      Then they can change any of its plans

  Rule: A Plan Writer can start, save, and mark a Financial Plan active, and a Plan Reader can only look at one

    Example: A Plan Writer starts, saves, and marks a Financial Plan active
      Given a user with the Plan Writer policy
      Then they can start a Financial Plan
      And they can save a draft Financial Plan
      And they can mark a saved Financial Plan active

    Example: A Plan Reader looks at a Financial Plan
      Given a user with the Plan Reader policy
      And a saved Financial Plan
      Then they can see the Financial Plan and its P&L
      But they can't start, save, or mark a Financial Plan active

  Rule: Only admins and planners can see plans

    Scenario Outline: A role on its own doesn't let someone see plans
      Given a user with the <role> role
      Then they can't see plans

      Examples:
        | role      |
        | Community |
        | Crew      |

    Scenario Outline: Other policies don't let someone see plans
      Given a user with the <policy> policy
      Then they can't see plans

      Examples:
        | policy         |
        | CRM Writer     |
        | Catalog Reader |
        | Catalog Writer |
