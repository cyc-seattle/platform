Feature: Registrations from Clubspot
  Families sign their sailors up for programs in Clubspot, the club's registration site. Clubspot's
  events and registrations are the sessions and classes Clubspot runs for each program, and each
  registration, with the sailor's answers to the sign-up questions and their payments. Staff change them in Clubspot, not in the CRM, because the next copy from Clubspot would
  undo a change made in the CRM. In the CRM, staff only link them to the rest of the club's data:
  which program a class belongs to, and which person in the CRM a sailor is.

  The Clubspot sync copies the sessions, classes, and registrations into the CRM. From each class that
  belongs to a program, it makes the program's offerings, one for each session the class runs in,
  and registers each sailor in theirs. It adds each
  sailor and parent on a registration to the CRM as a person, with their details and medical
  information, so staff work from one list of people. What it copies from Clubspot means those
  sessions, classes, registrations, people, details, and medical information. If it finds the same
  person in the CRM twice, it reports them for staff to check, and merges the two into one once
  staff approve.

  The Clubspot sync signs in to the CRM with an account of its own, called a service account, which
  can only do the work the sync needs. It writes notes in the CRM: a list of tasks, and reports of
  problems for staff to fix. It also logs each run. A CRM Writer chooses which sign-up answers, such
  as a sailor's school, get copied onto a person's details.

  A person's details are their name, email, and phone, any extra emails and phone numbers, and who
  their parents and emergency contacts are. A person's program roles are the roles they have in
  programs, such as coach or Parent Coordinator. To change something means to add, edit, or delete
  it.

  Rule: Each sailor and parent on a registration becomes a person in the CRM

    Example: A sailor's registration adds the sailor and their parent to the CRM
      Given a class running today in Clubspot
      And a sailor registered for it, with a parent
      When the Clubspot sync runs
      Then the CRM has the sailor as a person
      And the CRM has the sailor's parent as a person, listed as their parent

  Rule: Each sailor in a class that belongs to a program is registered in that program's offering

    Example: A sailor in a class that belongs to a program is registered in its offering
      Given a sailor registered for a class running today in Clubspot
      And the Clubspot sync has copied them into the CRM
      When staff set which program the class belongs to
      And the Clubspot sync runs again
      Then the program has an offering for the class's session, with the session's dates
      And the sailor is registered in that offering

  Rule: A CRM Reader or CRM Writer can see Clubspot's events and registrations, but can't change them, apart from linking them

    Example: A CRM Writer can see Clubspot's events and registrations, but can't change them
      Given a user with the CRM Writer policy
      Then they can see Clubspot's events and registrations
      But they can't change Clubspot's events and registrations

    Example: A CRM Reader can see Clubspot's events and registrations, but can't change them
      Given a user with the CRM Reader policy
      Then they can see Clubspot's events and registrations
      But they can't change Clubspot's events and registrations

  Rule: A CRM Writer can link a class to its program, and a sailor to the right person in the CRM

    Example: A CRM Writer sets a class's program, and matches a sailor to a person
      Given a user with the CRM Writer policy
      Then they can set which program a class belongs to
      And they can match a registration's sailor to a person in the CRM

  Rule: The Clubspot sync can add, see, and edit what it copies from Clubspot, its notes, and its run logs

    Example: The Clubspot sync adds and edits what it copies
      Given the Clubspot sync's service account
      Then it can add, see, and edit sessions, classes, and registrations
      And it can add, see, and edit people, their details, and their medical information
      And it can add, see, and edit its notes
      And it can add, see, and edit its run logs

  Rule: The Clubspot sync can delete people, replace which classes a session offers and a registration's payments, and keep offerings and registrations in step with Clubspot, but can't delete anything else

    Example: The Clubspot sync can delete people
      Given the Clubspot sync's service account
      Then it can delete people, their details, and their medical information

    Example: A new copy from Clubspot replaces which classes a session offers and a registration's payments
      Given the Clubspot sync's service account
      Then it can replace which classes a session offers with a new copy from Clubspot
      And it can replace a registration's payments with a new copy from Clubspot

    Example: The Clubspot sync keeps offerings and registrations in step with Clubspot
      Given the Clubspot sync's service account
      Then it can add, see, edit, and delete offerings and the registrations in them

    Example: The Clubspot sync can't delete anything else
      Given the Clubspot sync's service account
      Then it can't delete sessions, classes, or registrations
      And it can't delete its notes
      And it can't delete its run logs

  Rule: The Clubspot sync can't see or add programs

    Example: The Clubspot sync looks for programs
      Given the Clubspot sync's service account
      Then it can't add or see programs

  Rule: When the Clubspot sync merges two people, the person kept takes over the duplicate's program roles

    Example: The person kept becomes the coach
      Given two people who are the same sailor, one a coach in a program
      And staff have approved merging them
      When the Clubspot sync runs
      Then the person kept is the coach
      And the duplicate is gone

  Rule: The Clubspot sync can move a person's program roles and which Google groups they're in to someone else, but can't add or delete them

    Example: The Clubspot sync can only move what a person takes part in
      Given the Clubspot sync's service account
      Then it can see people's program roles and which Google groups they're in
      And it can move people's program roles and which Google groups they're in to another person
      But it can't add or delete people's program roles or which Google groups they're in

  Rule: A CRM Writer can change which sign-up answers get copied

    Example: A CRM Writer chooses a sign-up answer to copy
      Given a user with the CRM Writer policy
      Then they can change which sign-up answers get copied

  Rule: The Clubspot sync can see which sign-up answers get copied, but can't change that

    Example: The Clubspot sync can't choose a sign-up answer to copy
      Given the Clubspot sync's service account
      Then it can see which sign-up answers get copied
      But it can't change which sign-up answers get copied
