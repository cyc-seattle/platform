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

  The club's P&L, its profit and loss for the year, is worked out from the plans whenever someone
  asks for it. Nothing worked out is stored. It shows each offering, each program area, and the
  whole club. A cost that several offerings share, such as the office, is divided among them by
  their direct costs, counted the way federal grant rules count them. Some charges are set as a
  share of revenue, such as scholarships or card fees. The Operations Plan lists each one, with its
  rate and the kinds of product it applies to. Revenue from programs and other sales pays for the
  club's running costs. Fundraising pays for capital, such as a new coach boat, so capital is never
  charged to a program area.

  Each version of a plan can also hold the planner's rules: what they want that the plan's numbers
  don't capture, in their own words, for their AI to follow when it fills in the plan. For example:
  every Monday, Wednesday, and Friday, except on school holidays, from 4pm until dusk.

  Plans include wages and bonus rates. Wages are what each staff level is paid per hour, and what
  each salaried position is paid per year. Bonus rates set the bonus a head coach earns on the
  products they run. Anyone who can see plans sees all of these. To change something means to add,
  edit, or delete it.

  @pending
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

    @pending
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

  @pending
  Rule: A program area's plan holds only that area's programs

    Example: A plan with another program area's program gets a warning
      Given a plan for a program area
      And an offering in it of a program from another program area
      When a planner calculates the P&L
      Then the planner is warned that the offering is in the wrong plan

  @pending
  Rule: Merchandise, storage, and charters are planned in the Operations Plan

    Example: The Operations Plan sells merchandise
      Given the Operations Plan sells $1,000 of merchandise
      When a planner calculates the P&L
      Then the club-wide totals include $1,000 of merchandise sales

  @pending
  Rule: Every program belongs to a program area

    Example: A program with no program area gets a warning
      Given a program with no program area
      And a plan with an offering of that program
      When a planner calculates the P&L
      Then the planner is warned that the program has no program area

  @pending
  Rule: A program area's P&L adds up its offerings and the costs charged to the area

    Example: A program area's P&L includes its storage
      Given a program area with two offerings that each take in $10,000
      And $3,000 of storage charged to the program area
      When a planner calculates the P&L
      Then the program area takes in $20,000
      And its costs include the $3,000 of storage

  @pending
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

  @pending
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

  @pending
  Rule: Card fees that families pay are revenue, and the card company's fees are a cost

    Example: An offering collects card fees from families and pays them to the card company
      Given the Operations Plan collects card fees from families at 3% of revenue
      And the Operations Plan pays card fees at 3% of revenue
      And an offering of a program that takes in $10,000
      When a planner calculates the P&L
      Then the offering takes in $300 of card fees from families
      And the offering pays $300 of card fees

  @pending
  Rule: A charge set as a share of revenue counts toward the split of shared costs only if the Operations Plan says so

    Example: Scholarships don't change an offering's share of the office
      Given two offerings with the same direct costs
      And scholarships on the first offering only, which don't count toward the split
      And $1,000 of office costs shared by every offering
      When a planner calculates the P&L
      Then each offering pays $500 of the office costs

  @pending
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

  @pending
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

  @pending
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
