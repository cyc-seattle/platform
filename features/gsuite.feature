Feature: Google Groups for programs
  Each program has a Google group, and everyone who has a role in the program, such as a coach or a
  Parent Coordinator, belongs to it. The Google sync adds them to the group. The CRM keeps a copy of
  each Google group and who is in it, and notes each person the sync added. If someone leaves a
  group, the Google sync doesn't add them back until staff let them back in. The Google sync also
  reports problems for staff to fix, such as a camp whose programs book their money to different
  revenue accounts.

  The Google sync signs in to the CRM with an account of its own, called a service account. It can
  see only what it needs to fill the groups: the programs, their rosters, and who has a role in
  each. It keeps notes in the CRM: a list of tasks, and reports of problems for staff to fix. To
  change something means to add, edit, or delete it.

  Rule: Everyone with a role in a program is in the program's Google group

    Example: A coach joins their program's group
      Given a program with a Google group
      And a person with a role in the program
      When the Google sync runs
      Then they're in the group

  Rule: Someone who leaves a program's group stays out until staff let them back in

    Example: Staff let someone who left back into the group
      Given a program with a Google group
      And a person with a role in the program, who has left the group
      When the Google sync runs
      Then they're still not in the group
      When staff let them back into the group
      And the Google sync runs again
      Then they're in the group again

  Rule: The Google sync can see what it uses to fill groups, but can't change it

    Example: The Google sync looks up programs, rosters, and roles
      Given the Google sync's service account
      Then it can see what it uses to fill groups
      But it can't change what it uses to fill groups

  Rule: The Google sync can see which sailor a registration is for, but nothing else about it

    Example: The Google sync looks up a registration
      Given the Google sync's service account
      Then it can see only which sailor each registration is for

  Rule: The Google sync can see people's extra emails and phone numbers, but nothing else about them

    Example: The Google sync looks up a person's extra emails and phone numbers
      Given the Google sync's service account
      Then it can see only each extra email or phone number, and whose it is

  Rule: The Google sync can't see medical information or billing

    Example: The Google sync can't see medical information or billing
      Given the Google sync's service account
      Then it can't see medical information
      And it can't see billing

  Rule: The Google sync can add, see, and edit its notes and the Google groups, but can't delete them

    Example: The Google sync keeps its notes and the groups up to date
      Given the Google sync's service account
      Then it can add, see, and edit its notes
      And it can add, see, and edit the Google groups
      But it can't delete its notes
      And it can't delete the Google groups

  @pending
  Rule: The Google sync can see products and their revenue accounts, to check that each camp's programs use one account

    Example: The Google sync looks up products and accounts
      Given the Google sync's service account
      Then it can see products
      And it can see accounts
