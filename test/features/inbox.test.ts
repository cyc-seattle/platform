import { describeFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { TEST_MAILBOX, TEST_VOLUNTEER } from "../../stacks/inbox/cluster.ts";
import { newRunId } from "./cluster.ts";
import {
  canSignIn,
  conversationAbout,
  deleteAuthentikUsers,
  eventually,
  freescout,
  inboxHasApi,
  inboxOf,
  newAuthentikUser,
  sendToInbox,
  type ReceivedEmail,
} from "./inbox.ts";
import { deleteUsers } from "./steps/logins.ts";
import { deleteRows } from "./steps/rows.ts";
import { feature } from "./support.ts";

afterAll(async () => {
  await deleteAuthentikUsers();
  // Rows first: a person's row points at its user.
  const failures = [...(await deleteRows()), ...(await deleteUsers())];
  if (failures.length > 0) {
    throw new Error(`Couldn't clean up:\n${failures.join("\n")}`);
  }
}, 120_000);

/** Who emailed info@ in a scenario, and what about. */
interface Thread {
  runId: string;
  sender: string;
  subject: string;
  conversationId?: number;
  volunteerId?: number;
  reply?: ReceivedEmail;
}

async function emailInfo(): Promise<Thread> {
  const runId = newRunId();
  const thread = { runId, sender: `sender-${runId}@example.test`, subject: `Summer camp question ${runId}` };
  await sendToInbox(runId, {
    from: thread.sender,
    subject: thread.subject,
    text: "Is there still room in the July camp?",
  });
  return thread;
}

async function volunteerId(): Promise<number> {
  const users = (await freescout("GET", `/users?email=${encodeURIComponent(TEST_VOLUNTEER)}`))._embedded.users;
  return users[0].id;
}

async function takeAndReply(thread: Thread): Promise<void> {
  const conversation = await conversationAbout(thread.subject);
  thread.conversationId = conversation.id;
  thread.volunteerId ??= await volunteerId();
  await freescout("PUT", `/conversations/${conversation.id}`, {
    byUser: thread.volunteerId,
    assignTo: thread.volunteerId,
  });
  await freescout("POST", `/conversations/${conversation.id}/threads`, {
    type: "message",
    user: thread.volunteerId,
    text: "Yes, there are two spots left.",
  });
}

async function replyReceived(thread: Thread): Promise<ReceivedEmail> {
  return eventually(`the reply to reach ${thread.sender}`, async () =>
    (await inboxOf(thread.sender)).find((email) => email.subject === `Re: ${thread.subject}`),
  );
}

describeFeature(
  feature("inbox.feature"),
  ({ Rule }) => {
    Rule("Only people allowed to use the shared inbox can sign in", ({ RuleScenario }) => {
      RuleScenario("A volunteer allowed to use the shared inbox can sign in", ({ Given, Then }) => {
        let user: number;
        Given("a volunteer allowed to use the shared inbox", async () => {
          user = await newAuthentikUser(newRunId(), true);
        });
        Then("they can sign in to the shared inbox", async () => {
          expect(await canSignIn(user)).toBe(true);
        });
      });

      RuleScenario("A parent who isn't allowed to use the shared inbox can't sign in", ({ Given, Then }) => {
        let user: number;
        Given("a parent who isn't allowed to use the shared inbox", async () => {
          user = await newAuthentikUser(newRunId(), false);
        });
        Then("they can't sign in to the shared inbox", async () => {
          expect(await canSignIn(user)).toBe(false);
        });
      });
    });

    Rule("An email to info@ becomes a conversation, and a reply goes back from info@", ({ RuleScenario }) => {
      RuleScenario("A volunteer takes an email to info@ and answers it", ({ Given, And, When, Then }) => {
        let thread: Thread;
        Given("someone has emailed info@", async () => {
          thread = await emailInfo();
        });
        And("a volunteer on the info@ mailbox", async () => {
          thread.volunteerId = await volunteerId();
        });
        When("the volunteer takes the email and replies", async () => {
          await takeAndReply(thread);
        });
        Then("the sender gets the reply from info@", async () => {
          expect((await replyReceived(thread)).from).toContain(TEST_MAILBOX);
        });
        And("the conversation shows the volunteer has it", async () => {
          const conversation = await freescout("GET", `/conversations/${thread.conversationId}`);
          expect(conversation.assignee?.id).toBe(thread.volunteerId);
        });
      });

      RuleScenario("The sender's answer joins the same conversation", ({ Given, When, Then }) => {
        let thread: Thread;
        Given("a volunteer has answered an email to info@", async () => {
          thread = await emailInfo();
          await takeAndReply(thread);
          thread.reply = await replyReceived(thread);
        });
        When("the sender answers the reply", async () => {
          await sendToInbox(thread.runId, {
            from: thread.sender,
            subject: `Re: ${thread.subject}`,
            text: "Thank you, I'll register tonight.",
            inReplyTo: thread.reply!.messageId,
          });
        });
        Then("the sender's answer is in the same conversation", async () => {
          await eventually("the answer to join the conversation", async () => {
            const conversation = await freescout("GET", `/conversations/${thread.conversationId}?embed=threads`);
            const fromSender = conversation._embedded.threads.filter((t: { type: string }) => t.type === "customer");
            return fromSender.length === 2 ? true : undefined;
          });
        });
      });
    });
  },
  // FreeScout's API module is bought and installed by hand, so these wait until it is.
  { excludeTags: inboxHasApi() ? [] : ["api"] },
);
