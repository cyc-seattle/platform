Feature: Who holds which role
  Everyone who signs in to the club's data holds one of three roles, which sets their base access.
  Community is for the club's families and members, who see their own children and their teammates.
  Crew is for its volunteers and staff, who read the rosters they run programs from and keep a
  family's view of their own children. Admin runs the platform. Anything beyond a role's base
  access, such as keeping the CRM or planning a season, comes from a group. The Data Studio is the
  web app where the club reads and edits its data.

  @pending
  Rule: Everyone who signs in holds the Community, Crew, or Admin role

    Example: No one holds a role outside the three
      Then every person who signs in holds the Community, Crew, or Admin role

  @pending
  Rule: A person who signs in for the first time holds the Community role

    Example: A parent signs in for the first time
      Given a person in the CRM who has never signed in
      When they sign in for the first time
      Then they hold the Community role

  Rule: Only an admin changes a person's role

    @pending
    Example: An admin makes a volunteer Crew
      Given a user with the Community role
      When an admin gives them the Crew role
      Then they hold the Crew role
      And they can read the rosters

    @pending
    Scenario Outline: No other role changes a role, their own included
      Given a user with the <role> role
      Then they can't change anyone's role, their own included

      Examples:
        | role      |
        | Community |
        | Crew      |

    @pending
    Example: Keeping the CRM doesn't let a volunteer change roles
      Given a user with the Crew role and the CRM Writer policy
      Then they can't change anyone's role, their own included

  @pending
  Rule: Signing in again keeps a person's role

    Example: A Crew member signs in again
      Given a user with the Crew role
      When they sign in again
      Then they still hold the Crew role

  Rule: Every role opens the Data Studio

    Scenario Outline: Crew and Admin open the Data Studio
      Given a user with the <role> role
      Then they can open the Data Studio

      Examples:
        | role  |
        | Crew  |
        | Admin |

    @pending
    Example: A family member opens the Data Studio
      Given a user with the Community role
      Then they can open the Data Studio
