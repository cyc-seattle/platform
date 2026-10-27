Feature: clubspot-sync brings Clubspot's registrations into the CRM
  Families register for camps in Clubspot. clubspot-sync copies each camp's sessions, classes, and
  registrations into the CRM, and makes a person in the CRM of each sailor and guardian they name, so
  staff work from one list of people. When it finds the same person twice, it merges them. It signs
  in with a service account of its own, which reaches only what it syncs. The promoted fields are
  staff's list of which sign-up answers fill in a person's details.

  Rule: The sailors and guardians on a registration become people in the CRM

    Example: A participant's registration becomes a person with a guardian
      Given a camp running today in the Clubspot fake
      And a participant registered in it, with a guardian
      When clubspot-sync runs
      Then the CRM has the participant as a person
      And the person's guardian is a person, linked as their guardian

  Rule: clubspot-sync keeps Clubspot's camps and registrations, the people they name, and its own records

    Example: clubspot-sync adds and updates what it syncs
      Given clubspot-sync's service account
      Then it can create, read, and update Clubspot's camps and registrations
      And it can create, read, and update people, their family links, address books, and medical profiles
      And it can create, read, and update the syncs' queue, runs, and findings

  Rule: clubspot-sync deletes only what a merge or a resync replaces

    Example: A merge deletes the duplicate person
      Given clubspot-sync's service account
      Then it can delete people, their family links, address books, and medical profiles

    Example: A resync replaces a session's classes and a registration's billing
      Given clubspot-sync's service account
      Then it can delete a session's classes
      And it can delete billing

    Example: clubspot-sync deletes nothing else it syncs
      Given clubspot-sync's service account
      Then it can't delete camps, sessions, classes, and registrations
      And it can't delete the syncs' runs and findings

  Rule: Programs are the catalog's, so clubspot-sync can't read or add them

    Example: clubspot-sync can't see programs
      Given clubspot-sync's service account
      Then it can't create or read programs

  Rule: A merge moves the duplicate's roles, event staffing, and group memberships to the person kept

    Example: clubspot-sync moves a merged person's records, and adds or removes none
      Given clubspot-sync's service account
      Then it can read role assignments, event staffing, and group memberships
      And it can move role assignments, event staffing, and group memberships to another person
      But it can't create or delete role assignments, event staffing, and group memberships

  Rule: clubspot-sync reads the promoted fields, which staff keep

    Example: clubspot-sync reads the promoted fields, and can't add one
      Given clubspot-sync's service account
      Then it can read the promoted fields
      But it can't create the promoted fields
