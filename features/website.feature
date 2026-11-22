@licensed
Feature: The public website
  The center's public website, cyccommunitysailing.org, is built from content kept here: its pages,
  program categories and programs, questions and answers, policies, and sponsors. Its crew come from
  Crew: each crew member's public profile, shown while they hold a position the page lists. A
  profile is their name, a bio, and a photo. The pictures the website shows are kept in a Website
  folder of their own.

  The website is built outside the club's systems, by a service account of its own: the website
  build. Anything it can see could end up on the public website. So it can see the website, its
  pictures, and the public profiles of crew on the website, with the first and last name of each.
  It can see what's on sale, so a program page shows its dates and prices: each program's name and
  ages, each offering that isn't archived, with its price, capacity and how many are confirmed, its
  registration form, and whether that form's Clubspot camp, once public, takes registrations. It
  can see nothing else. The website shows only the first name unless staff choose the full name.

  Rule: The website build can see the website and its pictures

    Example: The website build can see every part of the website
      Given the website build's service account
      Then it can see the website

    Example: The website build can see a page on the website
      Given the website build's service account
      And a page on the website
      Then it can see the page

    Example: The website build can see a picture in the website's folder
      Given the website build's service account
      And a picture in the website's folder
      Then it can see the picture

  Rule: The website build sees a crew member's public profile, and nothing else about them

    Example: The website build sees a crew member on the website and their current position
      Given the website build's service account
      And a crew member on the website, with a current term as Head Coach
      Then it can see their first and last name, whether to show both, and their bio and photo
      And it can see their term as Head Coach

    Example: The website build sees only a crew member's name in the CRM
      Given the website build's service account
      And a crew member on the website, with a current term as Head Coach
      Then it can't see anything else about them in the CRM
      And it can't see their qualifications or pay

    Example: The website build can't see a crew member who isn't on the website
      Given the website build's service account
      And a crew member who isn't on the website, with a current term as Head Coach
      Then it can't see them or their terms
      And it can't see their name

    Example: The website build can't see anyone in the CRM who isn't crew on the website
      Given the website build's service account
      And a person in the CRM who isn't on Crew
      Then it can't see their name

    Example: The website build can't see a term that has ended
      Given the website build's service account
      And a crew member on the website whose term as Treasurer ended yesterday
      Then it can't see that term

    Example: The website build can't search crew by what it can't see
      Given the website build's service account
      When it searches crew members by their person's email
      Then it isn't allowed

  Rule: The website build sees what's on sale, and nothing else about it

    Example: The website build sees an offering on sale, and how full it is
      Given the website build's service account
      And an offering on a public Clubspot camp's form, with a sailor confirmed in it
      Then it can see the offering's dates, price and capacity, and that one is confirmed
      And it can see the offering's form, and whether its camp takes registrations
      But it can't see who registered, or the offering's link to Clubspot

    Example: The website build can't see an archived offering
      Given the website build's service account
      And an archived offering
      Then it can't see the offering

    Example: The website build can't see a Clubspot camp that isn't public
      Given the website build's service account
      And an offering on the form of a Clubspot camp that isn't public
      Then it can't see the camp

  Rule: The website build can't see anything else

    Example: The website build can't see anything outside the website, crew's public profiles, and what's on sale
      Given the website build's service account
      Then it can't see anything outside the website, crew's public profiles, and what's on sale

    Scenario Outline: The website build can't see <records>
      Given the website build's service account
      Then it can't see <records>

      Examples:
        | records                  |
        | people and their details |
        | medical information      |
        | registrations            |
        | the rest of the catalog  |
        | plans                    |
        | groups                   |
        | qualifications held      |

    Example: The website build can't see a picture kept anywhere else
      Given the website build's service account
      And a picture outside the website's folder
      Then it can't see the picture

    Example: The website build sees only a catalog program's name and ages through the website
      Given the website build's service account
      And a program on the website linked to a program in the catalog
      When it looks at the catalog program through the website's program
      Then it sees only the catalog program's name and ages

    Example: The website build can't find out about a picture kept elsewhere by searching
      Given the website build's service account
      And a sponsor whose logo is kept outside the website's folder
      When it searches the sponsors by their logo's file name
      Then it isn't allowed
