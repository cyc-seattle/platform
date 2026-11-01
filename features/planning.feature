Feature: Plans
  Each plan covers one program area for one year: what the club offers and when, the prices, the
  schedule, who works it, and the budget. The area's directors plan it, and can draw up more than
  one plan for a year to weigh the choices. The Operations Plan is the
  one plan for the whole club. It covers what the program areas share, such as the office, the
  boats, and the year's rates. It also plans the products that belong to no program area:
  merchandise, storage, and charters. Planners are the people with the Plan Reader or Plan Writer
  policy, which they get from their groups. They work on a plan's draft, and save it as a version
  when it's ready. A saved version never changes, so the club can always look back at what it
  agreed to. When a program opens for sign-ups, a planner makes one saved version active. For each
  program area and year, and for the Operations Plan, only one version is active, and the active
  versions together are the club's plan for the year.

  The club's P&L, its profit and loss for the year, is worked out from the plans. It shows each
  offering, each program area, and the whole club. A draft's P&L is worked out whenever someone
  asks for it. A saved version keeps the P&L it had when it was saved, and that never changes
  either. Shared costs are the costs that several offerings share, such as the office. They're
  divided among the offerings by their direct costs, counted the way federal grant rules count
  them. Some charges are set as a
  share of revenue, such as scholarships or card fees. The Operations Plan lists each one, with its
  rate and the kinds of product it applies to. Revenue from programs and other sales pays for the
  club's running costs. Fundraising pays for capital, such as a new coach boat, so capital is never
  charged to a program area.

  Each version of a plan can also hold the planner's rules: what they want that the plan's numbers
  don't capture, in their own words, for their AI to follow when it fills in the plan. For example:
  every Monday, Wednesday, and Friday, except on school holidays, from 4pm until dusk.

  The Operations Plan also lists the days the club is closed, such as Labor Day, so that no one
  plans a practice on one by mistake.

  Plans include wages and bonus rates. Wages are what each staff level is paid per hour, and what
  each salaried position is paid per year. A salaried coach can also be paid by the hour for
  coaching, on top of their salary. Bonus rates set the bonus a director earns on the products
  they run: a share of those products' net, the money they make after their costs. A bonus for one
  program area's products is in that area's plan. A bonus on products from more than one area is in
  the Operations Plan. Anyone who can see plans sees all of these. To change something means to
  add, edit, or delete it.

  Rule: A new plan starts with a draft

    Example: A Plan Writer starts a plan for a program area
      Given a user with the Plan Writer policy
      When they start a plan for a program area
      Then the plan has a draft they can change
      And the plan has no saved versions yet

  Rule: For each program area and year, only one saved version is active at a time

    Example: Making a version active replaces the one that was active
      Given a user with the Plan Writer policy
      And a plan with two saved versions, the first of them active
      When they make the second version active
      Then only the second version is active

    Example: Making another plan active replaces the program area's plan for the year
      Given a user with the Plan Writer policy
      And two plans for a program area this year, the first of them active
      When they make a saved version of the second plan active
      Then the second plan is the program area's plan for the year
      And the first plan has no active version

  Rule: A saved version never changes, even for an admin

    Example: A Plan Writer can't change a saved version
      Given a user with the Plan Writer policy
      Then they can see a saved version
      But they can't change a saved version
      And they can't copy a draft's changes into a saved version
      And they can't turn a saved version back into a draft

    Example: An admin can't change a saved version either
      Given a user with the Admin role
      Then they can't change a saved version
      And they can't turn a saved version back into a draft

  Rule: A program area's plan holds only that area's programs

    Example: A plan with another program area's program gets a warning
      Given a plan for a program area
      And an offering in it of a program from another program area
      When a planner calculates the P&L
      Then the planner is warned that the offering is in the wrong plan

  Rule: Merchandise, storage, and charters are planned in the Operations Plan

    Example: The Operations Plan sells merchandise
      Given the Operations Plan sells $1,000 of merchandise
      When a planner calculates the P&L
      Then the club-wide totals include $1,000 of merchandise sales

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

    Example: Buying a coach boat shows only in the club-wide totals
      Given the Operations Plan buys a $20,000 coach boat
      When a planner calculates the P&L
      Then no offering or program area pays for the coach boat
      And the club-wide totals show $20,000 of capital

    Example: A coach boat charged to a program area goes to the club-wide totals instead
      Given a $20,000 coach boat charged to a program area
      When a planner calculates the P&L
      Then the program area doesn't pay for the coach boat
      And the club-wide totals show $20,000 of capital
      And the planner is warned that capital can't be charged to a program area

  Rule: The club-wide totals show the operating net, then fundraising and capital, then the total

    Example: Fundraising pays for capital below the operating net
      Given programs that take in $100,000 and cost $90,000
      And donations of $30,000, which cost $5,000 to raise
      And the Operations Plan buys a $20,000 coach boat
      When a planner calculates the P&L
      Then the club-wide totals are:
        | line            | amount   |
        | operating net   | $10,000  |
        | fundraising net | $25,000  |
        | capital         | -$20,000 |
        | total           | $15,000  |

  Rule: A program area's plan can pay a director a bonus on that area's programs

    Example: A director's bonus in a program area's plan
      Given a program area's plan that pays its director 50% of its programs' net
      And its programs make $10,000 after their costs and shared costs
      When a planner calculates the P&L
      Then the director's bonus is $5,000

    Example: A program area's plan can't pay a bonus on another area's program
      Given a program area's plan that pays its director a bonus on a program from another program area
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

  Rule: The club pays payroll tax on a bonus, as on any wage

    Example: A bonus costs payroll tax
      Given payroll tax at 10% of wages
      And a director whose bonus is $5,000
      When a planner calculates the P&L
      Then the club pays $500 of payroll tax on the bonus

  Rule: A bonus and its payroll tax don't count toward the split of shared costs

    Example: A director's bonus doesn't change an offering's share of the office
      Given two offerings with the same direct costs
      And a director's bonus, with its payroll tax, on the first offering only
      And $1,000 of office costs shared by every offering
      When a planner calculates the P&L
      Then each offering pays $500 of the office costs

  Rule: A salaried coach named on an offering coaches all its practices, paid out of their salary

    Example: An offering pays for its salaried coach's hours
      Given a salaried director paid $40 an hour
      And an offering they coach, with 10 practices of 3 hours
      When a planner calculates the P&L
      Then the offering pays $1,200 of the director's salary

  Rule: A salaried coach can be paid by the hour for coaching, on top of their salary

    Example: A director is paid by the hour for an offering they coach
      Given a director on a $20,000 salary
      And an offering they coach for $30 an hour, with 10 practices of 3 hours
      When a planner calculates the P&L
      Then the offering pays $900 of coaches' wages
      And the offering pays none of the director's salary

  Rule: A salaried person's pay for the year adds up their salary, their hourly coaching, and their bonus

    Example: A director's pay for the year
      Given a director on a $20,000 salary
      And an offering they coach for $30 an hour, with 10 practices of 3 hours
      And a bonus for the director that comes to $5,000
      When a planner calculates the P&L
      Then the director's pay for the year is:
        | pay             | amount  |
        | salary          | $20,000 |
        | hourly coaching | $900    |
        | bonus           | $5,000  |
        | total           | $25,900 |

  Rule: A salaried coach can't coach two groups at the same time

    Example: Two groups at the same time get a warning
      Given a salaried director who coaches two groups that don't share coaches
      And both groups practice from 4pm to 7pm on the same day
      When a planner calculates the P&L
      Then the planner is warned that the director is coaching two groups at once

    Example: A morning group and an afternoon group don't get a warning
      Given a salaried director who coaches two groups that don't share coaches
      And one group practices from 9am to noon and the other from 1pm to 4pm on the same day
      When a planner calculates the P&L
      Then the planner isn't warned about the director

  Rule: Offerings that share coaches on a day share them only when their practices overlap

    Scenario Outline: Two groups share a coach only when they're on the water together
      Given two offerings of 4 sailors each, with a coach for every 8 sailors, that share coaches on Wednesdays
      And one practices from <first> and the other from <second> on the same Wednesday
      When a planner calculates the P&L
      Then each offering pays for <coach>

      Examples:
        | first       | second      | coach         |
        | 9am to noon | 9am to noon | half a coach  |
        | 9am to noon | 1pm to 4pm  | a whole coach |

  Rule: A planner is warned about an activity on a day the club is closed

    Example: A practice on Labor Day gets a warning
      Given the Operations Plan closes the club on Labor Day
      And an offering with a practice on Labor Day
      When a planner calculates the P&L
      Then the planner is warned that the practice is on a day the club is closed

  Rule: A saved version keeps the P&L it had when it was saved

    Example: A saved version shows the P&L it was saved with
      Given a user with the Plan Writer policy
      And a draft of a program area's plan whose offering takes in $10,000
      When they save the draft as a version
      Then the saved version's P&L shows that the offering takes in $10,000

    Example: A later Operations Plan doesn't change a saved version's P&L
      Given a saved version of a program area's plan whose offering pays $1,000 of office costs
      When a planner saves an Operations Plan with $2,000 of office costs, and makes it active
      Then the saved version's P&L still shows that the offering pays $1,000 of office costs

  Rule: A saved version's P&L counts the other program areas' active plans

    Example: The office is split with another program area's active plan
      Given a user with the Plan Writer policy
      And $1,000 of office costs shared by every offering
      And another program area's active plan, with the same direct costs as this area's draft
      When they save the draft as a version
      Then the saved version's P&L shows that the offering pays $500 of the office costs

  Rule: No one can write a version's P&L by hand, even an admin

    Example: A Plan Writer can't write a version's P&L
      Given a user with the Plan Writer policy
      Then they can't change a saved version's P&L
      And they can't add a P&L to a draft

    Example: An admin can't write a version's P&L either
      Given a user with the Admin role
      Then they can't change a saved version's P&L
      And they can't add a P&L to a draft

  Rule: A Plan Writer can write the rules on a draft, and a saved version's rules never change

    Example: A Plan Writer writes a draft's rules
      Given a user with the Plan Writer policy
      And a plan with a draft
      Then they can write the draft's rules

    Example: A Plan Writer can't change a saved version's rules
      Given a user with the Plan Writer policy
      And a plan with a saved version that has rules
      Then they can't change the saved version's rules

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

  Rule: A Plan Writer can change any plan's draft, even one someone else started

    Example: A Plan Writer changes another planner's draft
      Given a user with the Plan Writer policy
      And a plan someone else started
      Then they can change a draft

  Rule: A Plan Writer can save a draft as a version, and make a saved version active

    Example: A Plan Writer saves a version and makes it active
      Given a user with the Plan Writer policy
      And a plan with a draft
      Then they can save the draft as a version
      And they can make a saved version active

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
