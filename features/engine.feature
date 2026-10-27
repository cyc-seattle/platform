Feature: What the engine's machine user can do
  The engine reads plans and writes their results: P&L lines and metrics. It signs in as a machine
  user, whose policies the backend stack defines in code. Step 11 of
  https://github.com/cyc-seattle/workplace/issues/6 builds the user and turns its reads green, and
  step 12 deploys the engine and turns its writes green.

  The run's rows include a plan for the run's product, with a draft and a saved version, and results
  for the saved version.

  Background:
    Given this run's users and rows on dev's Directus

  @pending
  Scenario: The engine writes results and metrics
    Then "Engine" can create, read, update, and delete "results"

  @pending
  Scenario: The engine reads every plan, wages included, and changes none of it
    Then "Engine" can read every field of "plans"
    And "Engine" can't change "plans"

  @pending
  Scenario: The engine reads nothing about people
    Then "Engine" can't read "the CRM"
    And "Engine" can't read "Clubspot's records"
    And "Engine" can't read "groups"

  @pending
  Scenario: Plan Writer doesn't write results
    Then "Plan Writer" can't change "results"
