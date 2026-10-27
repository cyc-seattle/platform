Feature: Google Groups for programs
  Each program has a Google group, and everyone who has a role in the program, such as a coach or a
  Parent Coordinator, belongs to it. gsuite-sync adds them to the group, and notes each person it
  adds in the CRM. If someone leaves a group, gsuite-sync doesn't add them back until staff say so.
  gsuite-sync also reports problems for staff to fix, such as a camp whose programs post their money
  to different revenue accounts.

  gsuite-sync signs in to the CRM with an account of its own, called a service account. It can see
  only what it needs to fill the groups.

  Rule: Everyone with a role in a program is in its group, and someone who leaves stays out until staff let them back

    # One example, because each sync run takes minutes: the second run starts where the first ended.
    # The test's stand-in for Google can't remove a member, so the person who left is already out of
    # the group before the first run, while the CRM still notes that gsuite-sync added them.
    Example: People with a role join the group, and staff let someone who left back in
      Given a Google group
      And a program in the CRM that uses the group
      And a person in the CRM who has a role in the program
      And a second person with a role, whom gsuite-sync added to the group and who has since left it
      When gsuite-sync runs
      Then the person is in the group
      And the person who left is not in the group
      And the CRM notes that the person who left is out of the group
      When staff delete that note
      And gsuite-sync runs again
      Then the person who left is in the group again
      And the CRM notes that gsuite-sync added them again

  Rule: gsuite-sync can see the programs, rosters, and roles it uses, but can't change them

    Example: gsuite-sync can see programs, rosters, and roles, but can't edit them
      Given gsuite-sync's service account
      Then it can see the programs, rosters, and program roles it uses to fill groups
      But it can't edit the programs, rosters, and program roles it uses to fill groups

    Example: gsuite-sync can't add or edit people
      Given gsuite-sync's service account
      Then it can't add or edit people

  Rule: gsuite-sync can see only who each registration is for, and only the emails and phone numbers people have given

    Example: gsuite-sync can see only who each registration is for
      Given gsuite-sync's service account
      Then it can see only which sailor each registration is for

    Example: gsuite-sync can see only each email and phone number, and what kind it is
      Given gsuite-sync's service account
      Then it can see only the kind and value of people's other emails and phone numbers

  Rule: gsuite-sync can't see medical information or billing

    Example: gsuite-sync can't see medical information or billing
      Given gsuite-sync's service account
      Then it can't see medical information
      And it can't see billing

  Rule: gsuite-sync can add and edit its own task list, problem reports, and groups, but can't delete them

    Example: gsuite-sync notes what it has done
      Given gsuite-sync's service account
      Then it can add, see, and edit its task list, problem reports, and Google groups
      But it can't delete its task list, problem reports, and Google groups

  @pending
  Rule: gsuite-sync can see products and their revenue accounts, to check that each camp's programs use one account

    Example: gsuite-sync can see products and accounts
      Given gsuite-sync's service account
      Then it can see products and accounts
