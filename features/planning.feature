Feature: Who can see and change plans and their results
  A plan sets out how one product will run in a season: its offerings, prices, schedule, staffing,
  and budget. The Operations Plan holds what the products share. Each plan has one draft, which
  planners edit, and saved versions, which never change once saved. One saved version of each plan
  is active at a time. A plan's results are the P&L lines and metrics the planning engine computes
  from it. Plans hold wages, which are the hourly rates of staff levels and the salaries of salaried
  positions, and bonus rates, which are what each bonus owner earns. Anyone who reads plans sees all
  of these. Plan Reader and Plan Writer are policies a group grants.

  @pending
  Rule: Planners read every plan and its results, wages and bonus rates included

    Scenario Outline: Each plan policy reads every plan in full
      Given a user with the <policy> policy
      Then they can read every detail of plans
      And they can read results

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |

  @pending
  Rule: A Plan Reader changes nothing

    Example: A Plan Reader can't edit a plan or its results
      Given a user with the Plan Reader policy
      Then they can't change plans
      And they can't change results

  @pending
  Rule: A Plan Writer starts a plan for a product, with a draft

    Example: A Plan Writer starts a plan
      Given a user with the Plan Writer policy
      When they start a plan for a product
      Then the plan has a draft they can edit

  @pending
  Rule: A Plan Writer edits any plan's draft, including one someone else started

    Example: A Plan Writer edits another planner's draft
      Given a user with the Plan Writer policy
      And a plan someone else started
      Then they can change a draft

  @pending
  Rule: A Plan Writer saves a draft as a version, and makes a saved version active

    Example: A Plan Writer saves and activates a version
      Given a user with the Plan Writer policy
      Then they can save the draft as a version
      And they can make a saved version active

  @pending
  Rule: A saved version never changes, even for an admin

    Example: A Plan Writer can't change a saved version
      Given a user with the Plan Writer policy
      Then they can read a saved version
      But they can't change a saved version
      And they can't move a row from the draft into a saved version
      And they can't make a saved version a draft again

    Example: An admin can't change a saved version either
      Given a user with the Admin role
      Then they can't change a saved version
      And they can't make a saved version a draft again

  @pending
  Rule: Only the planning engine writes results

    Example: A Plan Writer can't change results
      Given a user with the Plan Writer policy
      Then they can't change results

  @pending
  Rule: No one else reads plans or results

    Scenario Outline: A role alone doesn't show plans
      Given a user with the <role> role
      Then they can't read plans
      And they can't read results

      Examples:
        | role      |
        | Community |
        | Crew      |

    Scenario Outline: The other policies don't show plans
      Given a user with the <policy> policy
      Then they can't read plans
      And they can't read results

      Examples:
        | policy         |
        | CRM Writer     |
        | Catalog Reader |
        | Catalog Writer |
