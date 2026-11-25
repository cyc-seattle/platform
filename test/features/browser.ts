import { proxyOk } from "./cluster.ts";
import { waitForMail } from "./mail.ts";
import type { LocalTarget } from "./target.ts";

// A browser, as far as signing in to an app on the CI stack needs one: it follows redirects and keeps
// cookies. Directus and Authentik both answer on localhost, and a cookie ignores the port, so one jar
// holds both, as a browser's would.

export class Browser {
  private readonly cookies = new Map<string, string>();

  async request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    const csrf = this.cookies.get("authentik_csrf");
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        ...init.headers,
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        // What Authentik's flow page sends with each call to its executor.
        ...(csrf && { "x-authentik-csrf": csrf }),
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair = ""] = header.split(";");
      const at = pair.indexOf("=");
      const [name, value] = [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
      if (value === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    return response;
  }

  /** Follows `url`'s redirects to the first page that isn't one, or to the first that `stop` picks, unopened. */
  async open(url: string, stop: (url: URL) => boolean = () => false): Promise<URL> {
    for (let hops = 0; hops < 20; hops++) {
      const next = new URL(url);
      if (stop(next)) {
        return next;
      }
      const response = await this.request(url);
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        if (!response.ok) {
          throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
        }
        return next;
      }
      url = new URL(location, url).toString();
    }
    throw new Error(`${url} redirected 20 times.`);
  }

  /** Calls an API as the page would, and returns its JSON. */
  async json(url: string, body?: unknown): Promise<any> {
    const response = await this.request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    // Authentik's executor answers a stage it accepts with a redirect to itself, for the next one.
    const location = response.headers.get("location");
    if (response.status === 302 && location) {
      return this.json(new URL(location, url).toString());
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} answered ${response.status}: ${text}`);
    }
    return JSON.parse(text);
  }
}

/** The stage Authentik's flow page would show next, from what it was opened with. */
function flowExecutor(target: LocalTarget, page: URL): string {
  const slug = /^\/if\/flow\/([^/]+)\/$/.exec(page.pathname)?.[1];
  if (slug === undefined) {
    throw new Error(`Directus's sign-in went to ${page}, not an Authentik flow.`);
  }
  return `${target.authentik.url}/api/v3/flows/executor/${slug}/?query=${encodeURIComponent(page.search.slice(1))}`;
}

function expectStage(challenge: { component?: string }, component: string): void {
  if (challenge.component !== component) {
    throw new Error(`Authentik showed ${JSON.stringify(challenge)}, not ${component}.`);
  }
}

/**
 * Signs `email` in to an app at `appUrl` as a browser would: the app sends it to Directus's sign-in,
 * which sends it to Authentik's, which emails a link. Following the link signs it in to Authentik, which
 * sends it back through Directus to the app. Returns the browser, holding Directus's session cookie, and
 * where it ended up.
 */
export async function signInByEmail(
  target: LocalTarget,
  email: string,
  appUrl: string,
): Promise<{ browser: Browser; landed: URL }> {
  const browser = new Browser();
  const { url, signInProvider } = target.directus;
  const page = await browser.open(`${url}/auth/login/${signInProvider}?redirect=${encodeURIComponent(appUrl)}`);
  const executor = flowExecutor(target, page);
  expectStage(await browser.json(executor), "ak-stage-identification");
  expectStage(
    await browser.json(executor, { component: "ak-stage-identification", uid_field: email }),
    "ak-stage-email",
  );

  const mail = await waitForMail(`to:"${email}"`);
  const html: string = (await proxyOk("mailpit", 8025, "GET", `/api/v1/message/${mail.ID}`)).HTML ?? "";
  const href = /href="([^"]*flow_token[^"]*)"/.exec(html)?.[1];
  if (href === undefined) {
    throw new Error(`The sign-in email to ${email} has no link: ${html}`);
  }
  const link = new URL(href.replaceAll("&amp;", "&"), target.authentik.url);
  const linked = flowExecutor(target, link);
  // The link asks them to confirm before it signs them in, so a mail scanner opening it can't.
  const confirm = await browser.json(linked);
  expectStage(confirm, "ak-stage-consent");
  const done = await browser.json(linked, { component: "ak-stage-consent", token: confirm.token });
  expectStage(done, "xak-flow-redirect");

  const app = new URL(appUrl);
  const landed = await browser.open(
    new URL(done.to, target.authentik.url).toString(),
    (next) => next.origin === app.origin && next.pathname === app.pathname,
  );
  return { browser, landed };
}
