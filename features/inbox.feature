Feature: The shared inbox
  Crew and staff answer the sailing center's email together in the shared inbox. A mailbox is one
  shared address, such as info@. Each email to it arrives in the shared inbox as a conversation.
  Someone takes a conversation, answers it, and closes it, and everyone on the mailbox can see who
  has which conversation. Their answers go out from the mailbox's address, not their own.

  Only people an admin allows can sign in to the shared inbox. An admin puts each of them on the
  mailboxes they answer, and they see only those.

  Rule: Only people allowed to use the shared inbox can sign in

    Example: A volunteer allowed to use the shared inbox can sign in
      Given a volunteer allowed to use the shared inbox
      Then they can sign in to the shared inbox

    Example: A parent who isn't allowed to use the shared inbox can't sign in
      Given a parent who isn't allowed to use the shared inbox
      Then they can't sign in to the shared inbox

  @api
  Rule: An email to info@ becomes a conversation, and a reply goes back from info@

    Example: A volunteer takes an email to info@ and answers it
      Given someone has emailed info@
      And a volunteer on the info@ mailbox
      When the volunteer takes the email and replies
      Then the sender gets the reply from info@
      And the conversation shows the volunteer has it

    Example: The sender's answer joins the same conversation
      Given a volunteer has answered an email to info@
      When the sender answers the reply
      Then the sender's answer is in the same conversation
