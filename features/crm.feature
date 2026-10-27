@licensed
Feature: Who can see and change the CRM
  The CRM is the club's list of people: sailors, their parents, and the coaches, volunteers, and
  staff who run programs. For each person it has their name, email, and phone, any other emails and
  phone numbers they've given the club, who their parents and emergency contacts are, and the roles
  they have in programs. It also has each sailor's medical information: allergies, medications, and
  what to do in an emergency. That's the most private information the club has, so staff need a
  separate permission to see it.

  Staff get their permissions from the groups they're in. Each group gives its members one or more
  policies, and each policy is a named set of permissions:

  - CRM Reader: can see the CRM, but can't change it.
  - CRM Writer: can add, edit, and delete people and their details.
  - Medical Reader: can see sailors' medical information, but can't change it.
  - Medical Writer: can add, edit, and delete sailors' medical information.

  Crew are the club's coaches and volunteers. They can see the rosters: who is signed up for each
  class. Families sign in to see their own children and their child's team. A team is everyone
  sailing in the same program at a camp that's running now. When a family signs up in Clubspot, it's
  asked whether to share its email and phone with the rest of the team. A Parent Coordinator is a
  parent who helps run one program. "Parent" means anyone listed as a sailor's parent or guardian.

  Rule: A sailor can have more than one parent and emergency contact

    Example: A sailor with two parents and an emergency contact
      Given a sailor with two parents and an emergency contact
      When an admin looks up the sailor's parents and emergency contacts
      Then they see both parents and the emergency contact

  Rule: Each sailor has one set of medical information

    Example: A second set of medical information for the same sailor is refused
      Given a sailor with medical information on file
      When an admin adds a second set of medical information for the sailor
      Then the CRM refuses it

  Rule: A person can't be deleted while they're still listed as someone's parent

    Example: Deleting a sailor's parent is refused
      Given a sailor with two parents and an emergency contact
      When an admin deletes one of the sailor's parents
      Then they're refused, and the parent is still in the CRM

  @pending
  Rule: A CRM Reader can see the CRM, but can't change it

    Example: A CRM Reader looks people up
      Given a user with the CRM Reader policy
      Then they can see the CRM
      But they can't change the CRM

  Rule: A CRM Writer can edit the CRM

    Example: A CRM Writer adds, edits, and deletes people and their details
      Given a user with the CRM Writer policy
      Then they can change the CRM

  @pending
  Rule: A CRM Reader or CRM Writer can't see medical information without a Medical policy

    Scenario Outline: A CRM policy alone doesn't show medical information
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
  Rule: A Medical Writer can edit medical information

    Example: A Medical Writer adds, edits, and deletes medical information
      Given a user with the Medical Writer policy
      Then they can change medical information

  Rule: Crew can see the rosters, but can't change them

    Example: A coach looks at the rosters
      Given a user with the Crew role
      Then they can see the rosters
      But they can't change the rosters

  Rule: Crew can't see other families' medical information, contact details, or registrations

    Example: A coach can't see a sailor's medical information, parents, or registration
      Given a user with the Crew role
      Then they can't see medical information
      And they can't see parents, emergency contacts, and other emails and phone numbers
      And they can't see registrations and billing

  @pending
  Rule: A Crew member who is also a parent can see their own child, like any other parent

    Example: A volunteer looks up their own child's medical information
      Given a user with the Crew role whose child sails on a team
      When they look up medical information
      Then they see their child's

  Rule: A family can see everyone on their child's team by name, whether or not they opted in to sharing

    Background:
      Given a parent whose child sails on a team

    Example: Teammates show by name, whether or not they opted in
      Given an adult teammate who opted in to sharing
      And a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see both teammates

    Example: A sailor who was on the team only at a past camp doesn't show
      Given a sailor who was on the team only at a camp that has ended
      When they look at the roster
      Then they don't see the sailor

    Example: A child on two teams shows the parent both teams
      Given their child also sails on a second team, with a sailor who isn't on the first
      When they look at the roster
      Then they see the sailor

  Rule: A family can see a teammate's email and phone only if the teammate opted in to sharing

    Background:
      Given a parent whose child sails on a team

    Example: An adult teammate who opted in shows their email
      Given an adult teammate who opted in to sharing
      When they look at the roster
      Then they see the teammate's email

    Example: A teammate who hasn't answered shows only their name
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the teammate's name
      But not the email or phone of the teammate or the teammate's parent

    Example: A child who opted in shows their parent's email, never their own
      Given a teammate who is a child and opted in to sharing, and their parent
      When they look at the roster
      Then they see the teammate's parent's email
      But not the email or phone of the teammate

    Example: A teammate with no date of birth on file counts as a child
      Given an adult teammate who opted in to sharing, with no date of birth on file
      When they look at the roster
      Then they see the teammate's name
      But not the email or phone of the teammate

    Example: Opting in on one team doesn't share on another
      Given a teammate who opted in on another team but not on this one, and their parent
      When they look at the roster
      Then they see the teammate's name
      But not the email or phone of the teammate or the teammate's parent

  Rule: Once a family's camps have ended, they see only their own family

    Example: A family whose camp has ended sees none of their old teammates
      Given a parent whose child sailed only at a camp that has ended, with a teammate who opted in
      When they look at the roster
      Then they see only themselves and their child

  Rule: A family can opt in or out of sharing for each of its registrations at a camp running now

    Example: A parent who opts out disappears from other families' rosters
      Given a parent whose child sails on a team and opted in to sharing
      And another family on the team, whose parent signs in
      When the parent opts out for their child
      Then the other family no longer sees the parent's email

    Example: A parent who opts back in shows again
      Given a parent whose child sails on a team and opted out of sharing
      And another family on the team, whose parent signs in
      When the parent opts in for their child
      Then the other family sees the parent's email

    Example: An adult sailor decides for themselves
      Given an adult who sails on a team and signs in
      Then they can opt out of sharing and back in

    Example: A sailor with no date of birth on file can't decide for themselves
      Given a sailor with no date of birth on file who sails on a team and signs in
      Then they can't change whether they share

    Example: A parent can't decide for another family
      Given a parent whose child sails on a team
      And a teammate who hasn't answered the sharing question, and their parent
      Then they can't change whether the teammate shares

    Example: A family can't change its answer for a camp that has ended
      Given a parent whose child sailed only at a camp that has ended, with a teammate who opted in
      Then they can't change whether their child shares

    Example: A family can't move a registration to another camp
      Given a parent whose child sails on a team
      Then they can't move their child's registration to another camp

  Rule: A family can't see another family's sharing answer or sign-up answers

    Example: A parent looks up a teammate's registration
      Given a parent whose child sails on a team
      And an adult teammate who opted in to sharing
      When they look up the teammate's registration
      Then they can't see whether the teammate opted in, or for which camp
      And they can't see the teammate's sign-up answers

  Rule: A family can see their own child's parents, and a teammate's parents if the teammate opted in

    Background:
      Given a parent whose child sails on a team

    Example: A parent sees their own child's parents, and an opted-in teammate's parent
      Given a teammate who is a child and opted in to sharing, and their parent
      When they look up who each sailor's parents are
      Then they see that they're their child's parent
      And they see who the teammate's parent is

    Example: A parent can't find out who the parent of a teammate who hasn't opted in is
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look up who the teammate's parent is
      Then they see no one

  Rule: A family can't see anyone's other emails and phone numbers

    Example: A parent can't see the other emails and phone numbers people have given
      Given a parent whose child sails on a team
      And an adult teammate who opted in to sharing
      Then they can't see anyone's other emails and phone numbers

  @pending
  Rule: A family can see their own children's medical information, and no one else's

    Example: A parent looks up their child's medical information
      Given a parent whose child sails on a team
      And an adult teammate who opted in to sharing
      When they look up medical information
      Then they see their child's

  Rule: A family can't change their child's details or medical information

    Example: A parent can't edit their child's details
      Given a parent whose child sails on a team
      Then they can't change their child's details
      And they can't change their child's medical information

  Rule: A family can't uncover a hidden email or phone by searching, filtering, or sorting

    Background:
      Given a parent whose child sails on a team
      And a teammate who hasn't answered the sharing question, and their parent

    Scenario Outline: Searching for a hidden email or phone finds no one extra
      When they search people for <search>
      Then they get the same people as a search for something no one has
      And they don't find the teammate

      Examples:
        | search                                    |
        | the teammate's email                      |
        | the first letters of the teammate's email |
        | the teammate's phone                      |
        | any part of the teammate's email          |
        | the teammate's parent's email             |

    Example: Asking for everyone with a phone number doesn't show the teammate
      When they ask for everyone with a phone number on file
      Then they don't find the teammate

    Scenario Outline: Sorting, grouping, or counting by email or phone is refused
      When they ask for <request>
      Then they're refused

      Examples:
        | request                            |
        | people sorted by email             |
        | people grouped by email            |
        | a count of different phone numbers |

  Rule: A Parent Coordinator can see every parent's email and phone in their program, whether or not they opted in

    Background:
      Given a Parent Coordinator of a team

    Example: A parent's email shows even if they haven't answered the sharing question
      Given a sailor on the team who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the sailor's parent's email

    Example: A child's own email and phone never show
      Given a sailor on the team who is a child, with an email and phone of their own
      When they look at the roster
      Then they see the sailor's name
      But not the email or phone of the sailor

    Example: A parent who is under 18 shows no email or phone
      Given a sailor on the team whose parent is under 18
      When they look at the roster
      Then they see no email or phone for the sailor's parent

    Example: A sailor in another program doesn't show
      Given a sailor in another program at the same camp
      When they look at the roster
      Then they don't see the sailor

    Example: A Parent Coordinator sees who each sailor's parents are, but not the details of their registrations
      Given a sailor on the team who hasn't answered the sharing question, and their parent
      When they look up who each sailor's parents are
      Then they see who the sailor's parent is
      And they can't see the details of the team's registrations

  Rule: Volunteers in other program roles, and Parent Coordinators whose role has ended, see no one

    Example: A volunteer in another role sees no one on the team
      Given a volunteer in another role on a team
      When they look at the roster
      Then they see no one on the team

    Example: A Parent Coordinator whose role ended three days ago sees no one on the team
      Given a Parent Coordinator of a team whose role ended three days ago
      When they look at the roster
      Then they see no one on the team

  Rule: The roster page on cycsail.team works for a family

    Example: A parent opens the roster page
      Given a parent whose child sails on a team
      When they open the roster page
      Then every request the page sends succeeds
      And it shows them what a family can see
