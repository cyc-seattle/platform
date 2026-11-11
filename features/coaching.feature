@licensed
Feature: Coaches' recommendations
  After a season, a sailor's coach recommends what they should do next, such as the program to sign
  up for. A recommendation is for one sailor and one season: winter, spring, summer, or fall of a
  year, such as fall 2026. It names the program the coach recommends, gives a note, or both, and says
  which coach made it. Coaches write them in the club's apps.

  Coaches are Crew: people an admin has vetted and trusts with every roster, such as staff, coaches,
  and directors. Staff also get permissions from the groups they're in:

  - CRM Reader: can see the CRM, but can't change it.
  - CRM Writer: can change people, their details, and coaches' recommendations.

  Families sign in with the Community role, or the Team role once they're on a team. To change
  something means to add, edit, or delete it.

  The Clubspot sync sometimes finds the same person in the CRM twice. Once staff approve merging
  them, the person kept takes over the duplicate's recommendations. If both have one for the same
  season, the merge waits until staff delete one of the two.

  Rule: A sailor has one recommendation each season

    Example: A second recommendation for the same sailor and season isn't allowed
      Given a sailor with a recommendation for fall 2026
      When an admin adds another recommendation for the sailor for fall 2026
      Then the CRM doesn't allow it

    Example: A sailor can have a recommendation for the same season in another year
      Given a sailor with a recommendation for fall 2026
      When an admin adds another recommendation for the sailor for fall 2027
      Then the sailor has recommendations for fall 2026 and fall 2027

  Rule: A person can't be deleted while they have a recommendation

    Example: Deleting a sailor with a recommendation isn't allowed
      Given a sailor with a recommendation for fall 2026
      When an admin deletes the sailor
      Then the CRM doesn't allow it
      And the sailor is still in the CRM

  Rule: Crew can change coaches' recommendations

    Example: A coach adds, sees, edits, and deletes a recommendation
      Given a user with the Crew role
      Then they can change coaches' recommendations

  Rule: A CRM Reader can see coaches' recommendations, but can't change them

    Example: A CRM Reader looks at the recommendations
      Given a user with the CRM Reader policy
      Then they can see coaches' recommendations
      But they can't change coaches' recommendations

  Rule: A CRM Writer can change coaches' recommendations

    Example: A CRM Writer adds, sees, edits, and deletes a recommendation
      Given a user with the CRM Writer policy
      Then they can change coaches' recommendations

  Rule: A family can't see coaches' recommendations, even their own child's

    Example: A parent looks up their child's recommendations
      Given a parent whose child is signed up for a program
      And their child has a recommendation for fall 2026
      When they look up their child's recommendations
      Then they don't see any recommendations
