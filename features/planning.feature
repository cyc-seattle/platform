Feature: Plans
  A plan sets out how one product will run in a season: what the club offers and when, the prices,
  the schedule, who works it, and the budget. The Operations Plan covers what the products share,
  such as the office and the boats. Planners work on a plan's draft, and save it as a version when
  it's ready. A saved version never changes, so the club can always look back at what it agreed to.
  One saved version of each plan is the active one, and the active versions together are the
  club's plan for the season.

  Plans include wages, which are what each staff level is paid per hour and what each salaried
  position is paid per year, and bonus rates, which set the bonus a head coach earns on the products
  they run. Anyone who can see plans sees all of these. Planners have the Plan Reader or Plan Writer
  policy, which they get from their groups. To change something means to add, edit, or delete it.

  @pending
  Rule: Each plan is for one product, and starts with a draft

    Example: A Plan Writer starts a plan for a product
      Given a user with the Plan Writer policy
      When they start a plan for a product
      Then the plan has a draft they can change
      And the plan has no saved versions yet

  @pending
  Rule: Only one saved version of each plan is active at a time

    Example: Making a version active replaces the one that was active
      Given a user with the Plan Writer policy
      And a plan with two saved versions, the first of them active
      When they make the second version active
      Then only the second version is active

  @pending
  Rule: A saved version never changes, even for an admin

    Example: A Plan Writer can't change a saved version
      Given a user with the Plan Writer policy
      Then they can see a saved version
      But they can't change a saved version
      And they can't move anything from the draft into a saved version
      And they can't turn a saved version back into a draft

    Example: An admin can't change a saved version either
      Given a user with the Admin role
      Then they can't change a saved version
      And they can't turn a saved version back into a draft

  @pending
  Rule: Planners can see every plan, including wages and bonus rates

    Scenario Outline: Each planning policy can see a plan's wages and bonus rates
      Given a user with the <policy> policy
      And a plan with wages and bonus rates
      Then they can see every part of the plan, wages and bonus rates included

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  @pending
  Rule: A Plan Reader can't change plans

    Example: A Plan Reader can't change a plan
      Given a user with the Plan Reader policy
      Then they can't change plans

  @pending
  Rule: A Plan Writer can change any plan's draft, even one someone else started

    Example: A Plan Writer changes another planner's draft
      Given a user with the Plan Writer policy
      And a plan someone else started
      Then they can change a draft

  @pending
  Rule: A Plan Writer can save a draft as a version, and make a saved version active

    Example: A Plan Writer saves a version and makes it active
      Given a user with the Plan Writer policy
      Then they can save the draft as a version
      And they can make a saved version active

  @pending
  Rule: No one else can see plans

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
