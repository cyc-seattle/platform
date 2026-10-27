Feature: gsuite-sync brings program roles into Google Groups
  Each program has a Google group, and the people who hold a role in the program belong to it.
  gsuite-sync adds them, and records each membership it adds in the CRM. Someone who leaves a group
  stays out of it until staff let them back. gsuite-sync also flags problems for staff to fix, such
  as a camp whose programs post to different revenue accounts. It signs in with a service account of
  its own, which reads only what it maps into groups.

  Rule: A program's role holders belong to its group, and one who leaves stays out until staff let them back

    # One example, because each sync run takes minutes: the second run starts from the first's end
    # state. The Workspace fake can't remove a member, so the leaver leaves before the first run:
    # the CRM records that the sync added them, and the group doesn't have them.
    Example: Role holders join the group, and staff let a leaver back
      Given a group in the Workspace fake
      And a program in the CRM that points at the group
      And a person in the CRM who holds a role in the program
      And a second role holder whom gsuite-sync added to the group, who has since left it
      When gsuite-sync runs
      Then the person is a member of the group
      And the leaver is not a member of the group
      And the leaver's membership row records that they left
      When staff delete the leaver's membership row
      And gsuite-sync runs again
      Then the leaver is a member of the group
      And the leaver has a fresh membership row

  Rule: gsuite-sync reads what it maps into groups, and changes none of it

    Example: gsuite-sync reads the programs, rosters, and roles
      Given gsuite-sync's service account
      Then it can read the programs, rosters, and roles it maps into groups
      But it can't update the programs, rosters, and roles it maps into groups

    Example: gsuite-sync can't add or edit people
      Given gsuite-sync's service account
      Then it can't create or update people

  Rule: gsuite-sync sees no one's sign-up answers, and only the emails and phones in an address book

    Example: gsuite-sync reads only who a registration is for
      Given gsuite-sync's service account
      Then it can read only who each registration's sailor is

    Example: gsuite-sync reads only the emails and phones in an address book
      Given gsuite-sync's service account
      Then it can read only the kind and value of each email and phone in an address book

  Rule: gsuite-sync reads no medical profiles or billing

    Example: gsuite-sync can't read medical profiles or billing
      Given gsuite-sync's service account
      Then it can't read medical profiles
      And it can't read billing

  Rule: gsuite-sync keeps its own queue, findings, and Google groups, and deletes none of them

    Example: gsuite-sync records its work
      Given gsuite-sync's service account
      Then it can create, read, and update its queue, findings, and Google groups
      But it can't delete its queue, findings, and Google groups

  @pending
  Rule: gsuite-sync reads products and their revenue accounts, to check each camp's programs post to one

    Example: gsuite-sync reads products and accounts
      Given gsuite-sync's service account
      Then it can read products and accounts
