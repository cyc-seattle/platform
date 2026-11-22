Feature: The newsletter
  Anyone can sign up for CSC's newsletter on the website. They're on the list only once they confirm
  from the email it sends them, and that click is the record that they asked for it. Staff write and
  send it in Listmonk.

  Rule: A signup joins the list only once it's confirmed

    Example: A visitor who signs up gets an email asking them to confirm
      When a visitor signs up for the newsletter
      Then they get an email asking them to confirm
      And they aren't on the newsletter list yet

    Example: A visitor who confirms joins the list
      Given a visitor has signed up for the newsletter
      When they confirm from the email
      Then they're on the newsletter list

    Example: A signup with the hidden field filled in sends nothing
      When a bot signs up for the newsletter, filling in the hidden field
      Then no confirmation email is sent

  Rule: A subscriber can leave the list

    Example: A subscriber who leaves gets no more issues
      Given a subscriber on the newsletter list
      When they leave the list from the link to their preferences in an issue
      Then they're not on the newsletter list
