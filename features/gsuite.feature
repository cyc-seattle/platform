Feature: Google Groups for programs
  Each program has a Google group, and everyone with a program role in it, such as a coach or a
  Parent Coordinator, belongs to the group. A program role is a role someone has in one program. The
  Google sync adds them to the group. The CRM has a copy of each Google group and its members, and
  records who the sync added. If someone leaves a group, the Google sync doesn't add them back until
  staff let them back in. The Google sync also reports problems for staff to fix, such as classes
  that Clubspot sells together whose programs book their money to different revenue accounts.

  The Google sync signs in to the CRM with an account of its own, called a service account. It can
  see only what it needs. To fill the groups, it can see the programs, their rosters, who has a
  program role in each, and people's extra emails and phone numbers. A program's roster is everyone
  signed up for it, and each sign-up is a registration. To check the revenue accounts, it can see
  products and their revenue accounts. It writes notes in the CRM: a list of tasks, and reports of
  problems for staff to fix. To change something means to add, edit, or delete it.

  Rule: Everyone with a program role is in that program's Google group

    Example: A coach joins their program's group
      Given a program with a Google group
      And a coach in the program
      When the Google sync runs
      Then they're in the group

  Rule: Someone who leaves a program's group stays out until staff let them back in

    Example: Staff let someone who left back into the group
      Given a program with a Google group
      And a coach in the program who has left the group
      When the Google sync runs
      Then they're still not in the group
      When staff let them back into the group
      And the Google sync runs again
      Then they're in the group again

  Rule: The Google sync can see what it uses to fill groups, but can't change it

    Example: The Google sync looks up programs, rosters, and program roles
      Given the Google sync's service account
      Then it can see what it uses to fill groups
      But it can't change what it uses to fill groups

  Rule: The Google sync can see which sailor a registration is for, but nothing else about it

    Example: The Google sync looks up a registration
      Given the Google sync's service account
      Then it can see only which sailor each registration is for

  Rule: The Google sync can see each extra email and phone number, and whose it is, but nothing else stored with it

    Example: The Google sync looks up a person's extra emails and phone numbers
      Given the Google sync's service account
      Then it can see only each extra email or phone number, and whose it is

  Rule: The Google sync can't see medical information or payments

    Example: The Google sync can't see medical information or payments
      Given the Google sync's service account
      Then it can't see medical information
      And it can't see payments

  Rule: The Google sync can add, see, and edit its notes and the Google groups, but can't delete them

    Example: The Google sync keeps its notes and the groups up to date
      Given the Google sync's service account
      Then it can add, see, and edit its notes
      And it can add, see, and edit the Google groups
      But it can't delete its notes
      And it can't delete the Google groups

  @pending
  Rule: The Google sync can see products and their revenue accounts, to check that classes Clubspot sells together book their money to one revenue account

    Example: The Google sync looks up products and revenue accounts
      Given the Google sync's service account
      Then it can see products
      And it can see revenue accounts
