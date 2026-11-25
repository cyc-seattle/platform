import { setTimeout as sleep } from "node:timers/promises";
import { proxyOk } from "./cluster.ts";
import { devPlatform } from "./support.ts";
import { localTarget } from "./target.ts";

// What the mail features share: Mailpit, which catches every email the stack sends, read on dev through
// the Kubernetes API's service proxy, and the address the website's forms answer at.

export interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  ReplyTo: { Name: string; Address: string }[];
}

/** `https://mail.<dev domain>`, where the website's forms answer on dev, or the CI stack's Directus. */
export async function mailUrl(): Promise<string> {
  return localTarget()?.formsUrl ?? `https://mail.${(await devPlatform()).domain}`;
}

/** The emails Mailpit holds that match a search, such as `to:"pat@example.com"`. */
export async function search(query: string): Promise<Mail[]> {
  const body = await proxyOk("mailpit", 8025, "GET", `/api/v1/search?limit=50&query=${encodeURIComponent(query)}`);
  return body.messages ?? [];
}

/** The first email that matches, once it arrives. */
export async function waitForMail(query: string, timeoutMs = 60_000): Promise<Mail> {
  for (const start = Date.now(); Date.now() - start < timeoutMs; await sleep(2_000)) {
    const [mail] = await search(query);
    if (mail) {
      return mail;
    }
  }
  throw new Error(`No email matching ${query} in ${timeoutMs / 1000} seconds.`);
}

/** How many emails match after a wait long enough for one sent just now to arrive. */
export async function countAfterWait(query: string): Promise<number> {
  await sleep(15_000);
  return (await search(query)).length;
}

/** An email's plain text. */
export async function text(mail: Mail): Promise<string> {
  return (await proxyOk("mailpit", 8025, "GET", `/api/v1/message/${mail.ID}`)).Text ?? "";
}

/** Posts a form as a browser on `origin` would, and returns where it sends the browser next. */
export async function postForm(url: string, form: Record<string, string>, origin?: string) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(origin && { origin }) },
    body: new URLSearchParams(form),
  });
  return { status: response.status, location: response.headers.get("location") ?? "" };
}
