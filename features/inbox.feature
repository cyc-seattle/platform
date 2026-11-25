Feature: The shared inbox
  Crew and staff answer the sailing center's email together in the shared inbox. A mailbox is one
  shared address, such as info@. Each email to it arrives in the shared inbox as a conversation.
  Someone takes a conversation, answers it, and closes it, and everyone on the mailbox can see who
  has which conversation. Their answers go out from the mailbox's address, not their own.

  Only people an admin allows can sign in to the shared inbox: those in a group that gives the
  FreeScout Agent policy. An admin puts each of them on the mailboxes they answer, and they see only
  those.

  Rule: Only people allowed to use the shared inbox can sign in

    Example: A volunteer allowed to use the shared inbox can sign in
      Given a volunteer allowed to use the shared inbox
      Then they can sign in to the shared inbox

    Example: A parent who isn't allowed to use the shared inbox can't sign in
      Given a parent who isn't allowed to use the shared inbox
      Then they can't sign in to the shared inbox
