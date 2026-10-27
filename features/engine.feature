Feature: What the planning engine can do
  The planning engine computes a plan's results: the P&L lines and metrics that show what a plan
  will earn and cost. It works from the plan and from the catalog's prices and accounts. It runs on
  its own, signed in with a service account, and needs nothing about the club's people.

  @pending
  Rule: The planning engine writes a plan's results

    Example: The planning engine records results
      Given the planning engine's service account
      Then it can change results

  @pending
  Rule: The planning engine reads every plan and the catalog, and changes neither

    Example: The planning engine reads a plan in full, wages included
      Given the planning engine's service account
      Then it can read every detail of plans
      And it can read the catalog
      But it can't change plans
      And it can't change the catalog

  @pending
  Rule: The planning engine reads nothing about people

    Example: The planning engine can't read the CRM or Clubspot's records
      Given the planning engine's service account
      Then it can't read the CRM
      And it can't read medical profiles
      And it can't read Clubspot's records
