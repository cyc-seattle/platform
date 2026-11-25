import { expect } from "vitest";
import { newRunId } from "./cluster.ts";
import { countAfterWait, mailUrl, postForm, search, text, waitForMail } from "./mail.ts";
import { describeAccessFeature, onEachScenario, Step } from "./steps/index.ts";

// The contact form's scenarios post to the forms endpoint as the website would, and read what it
// sent to info@ from Mailpit. Each visitor's name carries a run ID, so runs never read each
// other's mail.

const site = "https://cyccommunitysailing.org";

let runId = newRunId();
let location = "";
/** How many of this scenario's messages reached info@ before the step that sends nothing. */
let delivered = 0;
onEachScenario(() => {
  runId = newRunId();
  location = "";
  delivered = 0;
});

const visitor = () => ({
  first_name: "Visitor",
  last_name: runId,
  email: `visitor-${runId}@example.com`,
  phone: "206-555-0100",
  message: `Do you still have spots in the July adult class? (${runId})`,
  website: "",
});
const theirMail = () => `subject:"Website message from Visitor ${runId}"`;

async function send(form: Record<string, string>, origin = site) {
  ({ location } = await postForm(`${mailUrl()}/forms/contact`, form, origin));
}

Step("a visitor sends a message from the contact form", async () => {
  await send(visitor());
  expect(location).toBe(`${site}/contact-us/sent`);
});
Step("info@ gets an email with their name, email, phone and message", async () => {
  const mail = await waitForMail(theirMail());
  expect(mail.To.map((t) => t.Address)).toEqual(["info@cyccommunitysailing.org"]);
  const body = await text(mail);
  for (const part of [`Visitor ${runId}`, visitor().email, visitor().phone, visitor().message]) {
    expect(body).toContain(part);
  }
});
Step("replying to it writes to the visitor", async () => {
  const mail = await waitForMail(theirMail());
  expect(mail.ReplyTo.map((r) => r.Address)).toEqual([visitor().email]);
});

Step("a bot sends a message from the contact form, filling in the hidden field", () =>
  send({ ...visitor(), website: "https://spam.example" }),
);
Step("the bot is told the message was sent", () => {
  expect(location).toBe(`${site}/contact-us/sent`);
});

Step("a visitor has sent 3 messages from the contact form in the past hour", async () => {
  for (let i = 0; i < 3; i++) {
    await send(visitor());
    expect(location).toBe(`${site}/contact-us/sent`);
  }
  await expect.poll(async () => (await search(theirMail())).length, { timeout: 60_000, interval: 2_000 }).toBe(3);
  delivered = 3;
});
Step("they send another", () => send(visitor()));
Step("they're told it wasn't sent, and to email info@ instead", () => {
  expect(location).toBe(`${site}/contact-us/not-sent`);
});

Step("a message is sent to the contact form from another website", () => send(visitor(), "https://spam.example"));

Step("info@ gets no email", async () => {
  expect(await countAfterWait(theirMail())).toBe(delivered);
});

describeAccessFeature("contact.feature");
