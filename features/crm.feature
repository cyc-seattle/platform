@licensed
Feature: The CRM
  The CRM is the club's list of people: sailors, their parents, and the coaches, volunteers, and
  staff who run programs. A person's details are their name, email, and phone, any extra emails and
  phone numbers they've given the club, and who their parents and emergency contacts are. The CRM
  also has each person's program roles: the roles they have in programs, such as coach, Parent
  Coordinator, or race committee. A registration is a sailor's sign-up for a program, with their
  answers to the sign-up questions and their payments. The CRM also has each sailor's medical
  information: allergies, medications, and what to do in an emergency. That's the most private
  information the club has, so staff need a separate permission to see it.

  Staff get their permissions from the groups they're in. Each group gives its members one or more
  policies, and each policy is a named set of permissions. To change something means to add, edit,
  or delete it.

  - CRM Reader: can see people and their details, but can't change them.
  - CRM Writer: can change people and their details.
  - Medical Reader: can see sailors' medical information, but can't change it.
  - Medical Writer: can change sailors' medical information.

  What else someone sees depends on their role (see "Roles and groups"):

  - Community: families who have signed up for any program. They see only their own family.
  - Team: families on a team. They also see everyone on every team by name, and the email and phone
    of the adults on a team who chose to share them.
  - Crew: people an admin has vetted, such as staff, coaches, directors, and officers. They see
    every roster, everyone's email and phone, everyone's parents and emergency contacts, and every
    sailor's medical information.

  A team is a program the club marks as one, such as a race team. A program's roster is everyone
  signed up for it. A sailor is on a team from when they sign up for it until 12 months after their
  last time on it ends, and a sailor's parents are on the team with them. "Parent" means anyone
  listed as a sailor's parent or guardian. A child is anyone under 18, or whose date of birth isn't
  on file.

  Each adult decides whether to share their own email and phone with the teams. Clubspot asks when a
  family signs a sailor up, and the answer counts for the sailor if they're an adult, or for their
  parents if not. An adult can change their answer later, and the latest answer counts. A child
  never shares their own email or phone. A program role, such as Parent Coordinator, doesn't change
  what anyone sees.

  Rule: A sailor can have more than one parent, and more than one emergency contact

    Example: A sailor with two parents and two emergency contacts
      Given a sailor with two parents and two emergency contacts
      When an admin looks up the sailor's parents and emergency contacts
      Then they see both parents and both emergency contacts

  Rule: Each sailor has one set of medical information

    Example: A second set of medical information for the same sailor isn't allowed
      Given a sailor with medical information on file
      When an admin adds a second set of medical information for the sailor
      Then the CRM doesn't allow it

  Rule: A person can't be deleted while they're still listed as someone's parent

    Example: Deleting a sailor's parent isn't allowed
      Given a sailor with a parent
      When an admin deletes the sailor's parent
      Then the CRM doesn't allow it
      And the parent is still in the CRM

  Rule: A CRM Reader can see people and their details, but can't change them

    Example: A CRM Reader looks people up
      Given a user with the CRM Reader policy
      Then they can see people and their details
      But they can't change people and their details

  Rule: A CRM Writer can change people and their details

    Example: A CRM Writer adds, edits, and deletes people and their details
      Given a user with the CRM Writer policy
      Then they can change people and their details

  Rule: A CRM Reader or CRM Writer can't see medical information without a Medical policy

    Scenario Outline: A CRM policy alone doesn't let someone see medical information
      Given a user with the <policy> policy
      Then they can't see medical information

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  Rule: A Medical Reader can see every sailor's medical information, but can't change it

    Example: A Medical Reader looks up a sailor's allergies
      Given a user with the Medical Reader policy
      Then they can see medical information
      But they can't change medical information

  Rule: A Medical Writer can change medical information

    Example: A Medical Writer adds, edits, and deletes medical information
      Given a user with the Medical Writer policy
      Then they can change medical information


  Rule: Crew can see every roster, but can't change any of them

    Example: A Crew member looks at the rosters
      Given a user with the Crew role
      Then they can see the rosters
      But they can't change the rosters

  @pending
  Rule: Crew can see everyone's email and phone, parents, and emergency contacts, whether or not they chose to share

    Example: A Crew member looks people up
      Given a user with the Crew role
      Then they can see people and their details
      But they can't change people and their details

    Example: A Crew member sees the email of a parent who hasn't answered the sharing question
      Given a user with the Crew role
      And a sailor in a program who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the sailor's parent's email

  @pending
  Rule: Crew can see every sailor's medical information, but can't change it

    Example: A Crew member looks up a sailor's allergies
      Given a user with the Crew role
      Then they can see medical information
      But they can't change medical information

  @pending
  Rule: Crew can see who is signed up for what, but not the sign-up answers or payments

    Example: A Crew member looks up a sailor's registrations
      Given a user with the Crew role
      Then they can see offerings and the registrations in them
      But they can't see a registration's payments
      And they can't see sign-up answers

  @pending
  Rule: A family on no team sees only their own family

    Example: A parent sees their child, but not the others in the program
      Given a parent whose child is signed up for a program that isn't a team
      And another sailor in the program who chose to share, and their parent
      When they look at the roster
      Then they see only themselves and their child

    Example: A parent can see who their child's parents are, but not the other sailor's
      Given a parent whose child is signed up for a program that isn't a team
      And another sailor in the program who chose to share, and their parent
      When they look up who each sailor's parents are
      Then they see themselves listed as their child's parent
      But they don't see who the sailor's parent is

  Rule: A family can see their own children's medical information, and no one else's

    Example: A parent looks up their child's medical information
      Given a parent whose child is signed up for a program
      And another sailor in the program
      When they look up medical information
      Then they see their child's medical information
      But not the other sailor's

    @pending
    Example: An adult sailor looks up their own medical information
      Given an adult sailor signed up for a program
      When they look up medical information
      Then they see their own medical information

  Rule: A family can't change their child's details or medical information

    Example: A parent can't change their child's details
      Given a parent whose child is signed up for a program
      Then they can't change their child's details
      And they can't change their child's medical information

  Rule: A family can't move their child to another program

    Example: A parent tries to move their child to another program
      Given a parent whose child is signed up for a program
      Then they can't move their child to another program

  @pending
  Rule: A family on a team sees everyone on every team by name, whether or not they chose to share

    Background:
      Given a parent whose child is on a team

    Example: The parent sees a teammate who hasn't answered the sharing question, and the teammate's parent
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the teammate's name
      And they see the teammate's parent's name

    Example: The parent sees who a teammate's parent is
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look up who each sailor's parents are
      Then they see who the teammate's parent is

    Example: The parent sees a sailor on another team
      Given a sailor who is only on another team
      When they look at the roster
      Then they see the sailor

    Example: The parent doesn't see a sailor in a program that isn't a team
      Given a sailor who is only in a program that isn't a team
      When they look at the roster
      Then they don't see the sailor

    Example: The parent still sees a sailor whose last time on a team ended a month ago
      Given a sailor whose last time on a team ended a month ago
      When they look at the roster
      Then they see the sailor

    Example: The parent doesn't see a sailor whose last time on a team ended over a year ago
      Given a sailor whose last time on a team ended 13 months ago
      When they look at the roster
      Then they don't see the sailor

  @pending
  Rule: A family on a team sees an adult's email and phone only if that adult chose to share

    Background:
      Given a parent whose child is on a team

    Example: The parent sees the email of an adult teammate who chose to share
      Given an adult teammate who chose to share
      When they look at the roster
      Then they see the teammate's email

    Example: The parent sees the email of a teammate's parent who chose to share
      Given a teammate who is a child, and their parent, who chose to share
      When they look at the roster
      Then they see the teammate's parent's email

    Example: The parent sees only the name of a teammate who hasn't answered
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's or their parent's email or phone

    Example: The parent sees only the name of an adult teammate who chose not to share
      Given an adult teammate who chose not to share
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's email or phone

  @pending
  Rule: A family on a team never sees a child's own email or phone

    Background:
      Given a parent whose child is on a team

    Example: The parent sees a child on a team by name only
      Given a teammate who is a child, with an email and phone of their own, and their parent, who chose to share
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's email or phone

    Example: A teammate with no date of birth on file counts as a child
      Given a teammate with no date of birth on file, and an email and phone of their own
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's email or phone

  @pending
  Rule: A family whose last time on a team ended over a year ago sees only their own family

    Example: A parent whose child left the team 13 months ago sees none of the old teammates
      Given a parent whose child's last time on a team ended 13 months ago
      And an adult teammate who chose to share
      When they look at the roster
      Then they see only themselves and their child

  @pending
  Rule: A family on a team can't see anyone's sharing answer, sign-up answers, extra emails or phone numbers, or medical information

    Background:
      Given a parent whose child is on a team
      And an adult teammate who chose to share

    Example: A parent looks up a teammate's sharing answer and sign-up answers
      When they look up the teammate's registration
      Then they can't see the teammate's sharing answer
      And they can't see the teammate's sign-up answers

    Example: A parent can't see the extra emails or phone numbers people have given
      Then they can't see anyone's extra emails or phone numbers

    Example: A parent looks up medical information
      When they look up medical information
      Then they see their child's medical information
      But not the teammate's

  @pending
  Rule: A family on a team can't uncover a hidden email or phone by searching, filtering, or sorting

    Background:
      Given a parent whose child is on a team
      And a teammate who hasn't answered the sharing question, and their parent

    Scenario Outline: Searching for a hidden email or phone doesn't find the teammate
      When they search people for <search>
      Then they don't find the teammate

      Examples:
        | search                                    |
        | the teammate's email                      |
        | the first letters of the teammate's email |
        | the teammate's phone                      |
        | any part of the teammate's email          |
        | the teammate's parent's email             |

    Example: Asking for everyone with a phone number doesn't find the teammate
      When they ask for everyone with a phone number on file
      Then they don't find the teammate

    Example: Sorting or grouping people by email or phone isn't allowed
      When they ask for a list that would reveal hidden emails or phone numbers
      Then the CRM doesn't allow it

  @pending
  Rule: Each adult decides for themselves whether to share their email and phone

    Example: An adult sailor stops sharing, then shares again
      Given an adult sailor signed up for a program
      Then they can stop sharing and share again

    Example: A parent stops sharing, then shares again
      Given a parent whose child is on a team
      Then they can stop sharing and share again

    Example: A parent can't decide for another parent
      Given a parent whose child is on a team
      And a teammate who hasn't answered the sharing question, and their parent
      Then they can't change whether the teammate's parent shares

    Example: A sailor with no date of birth on file can't decide for themselves
      Given a sailor with no date of birth on file, signed up for a program
      Then they can't change whether they share

  @pending
  Rule: The latest answer to the sharing question counts, from Clubspot or from the family

    Example: A parent who stopped sharing says yes on a later sign-up
      Given a parent whose child is on a team, who stopped sharing
      When they say yes to sharing when they sign their child up again in Clubspot
      Then they share their email and phone

    Example: A parent who said yes in Clubspot stops sharing
      Given a parent whose child is on a team, who said yes to sharing in Clubspot
      When they stop sharing
      Then they don't share their email and phone

  @pending
  Rule: A program role doesn't change what someone sees

    Example: A Parent Coordinator who isn't Crew sees only their own family
      Given a Parent Coordinator for a program
      And a sailor in the program who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they don't see the sailor
      And they don't see the sailor's parent

  Rule: Being on race committee doesn't let a family member see the program's roster

    Example: A family member on race committee sees no one in the program
      Given a family member who is on race committee for a program
      When they look at the roster
      Then they see no one in the program

  @pending
  Rule: A family on a team can use the roster page on cycsail.team

    Example: A parent opens the roster page
      Given a parent whose child is on a team
      When they open the roster page
      Then the page loads without errors and shows the teams' rosters
