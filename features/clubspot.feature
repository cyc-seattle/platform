Feature: Camps and registrations from Clubspot
  Families sign up for camps in Clubspot. clubspot-sync copies each camp's sessions, classes, and
  registrations from Clubspot into the CRM, and adds each sailor and parent on a registration to the
  CRM as a person, so staff work from one list of people. When it finds the same person in the CRM
  twice, it merges the two into one.

  Staff fix a camp or a registration in Clubspot, not in the CRM, because the next copy would undo
  a change made in the CRM. In the CRM, staff only link what came from Clubspot to the rest of the
  club's data: which program a class belongs to, and which person in the CRM a sailor is.

  clubspot-sync signs in to the CRM with an account of its own, called a service account, which can
  only do the work the sync needs. Staff also choose which sign-up answers, such as a sailor's
  school, get copied onto a person's details. clubspot-sync follows that list, but can't change it.

  Rule: Each sailor and parent on a registration becomes a person in the CRM

    Example: A sailor's registration adds the sailor and their parent to the CRM
      Given a camp running today in Clubspot
      And a sailor registered for it, with a parent
      When clubspot-sync runs
      Then the CRM has the sailor as a person
      And the CRM has the sailor's parent as a person, listed as their parent

  Rule: Staff can see what came from Clubspot, but can only change it in Clubspot

    Example: A CRM Writer can see camps and registrations, but can't change them
      Given a user with the CRM Writer policy
      Then they can see camps, registrations, and event staffing from Clubspot
      But they can't change camps, registrations, and event staffing from Clubspot

    @pending
    Example: A CRM Reader can see camps and registrations, but can't change them
      Given a user with the CRM Reader policy
      Then they can see camps, registrations, and event staffing from Clubspot
      But they can't change camps, registrations, and event staffing from Clubspot

  Rule: A CRM Writer can link a class to its program, and a sailor to their person in the CRM

    Example: A CRM Writer sets a class's program, and matches a sailor to a person
      Given a user with the CRM Writer policy
      Then they can set which program a class belongs to
      And they can match a registration's sailor to a person in the CRM

  Rule: clubspot-sync can add, see, and edit what it copies from Clubspot

    Example: clubspot-sync adds and updates what it copies
      Given clubspot-sync's service account
      Then it can add, see, and edit Clubspot's camps and registrations
      And it can add, see, and edit people, their parents and emergency contacts, their other emails and phone numbers, and their medical information
      And it can add, see, and edit the syncs' task list, run logs, and problem reports

  Rule: clubspot-sync deletes only what a merge or a fresh copy replaces

    Example: Merging two people deletes the duplicate
      Given clubspot-sync's service account
      Then it can delete people, their parents and emergency contacts, their other emails and phone numbers, and their medical information

    Example: A fresh copy replaces a session's classes and a registration's billing
      Given clubspot-sync's service account
      Then it can delete which classes run in a session
      And it can delete billing

    Example: clubspot-sync can't delete anything else it copies
      Given clubspot-sync's service account
      Then it can't delete camps, sessions, classes, and registrations
      And it can't delete the syncs' run logs and problem reports

  Rule: Programs belong to the catalog, so clubspot-sync can't see or add them

    Example: clubspot-sync can't see programs
      Given clubspot-sync's service account
      Then it can't add or see programs

  Rule: A merge moves the duplicate's program roles, event staffing, and Google groups to the person kept

    Example: clubspot-sync can move a merged person's roles, but can't add or remove any
      Given clubspot-sync's service account
      Then it can see people's program roles, event staffing, and Google group memberships
      And it can move people's program roles, event staffing, and Google group memberships to another person
      But it can't add or delete people's program roles, event staffing, and Google group memberships

  Rule: clubspot-sync can see which sign-up answers to copy, but only staff can change that

    Example: clubspot-sync can't add a sign-up answer to copy
      Given clubspot-sync's service account
      Then it can see which sign-up answers to copy
      But it can't add sign-up answers to copy
