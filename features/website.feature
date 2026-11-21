@licensed
Feature: The public website
  The center's public website, cyccommunitysailing.org, is built from content kept here: its pages,
  program categories and programs, questions and answers, policies, and sponsors. Its crew come from
  Crew: each crew member's public profile, shown while they hold a position the page lists. The
  pictures the website shows are kept in a Website folder of their own.

  The website is built outside the club's systems, by a service account of its own: the website
  build. Anything it can see could end up on the public website. So it can see the website, its
  pictures, and the public profiles of crew on the website, and nothing else.

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
      Then it can see their name, bio and photo for the website
      And it can see their term as Head Coach

    Example: The website build can't see who a crew member is in the CRM
      Given the website build's service account
      And a crew member on the website, with a current term as Head Coach
      Then it can't see which person they are
      And it can't see their qualifications or pay

    Example: The website build can't see a crew member who isn't on the website
      Given the website build's service account
      And a crew member who isn't on the website, with a current term as Head Coach
      Then it can't see them or their terms

    Example: The website build can't see a term that has ended
      Given the website build's service account
      And a crew member on the website whose term as Treasurer ended yesterday
      Then it can't see that term

    Example: The website build can't search crew by what it can't see
      Given the website build's service account
      When it searches crew members by their person's email
      Then it isn't allowed

  Rule: The website build can't see anything else

    Example: The website build can't see anything outside the website and crew's public profiles
      Given the website build's service account
      Then it can't see anything outside the website and crew's public profiles

    Scenario Outline: The website build can't see <records>
      Given the website build's service account
      Then it can't see <records>

      Examples:
        | records                  |
        | people and their details |
        | medical information      |
        | registrations            |
        | the catalog              |
        | plans                    |
        | groups                   |
        | qualifications held      |

    Example: The website build can't see a picture kept anywhere else
      Given the website build's service account
      And a picture outside the website's folder
      Then it can't see the picture

    Example: The website build can't see a catalog program through the website
      Given the website build's service account
      And a program on the website linked to a program in the catalog
      When it looks at the catalog program through the website's program
      Then it sees none of the catalog program's details

    Example: The website build can't find out about a picture kept elsewhere by searching
      Given the website build's service account
      And a sponsor whose logo is kept outside the website's folder
      When it searches the sponsors by their logo's file name
      Then it isn't allowed
