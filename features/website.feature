@licensed
Feature: The public website
  The center's public website, cyccommunitysailing.org, is built from content kept here: its pages,
  program categories and programs, questions and answers, crew, policies, and sponsors. The pictures
  the website shows are kept in a Website folder of their own.

  The website is built outside the club's systems, by a service account of its own: the website
  build. Anything it can see could end up on the public website. So it can see the website and its
  pictures, and nothing else.

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

  Rule: The website build can't see anything else

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

    Example: The website build can't see a picture kept anywhere else
      Given the website build's service account
      And a picture outside the website's folder
      Then it can't see the picture
