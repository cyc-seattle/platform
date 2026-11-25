# The sample data `mise run ci-seed` leaves in the CI stack, for screenshots and demos (docs/testing.md).
# Each scenario is only Givens, from the features' own steps, and nothing is deleted after.
Feature: Sample data

  Scenario: A team and its families
    Given a parent whose child is on a team
    And a teammate who is a child, and their parent, who chose to share
    And a teammate who is a child, with an email and phone of their own, and their parent, who chose to share
    And a teammate with a school on file, and their parent, who has one on file too
    And a teammate who hasn't answered the sharing question, and their parent
    And an adult teammate who chose to share
    And an adult teammate who chose not to share

  Scenario: A family in a program that isn't a team
    Given a parent whose child is signed up for a program, and the child's other parent

  Scenario: A sailor's parents and emergency contacts
    Given a sailor with two parents and two emergency contacts

  Scenario: A crew member, with the catalog, an announcement and a link
    Given a crew member

  Scenario: A Financial Plan
    Given a user with the Plan Writer and Plan Admin policies
    And a program area with an offering in "Summer 2027" that takes in $10,000
    And an offering in "Fall 2027" that takes in $4,000
    And a salaried director paid $50 an hour, with 100 hours charged to the program area
    And $1,000 of office costs shared by every offering
    And the Operations Plan sets scholarships at 2% of programs' revenue
    And the Operations Plan sells $1,000 of merchandise
    And Sailqubes take 2 sailors each
    And the organization has 12 Sailqubes
    And RIBs that cost $6 an hour in fuel and $4 an hour in upkeep
    And the organization has 6 RIBs
    And Guppies have a coach for every 5 sailors
    And a Guppies offering of 8 sailors, with a practice from 9am to noon, in a block with 1 coach paid $20 an hour
