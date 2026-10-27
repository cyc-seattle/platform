Feature: Camps and registrations from Clubspot
  Families sign up for camps in Clubspot. The Clubspot sync copies each camp's sessions and classes,
  and each registration, from Clubspot into the CRM. A registration comes with the sailor's answers
  to the sign-up questions and what they paid. The sync adds each sailor and parent on a
  registration to the CRM as a person, so staff work from one list of people. When it finds the same
  person in the CRM twice, it merges the two into one. The CRM also has event staffing from
  Clubspot: which coaches and staff work each session.

  Staff fix a camp or a registration in Clubspot, not in the CRM, because the next copy would undo
  a change made in the CRM. In the CRM, staff only link what came from Clubspot to the rest of the
  club's data: which program a class belongs to, and which person in the CRM a sailor is.

  The Clubspot sync signs in to the CRM with an account of its own, called a service account, which
  can only do the work the sync needs. It keeps notes in the CRM: a list of tasks, and reports of
  problems for staff to fix. It also logs each run. Staff choose which sign-up answers, such as a
  sailor's school, get copied onto a person's details.

  A person's details are their name, email, and phone, any extra emails and phone numbers, and who
  their parents and emergency contacts are. A person's roles are their roles in programs, the
  sessions they staff, and the Google groups they're in. To change something means to add, edit, or
  delete it.

  Rule: Each sailor and parent on a registration becomes a person in the CRM

    Example: A sailor's registration adds the sailor and their parent to the CRM
      Given a camp running today in Clubspot
      And a sailor registered for it, with a parent
      When the Clubspot sync runs
      Then the CRM has the sailor as a person
      And the CRM has the sailor's parent as a person, listed as their parent

  Rule: Staff can see what came from Clubspot, but can only change it in Clubspot

    Example: A CRM Writer can see camps and registrations, but can't change them
      Given a user with the CRM Writer policy
      Then they can see what came from Clubspot
      But they can't change what came from Clubspot

    @pending
    Example: A CRM Reader can see camps and registrations, but can't change them
      Given a user with the CRM Reader policy
      Then they can see what came from Clubspot
      But they can't change what came from Clubspot

  Rule: A CRM Writer can link a class to its program, and a sailor to their person in the CRM

    Example: A CRM Writer sets a class's program, and matches a sailor to a person
      Given a user with the CRM Writer policy
      Then they can set which program a class belongs to
      And they can match a registration's sailor to a person in the CRM

  Rule: The Clubspot sync can add, see, and edit what it copies from Clubspot

    Example: The Clubspot sync adds and edits what it copies
      Given the Clubspot sync's service account
      Then it can add, see, and edit camps and registrations
      And it can add, see, and edit people's details and medical information
      And it can add, see, and edit its notes
      And it can add, see, and edit its run logs

  Rule: The Clubspot sync deletes something only when it merges two people, or when a new copy from Clubspot replaces it

    Example: Merging two people deletes the duplicate
      Given the Clubspot sync's service account
      Then it can delete people's details and medical information

    Example: A new copy from Clubspot replaces a session's classes and a registration's billing
      Given the Clubspot sync's service account
      Then it can delete a session's list of classes
      And it can delete a registration's billing

    Example: The Clubspot sync can't delete anything else
      Given the Clubspot sync's service account
      Then it can't delete camps, sessions, classes, or registrations
      And it can't delete its notes
      And it can't delete its run logs

  Rule: The Clubspot sync can't see or add programs

    Example: The Clubspot sync looks for programs
      Given the Clubspot sync's service account
      Then it can't add or see programs

  Rule: When the Clubspot sync merges two people, the person kept takes over the duplicate's roles

    Example: The person kept becomes the coach
      Given two people who are the same sailor, one a coach in a program
      And staff have approved merging them
      When the Clubspot sync runs
      Then the person kept is the coach
      And the duplicate is gone

  Rule: The Clubspot sync can move a person's roles to someone else, but can't add or delete them

    Example: The Clubspot sync can only move people's roles
      Given the Clubspot sync's service account
      Then it can see people's roles
      And it can move people's roles to another person
      But it can't add or delete people's roles

  Rule: The Clubspot sync can see which sign-up answers to copy, but only staff can change that

    Example: The Clubspot sync can't add a sign-up answer to copy
      Given the Clubspot sync's service account
      Then it can see which sign-up answers to copy
      But it can't add sign-up answers to copy
