Feature: Google Groups for programs and groups
  Each program has a Google group, and everyone on Crew with a current term for it, such as a coach
  or a Parent Coordinator, belongs to the group. The Google sync adds them to the group, and takes
  them out once their last term for it ends, unless they're there as a family. A group in the CRM, such as the Board of Directors, can fill a
  Google group too: the Google sync makes its members exactly the group's members, taking out
  anyone who isn't in the group, but never the Google group's managers. It won't take out everyone,
  or more than five people at once, until someone allows it. The CRM has a copy of each Google group and its members, and
  records who the sync added. If someone leaves a group, the Google sync doesn't add them back until
  staff let them back in. The Google sync also reports problems for staff to fix, such as classes
  that Clubspot sells together whose programs book their money to different revenue accounts.

  The Google sync signs in to the CRM with an account of its own, called a service account. It can
  see only what it needs. To fill the groups, it can see the programs, their rosters, who holds a
  term for each, but not their pay, the CRM's groups and who is in each, and people's extra emails
  and phone numbers. A program's roster is everyone
  signed up for it, and each sign-up is a registration. To check the revenue accounts, it can see
  products and their revenue accounts. It writes notes in the CRM: a list of tasks, and reports of
  problems for staff to fix. To change something means to add, edit, or delete it.

  Rule: Everyone with a current term for a program is in that program's Google group

    Example: A coach joins their program's group
      Given a program with a Google group
      And a coach in the program
      When the Google sync runs
      Then they're in the group

    Example: A coach whose term starts next month isn't added yet
      Given a program with a Google group
      And a coach whose term for the program starts next month
      When the Google sync runs
      Then they're not in the group

  Rule: Someone whose last term for a program has ended is taken out of its Google group

    Example: A coach whose term ended leaves the group
      Given a program with a Google group
      And a coach in the group, whose term for the program ended last month
      When the Google sync runs
      Then they're not in the group

  Rule: Someone who leaves a program's group stays out until staff let them back in

    Example: Staff let someone who left back into the group
      Given a program with a Google group
      And a coach in the program who has left the group
      When the Google sync runs
      Then they're still not in the group
      When staff let them back into the group
      And the Google sync runs again
      Then they're in the group again

  Rule: A group in the CRM makes its Google group's members exactly its own

    Example: A new board member gets the board's email
      Given a group in the CRM that fills a Google group
      When an admin adds someone to the group
      And the Google sync runs for the group
      Then they're in the Google group

    Example: Someone taken out of the group leaves the Google group
      Given a member of a group in the CRM that fills a Google group
      When an admin takes them out of the group
      And the Google sync runs for the group
      Then they're not in the Google group

    Example: Someone added to the Google group by hand is taken out
      Given a group in the CRM that fills a Google group
      And someone not in the group, added to the Google group by hand
      When the Google sync runs for the group
      Then they're not in the Google group

    Example: The Google sync won't empty a Google group by itself
      Given a Google group with members, which a group in the CRM with no one in it starts to fill
      When the Google sync runs for the group
      Then they're all still in the Google group

    Example: The Google group's manager stays
      Given a group in the CRM that fills a Google group
      And a manager of the Google group who isn't in the group
      When the Google sync runs for the group
      Then they're still a manager of the Google group

  Rule: A Google group that a group in the CRM fills along with anything else is filled by neither

    Example: A program and a group fill the same Google group
      Given a group in the CRM that fills a Google group
      And a program whose Google group is the same one
      When an admin adds someone to the group
      And the Google sync runs for the group
      Then they're not in the Google group

  Rule: The Google sync can see what it uses to fill groups, but can't change it

    Example: The Google sync looks up programs, rosters, and program roles
      Given the Google sync's service account
      Then it can see what it uses to fill groups
      But it can't change what it uses to fill groups

  Rule: The Google sync can see each group's name, its Google group, and who is in it, but not what it gives

    Example: The Google sync looks up the CRM's groups
      Given the Google sync's service account
      Then it can see only each group's name and Google group, and who is in it
      And it can't see what each group gives

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

  Rule: The Google sync can change its record of whom it added to each Google group

    Example: The Google sync forgets someone it took out when their term ended
      Given the Google sync's service account
      Then it can change whom it added to each Google group

  Rule: The Google sync can see who holds a term for each program, but not their pay

    Example: The Google sync looks up Crew's terms
      Given the Google sync's service account
      Then it can see only each term's crew member, program, and dates, and each crew member's person

  Rule: The Google sync can see products and their revenue accounts, to check that classes Clubspot sells together book their money to one revenue account

    Example: The Google sync looks up products and revenue accounts
      Given the Google sync's service account
      Then it can see products
      And it can see revenue accounts
