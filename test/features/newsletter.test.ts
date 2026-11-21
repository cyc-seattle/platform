import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { expect } from "vitest";
import { newRunId, secretData } from "./cluster.ts";
import { countAfterWait, mailUrl, postForm, text, waitForMail } from "./mail.ts";
import { describeAccessFeature, onEachScenario, Step } from "./steps/index.ts";

// The newsletter's scenarios sign up through dev's Listmonk as the website's form does, read the
// confirmation from dev's Mailpit, and check the list through Listmonk's API as dev's read-only test
// login. Each reader's address carries a run ID, so runs never read each other's.

const stackConfig = yaml.load(
  readFileSync(join(import.meta.dirname, "../../stacks/listmonk/Pulumi.dev.yaml"), "utf8"),
) as { config: Record<string, unknown> };
const listId = stackConfig.config["listmonk:listId"] as string;
const next = "https://cyccommunitysailing.org/newsletter/check-your-email";

let runId = newRunId();
let optin: URL | undefined;
onEachScenario(() => {
  runId = newRunId();
  optin = undefined;
});

const reader = () => `reader-${runId}@example.com`;
const theirMail = () => `to:"${reader()}"`;

async function signUp(nonce = "") {
  return postForm(`${await mailUrl()}/subscription/form`, {
    email: reader(),
    name: `Reader ${runId}`,
    l: listId,
    nonce,
    next,
  });
}

/** Their subscription to the newsletter list, as Listmonk's API reports it, or undefined. */
async function subscription(): Promise<string | undefined> {
  const { LISTMONK_API_USER, LISTMONK_API_TOKEN } = await secretData("listmonk-tests");
  // `search`, not `query`: a SQL query needs the permission that reads every subscriber's every field.
  const response = await fetch(`${await mailUrl()}/api/subscribers?search=${encodeURIComponent(reader())}`, {
    headers: { authorization: `token ${LISTMONK_API_USER}:${LISTMONK_API_TOKEN}` },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    data: { results: { email: string; lists: { uuid: string; subscription_status: string }[] }[] };
  };
  const subscriber = body.data.results.find((result) => result.email === reader());
  return subscriber?.lists.find((list) => list.uuid === listId)?.subscription_status;
}

/** The confirmation email's link, once it arrives. */
async function confirmationLink(): Promise<URL> {
  const body = await text(await waitForMail(theirMail()));
  const link = body.match(/https:\/\/\S+\/subscription\/optin\/[0-9a-f-]{36}\?\S*/)?.[0];
  expect(link, body).toBeDefined();
  return new URL(link!);
}

async function confirm() {
  optin ??= await confirmationLink();
  const { status } = await postForm(optin.href.split("?")[0]!, {
    confirm: "true",
    l: optin.searchParams.get("l") ?? listId,
  });
  expect(status).toBe(200);
}

Step("a visitor signs up for the newsletter", async () => {
  const { status, location } = await signUp();
  expect(status).toBe(303);
  expect(location).toBe(next);
});
Step("they get an email asking them to confirm", async () => {
  optin = await confirmationLink();
});
Step("they aren't on the newsletter list yet", async () => {
  expect(await subscription()).toBe("unconfirmed");
});

Step("a visitor has signed up for the newsletter", async () => {
  expect((await signUp()).status).toBe(303);
});
Step("they confirm from the email", confirm);
Step("they're on the newsletter list", async () => {
  expect(await subscription()).toBe("confirmed");
});

Step("a bot signs up for the newsletter, filling in the hidden field", async () => {
  expect((await signUp("https://spam.example")).status).not.toBe(303);
});
Step("no confirmation email is sent", async () => {
  expect(await countAfterWait(theirMail())).toBe(0);
});

Step("a subscriber on the newsletter list", async () => {
  expect((await signUp()).status).toBe(303);
  await confirm();
});
// An issue's preferences link names the campaign and the subscriber. Leaving every list there
// doesn't depend on the campaign, so the all-zero ID, which a confirmation email's own link uses, stands in.
Step("they leave the list from the link to their preferences in an issue", async () => {
  const subscriber = optin!.pathname.split("/").at(-1);
  const { status } = await postForm(
    `${await mailUrl()}/subscription/00000000-0000-0000-0000-000000000000/${subscriber}`,
    { manage: "true", name: `Reader ${runId}` },
  );
  expect(status).toBe(200);
});
Step("they're not on the newsletter list", async () => {
  expect(await subscription()).toBe("unsubscribed");
});

describeAccessFeature("newsletter.feature");
