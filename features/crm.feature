@licensed
Feature: The CRM
  The CRM is the club's list of people: sailors, their parents, and the coaches, volunteers, and
  staff who run programs. A person's details are their name, email, and phone, any extra emails and
  phone numbers they've given the club, and who their parents and emergency contacts are. The CRM
  also has the roles people have in programs. A registration is a sailor's sign-up for a camp, with
  their answers to the sign-up questions and their payments. The CRM also has each sailor's medical
  information: allergies, medications, and what to do in an emergency. That's the most private
  information the club has, so staff need a separate permission to see it.

  Staff get their permissions from the groups they're in. Each group gives its members one or more
  policies, and each policy is a named set of permissions. To change something means to add, edit,
  or delete it.

  - CRM Reader: can see people and their details, but can't change them.
  - CRM Writer: can change people and their details.
  - Medical Reader: can see sailors' medical information, but can't change it.
  - Medical Writer: can change sailors' medical information.

  Crew are the club's coaches and volunteers. They can see the rosters: who is signed up for each
  class. Families sign in to see their own children and their child's team. A team is everyone
  sailing in the same program at a camp that's running now. When a family signs up in Clubspot, it's
  asked whether to share its email and phone with the rest of the team. A Parent Coordinator is a
  parent who helps run one program. "Parent" means anyone listed as a sailor's parent or guardian.

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
      Given a sailor with two parents and two emergency contacts
      When an admin deletes one of the sailor's parents
      Then the CRM doesn't allow it
      And the parent is still in the CRM

  @pending
  Rule: A CRM Reader can see people and their details, but can't change them

    Example: A CRM Reader looks people up
      Given a user with the CRM Reader policy
      Then they can see people and their details
      But they can't change people and their details

  Rule: A CRM Writer can change people and their details

    Example: A CRM Writer adds, edits, and deletes people and their details
      Given a user with the CRM Writer policy
      Then they can change people and their details

  @pending
  Rule: A CRM Reader or CRM Writer can't see medical information without a Medical policy

    Scenario Outline: A CRM policy alone doesn't let someone see medical information
      Given a user with the <policy> policy
      Then they can't see medical information

      Examples:
        | policy     |
        | CRM Reader |
        | CRM Writer |

  @pending
  Rule: A Medical Reader can see every sailor's medical information, but can't change it

    Example: A Medical Reader looks up a sailor's allergies
      Given a user with the Medical Reader policy
      Then they can see medical information
      But they can't change medical information

  @pending
  Rule: A Medical Writer can change medical information

    Example: A Medical Writer adds, edits, and deletes medical information
      Given a user with the Medical Writer policy
      Then they can change medical information

  Rule: Crew can see the rosters, but can't change them

    Example: A coach looks at the rosters
      Given a user with the Crew role
      Then they can see the rosters
      But they can't change the rosters

  Rule: Crew can't see other families' medical information, parents and emergency contacts, extra emails or phone numbers, or registrations

    Example: A coach can't see a sailor's private information
      Given a user with the Crew role
      Then they can't see medical information
      And they can't see sailors' parents and emergency contacts
      And they can't see extra emails or phone numbers
      And they can't see registrations

  @pending
  Rule: A Crew member who is also a parent can see their own child, like any other parent

    Example: A volunteer looks up their own child's medical information
      Given a user with the Crew role whose child sails on a team
      And a teammate who opted in to sharing
      When they look up medical information
      Then they see their child's medical information
      But not the teammate's

  Rule: A family can see everyone on their child's team by name, whether or not the teammate's family opted in to sharing

    Background:
      Given a parent whose child sails on a team

    Example: The parent sees every teammate by name, whether or not the teammate's family opted in
      Given a teammate who opted in to sharing
      And a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see both teammates

    Example: The parent doesn't see a sailor who was on the team only at a past camp
      Given a sailor who was on the team only at a camp that has ended
      When they look at the roster
      Then they don't see the sailor

    Example: A parent whose child is on two teams sees both teams
      Given their child is also on a second team
      And a sailor who is only on the second team
      When they look at the roster
      Then they see the sailor

  Rule: A family can see an adult teammate's email and phone only if they opted in to sharing

    Background:
      Given a parent whose child sails on a team

    Example: The parent sees the email of an adult teammate who opted in
      Given an adult teammate who opted in to sharing
      When they look at the roster
      Then they see the teammate's email

    Example: The parent sees only the name of a teammate who hasn't answered
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's or their parent's email or phone

    Example: Opting in on one team doesn't share on another
      Given a teammate who opted in on another team but not on this one, and their parent
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's or their parent's email or phone

  Rule: A family never sees a child's own email or phone, only their parent's

    Background:
      Given a parent whose child sails on a team

    Example: The parent sees the email of an opted-in child's parent, but not the child's own
      Given a teammate who is a child and opted in to sharing, and their parent
      When they look at the roster
      Then they see the teammate's parent's email
      But they don't see the teammate's email or phone

    Example: A teammate with no date of birth on file counts as a child
      Given a teammate who opted in to sharing but has no date of birth on file
      When they look at the roster
      Then they see the teammate's name
      But they don't see the teammate's email or phone

  Rule: Once a family's camps have ended, they see only their own family

    Example: A family whose camp has ended sees none of their old teammates
      Given a parent whose child sailed only at a camp that has ended, with a teammate who opted in
      When they look at the roster
      Then they see only themselves and their child

  Rule: A family can opt in or out of sharing for each camp their child is signed up for, while the camp is running

    Example: A parent who opts out no longer shares their email with the team
      Given a parent whose child sails on a team and opted in to sharing
      And another parent on the team
      When the parent opts out for their child
      Then the other parent no longer sees the parent's email

    Example: A parent who opts back in shares their email again
      Given a parent whose child sails on a team and opted out of sharing
      And another parent on the team
      When the parent opts in for their child
      Then the other parent sees the parent's email

    Example: A family can't change its answer for a camp that has ended
      Given a parent whose child sailed only at a camp that has ended, with a teammate who opted in
      Then they can't change whether their child shares

  Rule: Only an adult sailor, or a sailor's parent, can decide whether the sailor shares

    Example: An adult sailor decides for themselves
      Given an adult who sails on a team
      Then they can opt out of sharing and back in

    Example: A sailor with no date of birth on file can't decide for themselves
      Given a sailor with no date of birth on file who sails on a team
      Then they can't change whether they share

    Example: A parent can't decide for another family
      Given a parent whose child sails on a team
      And a teammate who hasn't answered the sharing question, and their parent
      Then they can't change whether the teammate shares

  Rule: A family can't move their child to another camp

    Example: A parent tries to move their child to another camp
      Given a parent whose child sails on a team
      Then they can't move their child to another camp

  Rule: A family can't see another family's sharing answer or sign-up answers

    Example: A parent looks up a teammate's registration
      Given a parent whose child sails on a team
      And a teammate who opted in to sharing
      When they look up the teammate's registration
      Then they can't see the teammate's sharing answer
      And they can't see the teammate's sign-up answers

  Rule: A family can see their own child's parents, and a teammate's parents if the teammate opted in

    Background:
      Given a parent whose child sails on a team

    Example: A parent sees their own child's parents, and an opted-in teammate's parent
      Given a teammate who is a child and opted in to sharing, and their parent
      When they look up who each sailor's parents are
      Then they see themselves listed as their child's parent
      And they see who the teammate's parent is

    Example: A parent can't see who a teammate's parent is unless the teammate opted in
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look up who the teammate's parent is
      Then they see no one

  Rule: A family can't see anyone's extra emails or phone numbers

    Example: A parent can't see the extra emails or phone numbers people have given
      Given a parent whose child sails on a team
      And a teammate who opted in to sharing
      Then they can't see anyone's extra emails or phone numbers

  @pending
  Rule: A family can see their own children's medical information, and no one else's

    Example: A parent looks up their child's medical information
      Given a parent whose child sails on a team
      And a teammate who opted in to sharing
      When they look up medical information
      Then they see their child's medical information
      But not the teammate's

  Rule: A family can't change their child's details or medical information

    Example: A parent can't change their child's details
      Given a parent whose child sails on a team
      Then they can't change their child's details
      And they can't change their child's medical information

  Rule: A family can't uncover a hidden email or phone by searching, filtering, or sorting

    Background:
      Given a parent whose child sails on a team
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

  Rule: A Parent Coordinator can see the email and phone of every adult parent in their program, whether or not the family opted in

    Example: A Parent Coordinator sees a parent's email, even if they haven't answered the sharing question
      Given a Parent Coordinator for a program
      And a sailor in the program who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the sailor's parent's email

    Example: A Parent Coordinator doesn't see the email or phone of a parent under 18
      Given a Parent Coordinator for a program
      And a sailor in the program whose parent is under 18
      When they look at the roster
      Then they see no email or phone for the sailor's parent

  Rule: A Parent Coordinator can't see a child's own email or phone

    Example: A Parent Coordinator sees a child in the program by name only
      Given a Parent Coordinator for a program
      And a sailor in the program who is a child, with an email and phone of their own
      When they look at the roster
      Then they see the sailor's name
      But they don't see the sailor's email or phone

  Rule: A Parent Coordinator can see only the sailors in their own program

    Example: A Parent Coordinator doesn't see a sailor in another program
      Given a Parent Coordinator for a program
      And a sailor in another program at the same camp
      When they look at the roster
      Then they don't see the sailor

  Rule: A Parent Coordinator can see who each sailor's parents are, but not the details of their registrations

    Example: A Parent Coordinator looks up a sailor's parent
      Given a Parent Coordinator for a program
      And a sailor in the program who hasn't answered the sharing question, and their parent
      When they look up who each sailor's parents are
      Then they see who the sailor's parent is
      But they can't see the details of the program's registrations

  Rule: A family member who helps run a program, in any role but Parent Coordinator, doesn't see more of the team because of that role

    Example: A race committee volunteer sees no one in the program
      Given a race committee volunteer for a program
      When they look at the roster
      Then they see no one in the program

  Rule: A Parent Coordinator whose role has ended sees no one in the program

    Example: A Parent Coordinator whose role ended three days ago sees no one in the program
      Given a Parent Coordinator for a program whose role ended three days ago
      When they look at the roster
      Then they see no one in the program

  Rule: A family can use the roster page on cycsail.team

    Example: A parent opens the roster page
      Given a parent whose child sails on a team
      When they open the roster page
      Then the page loads without errors and shows their child's team
