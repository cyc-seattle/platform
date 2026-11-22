Feature: The website's contact form
  A visitor writes to CSC from the Contact Us page. Their message arrives at info@ as an email, and
  replying to it writes back to them. Nothing they type is kept anywhere else.

  Rule: A message reaches info@, and a reply goes to the visitor

    Example: A visitor's message reaches info@
      When a visitor sends a message from the contact form
      Then info@ gets an email with their name, email, phone and message
      And replying to it writes to the visitor

  Rule: Bots and floods don't reach info@

    Example: A form with the hidden field filled in sends nothing
      When a bot sends a message from the contact form, filling in the hidden field
      Then info@ gets no email
      And the bot is told the message was sent

    Example: A fourth message from one address in an hour sends nothing
      Given a visitor has sent 3 messages from the contact form in the past hour
      When they send another
      Then info@ gets no email
      And they're told it wasn't sent, and to email info@ instead

    Example: A message from another site sends nothing
      When a message is sent to the contact form from another website
      Then info@ gets no email
