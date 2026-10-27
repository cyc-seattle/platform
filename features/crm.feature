@licensed
Feature: Who can see and change the CRM
  The CRM holds the club's people: its sailors, their families, and the volunteers and staff who run
  its programs. With each person it keeps their family links (who is their guardian or emergency
  contact), their address book (every email and phone on file for them), the roles they hold in
  programs, and the records the syncs keep of their own work. A sailor's medical profile holds their
  allergies, medications, and emergency details. It's the most sensitive data the club keeps, so
  it's granted apart from the rest of the CRM.

  Clubspot's records are the camps, sessions, classes, and registrations that families sign up for in
  Clubspot, with each registration's billing. Only clubspot-sync changes them. The rosters are the
  part a coach needs: the programs, camps, sessions, and classes, who is entered in each, and their
  names. Programs belong to the catalog.

  Staff keep the CRM through policies a group grants them: CRM Reader or CRM Writer, and Medical
  Reader or Medical Writer. Crew read the rosters. Families, on the Community role, see their own
  children and their children's teammates. A team is everyone sailing in one program in a camp
  that's running now. A Parent Coordinator is a family member who helps run one program.

  @pending
  Rule: A CRM Reader sees the CRM and Clubspot's records, and changes nothing

    Example: A CRM Reader looks people up
      Given a user with the CRM Reader policy
      Then they can read the CRM
      And they can read Clubspot's records
      But they can't change the CRM
      And they can't change Clubspot's records

  Rule: A CRM Writer keeps the CRM

    Example: A CRM Writer adds, edits, and removes the CRM's records
      Given a user with the CRM Writer policy
      Then they can change the CRM

  Rule: Clubspot's records change in Clubspot, so a CRM Writer only links them to the CRM

    Example: A CRM Writer reads Clubspot's records, and can't change them
      Given a user with the CRM Writer policy
      Then they can read Clubspot's records
      But they can't change Clubspot's records

    Example: A CRM Writer files a class under its program, and matches a sailor to their person
      Given a user with the CRM Writer policy
      Then they can set a class's program
      And they can match a registration's sailor to a person in the CRM

  @pending
  Rule: Medical profiles need a Medical policy, even for a CRM Writer

    Scenario Outline: A CRM policy alone reads no medical profiles
      Given a user with the <policy> policy
      Then they can't read medical profiles

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  @pending
  Rule: A Medical Reader reads every medical profile, and changes none

    Example: A Medical Reader looks up a sailor's allergies
      Given a user with the Medical Reader policy
      Then they can read medical profiles
      But they can't change medical profiles

  @pending
  Rule: A Medical Writer keeps medical profiles

    Example: A Medical Writer adds, edits, and removes medical profiles
      Given a user with the Medical Writer policy
      Then they can change medical profiles

  @pending
  Rule: Programs are the catalog's, so the CRM policies read them and change none

    Scenario Outline: A CRM policy reads programs, and can't change them
      Given a user with the <policy> policy
      Then they can read programs
      But they can't change programs

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  Rule: Crew read the rosters, and change nothing

    Example: A coach reads the rosters
      Given a user with the Crew role
      Then they can read the rosters
      But they can't change the rosters

  Rule: Crew see no medical profiles, family links, address books, or registrations, beyond their own family's

    Example: A coach can't read another family's medical profile, family links, or registrations
      Given a user with the Crew role
      Then they can't read medical profiles
      And they can't read family links and address books
      And they can't read registrations and their billing

  @pending
  Rule: A Crew member who is also a parent keeps their family's view

    Example: A volunteer reads their own child's medical profile
      Given a user with the Crew role who is the guardian of a sailor on a team
      When they look up medical profiles
      Then they see their child's

  Rule: A family sees everyone on their child's team by name, whether or not they opted in to sharing

    Background:
      Given a guardian whose child sails on a team

    Example: Teammates show by name, whether or not they opted in
      Given an adult teammate who opted in to sharing
      And a teammate who hasn't answered the sharing question, with a guardian
      When they view their rosters
      Then they see both teammates

    Example: A sailor who was on the team only in a camp that has ended isn't on it now
      Given a sailor who was on the team only in a camp that has ended
      When they view their rosters
      Then they don't see the sailor

    Example: A child on two teams brings both teams' sailors
      Given their child also sails on a second team, with a sailor who isn't on the first
      When they view their rosters
      Then they see the sailor

  Rule: A family sees a teammate's contact details only if the teammate opted in to sharing

    Background:
      Given a guardian whose child sails on a team

    Example: An adult teammate who opted in shows their email
      Given an adult teammate who opted in to sharing
      When they view their rosters
      Then they see the teammate's email

    Example: A teammate who hasn't answered shows only their name
      Given a teammate who hasn't answered the sharing question, with a guardian
      When they view their rosters
      Then they see the teammate's name
      But no contact details for the teammate or the teammate's guardian

    Example: A child who opted in shows their guardian's contact details, never their own
      Given a teammate who is a child and opted in to sharing, with a guardian
      When they view their rosters
      Then they see the teammate's guardian's email
      But no contact details for the teammate

    Example: A teammate with no date of birth on file counts as a child
      Given an adult teammate who opted in to sharing, with no date of birth on file
      When they view their rosters
      Then they see the teammate's name
      But no contact details for the teammate

    Example: A sailor's choice on one team doesn't carry over to another
      Given a teammate who opted in on another team but not on this one, with a guardian
      When they view their rosters
      Then they see the teammate's name
      But no contact details for the teammate or the teammate's guardian

  Rule: Once a family's camps have ended, they see only themselves

    Example: A family whose camp ended sees no former teammates
      Given a guardian whose child sailed only in a camp that has ended, alongside a teammate who opted in
      When they view their rosters
      Then they see only themselves and their child

  Rule: Signing in matches a person in the CRM by email, whatever its case

    Example: A guardian who types their email in capitals sees their child's team
      Given a guardian whose child sails on a team, who signs in typing their email in capitals
      And an adult teammate who opted in to sharing
      When they view their rosters
      Then they see the teammate's email

    Example: Someone whose email isn't in the CRM sees no one
      Given a user with the Community role whose email no one in the CRM has
      When they view their rosters
      Then they see no one

  Rule: A family chooses whether to share its contact details, for each of its registrations in a camp running now

    Example: A guardian who opts out disappears from teammates' rosters
      Given a guardian whose child sails on a team and opted in to sharing
      And a teammate who hasn't answered the sharing question, with a guardian who signs in
      When the guardian opts out for their child
      Then the teammate's guardian doesn't see the guardian's email

    Example: A guardian who opts back in shows again
      Given a guardian whose child sails on a team and opted out of sharing
      And a teammate who hasn't answered the sharing question, with a guardian who signs in
      When the guardian opts in for their child
      Then the teammate's guardian sees the guardian's email

    Example: An adult sailor chooses for themselves
      Given an adult who sails on a team and signs in
      Then they can opt out of sharing and back in

    Example: A sailor with no date of birth on file can't choose for themselves
      Given a sailor with no date of birth on file who sails on a team and signs in
      Then they can't change whether they share

    Example: A guardian can't choose for another family
      Given a guardian whose child sails on a team
      And a teammate who hasn't answered the sharing question, with a guardian
      Then they can't change whether the teammate shares

    Example: A family can't choose for a camp that has ended
      Given a guardian whose child sailed only in a camp that has ended, alongside a teammate who opted in
      Then they can't change whether their child shares

    Example: A family can't move a registration to another camp
      Given a guardian whose child sails on a team
      Then they can't move their child's registration to another camp

  Rule: A family can't see another family's sharing choice or sign-up answers

    Example: A guardian looks up a teammate's registration
      Given a guardian whose child sails on a team
      And an adult teammate who opted in to sharing
      When they look up the teammate's registration
      Then they can't see whether the teammate opted in, or for which camp
      And they can't see the teammate's sign-up answers

  Rule: A family sees who is whose guardian only for its own children and for teammates who opted in

    Background:
      Given a guardian whose child sails on a team

    Example: A guardian sees their own link, and an opted-in teammate's
      Given a teammate who is a child and opted in to sharing, with a guardian
      When they look up who is whose guardian
      Then they see that they're their child's guardian
      And they see who the teammate's guardian is

    Example: Filtering for a teammate who hasn't opted in finds no link
      Given a teammate who hasn't answered the sharing question, with a guardian
      When they look up who is the teammate's guardian
      Then they see no one

  Rule: A family reads no one's address book

    Example: A guardian can't read the address book
      Given a guardian whose child sails on a team
      And an adult teammate who opted in to sharing
      Then they can't read anyone's address book

  @pending
  Rule: A family reads its own children's medical profiles, and no one else's

    Example: A guardian reads their child's medical profile
      Given a guardian whose child sails on a team
      And an adult teammate who opted in to sharing
      When they look up medical profiles
      Then they see their child's

  Rule: A family changes neither its child's record nor their medical profile

    Example: A guardian can't edit their child's record
      Given a guardian whose child sails on a team
      Then they can't change their child's record
      And they can't change their child's medical profile

  Rule: A family can't find out a hidden contact detail by filtering, searching, or sorting

    Background:
      Given a guardian whose child sails on a team
      And a teammate who hasn't answered the sharing question, with a guardian

    Scenario Outline: A search on a hidden detail finds no more than a search for a value no one has
      When they search people by <detail>
      Then they find the same people as a search for a value no one has
      And they don't find the teammate

      Examples:
        | detail                                    |
        | the teammate's email                      |
        | the first letters of the teammate's email |
        | the teammate's phone                      |
        | free text from the teammate's email       |
        | the teammate's guardian's email           |

    Example: Filtering for people who have a phone doesn't find the teammate
      When they filter people for those with a phone on file
      Then they don't find the teammate

    Scenario Outline: Sorting or grouping by a hidden detail is refused
      When they ask for <request>
      Then they're refused

      Examples:
        | request                    |
        | people sorted by email     |
        | people grouped by email    |
        | a count of distinct phones |

  Rule: A Parent Coordinator sees every family's contact details in their program, without an opt-in

    Background:
      Given a Parent Coordinator of a team

    Example: A guardian's email shows, though their child hasn't answered
      Given a sailor on the team who hasn't answered the sharing question, with a guardian
      When they view their rosters
      Then they see the sailor's guardian's email

    Example: A child's own contact details never show
      Given a sailor on the team who is a child, with an email and phone of their own
      When they view their rosters
      Then they see the sailor's name
      But no contact details for the sailor

    Example: A guardian who is a child shows no contact details
      Given a sailor on the team whose guardian is a child
      When they view their rosters
      Then they see no contact details for the sailor's guardian

    Example: A sailor in another program doesn't show
      Given a sailor in another program in the same camp
      When they view their rosters
      Then they don't see the sailor

    Example: A coordinator sees who is whose guardian, and no registration reads as their own
      Given a sailor on the team who hasn't answered the sharing question, with a guardian
      When they look up who is whose guardian
      Then they see who the sailor's guardian is
      And none of the team's registrations reads as their own

  Rule: Another role in a program, or a coordinator role that has ended, shows no one

    Example: A volunteer in another role sees no one on the team
      Given a volunteer in another role on a team
      When they view their rosters
      Then they see no one on the team

    Example: A Parent Coordinator whose role ended three days ago sees no one on the team
      Given a Parent Coordinator of a team whose role ended three days ago
      When they view their rosters
      Then they see no one on the team

  Rule: The portal's roster works for a family

    Example: A guardian opens the portal's roster
      Given a guardian whose child sails on a team
      When they open the portal's roster
      Then every request it sends succeeds
      And it shows them a family's view
