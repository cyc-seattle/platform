import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { check, compose, limiter, routes, type FormsConfig, type Message } from "../stacks/backend/forms.cjs";

const site = "https://example.org";
const config: FormsConfig = {
  to: "info@example.org",
  allowedOrigins: [site, "https://example.web.app"],
  siteUrl: site,
  perIp: 10,
};
const form = {
  first_name: " Pat ",
  last_name: "Example",
  email: "pat@example.com",
  phone: "206-555-0100",
  message: "Do you still have spots in the July adult class?",
  website: "",
};

/** Posts `body` to the contact route, as a browser on `origin` would, and returns where it was sent. */
function harness(send: (m: Message) => Promise<void> = async () => {}) {
  let handler: ((req: any, res: any) => Promise<void>) | undefined;
  const errors: string[] = [];
  routes({ post: (_path, h) => (handler = h) }, config, send, { error: (_e, m) => errors.push(m) });
  const post = async (body: Record<string, string>, origin = site, ip = "198.51.100.1") => {
    let location = "";
    const req = Object.assign(Readable.from([new URLSearchParams(body).toString()]), {
      ip,
      get: (header: string) => (header === "origin" ? origin : undefined),
    });
    await handler!(req, { redirect: (status: number, url: string) => (location = `${status} ${url}`) });
    return location;
  };
  return { post, errors };
}

describe("checking the contact form", () => {
  it("sends a complete form from the website, trimmed", () => {
    expect(check(form, site, config.allowedOrigins)).toEqual({
      outcome: "send",
      fields: {
        first_name: "Pat",
        last_name: "Example",
        email: "pat@example.com",
        phone: "206-555-0100",
        message: form.message,
      },
    });
  });

  it("drops a form whose hidden field is filled, as a bot fills it", () => {
    expect(check({ ...form, website: "https://spam.example" }, site, config.allowedOrigins)).toEqual({
      outcome: "drop",
    });
  });

  it.each([
    ["from another site", form, "https://spam.example"],
    ["with no origin", form, ""],
    ["with no email", { ...form, email: "" }, site],
    ["with a bad email", { ...form, email: "pat at example" }, site],
    ["with no message", { ...form, message: "  " }, site],
    ["with a message over 5,000 characters", { ...form, message: "x".repeat(5001) }, site],
  ])("refuses a form %s", (_case, body, origin) => {
    expect(check(body, origin, config.allowedOrigins).outcome).toBe("refuse");
  });
});

describe("the email to info@", () => {
  it("comes from the visitor's name, with their address as Reply-To", () => {
    const fields = { first_name: "Pat", last_name: "Example", email: "pat@example.com", phone: "", message: "Hi" };
    expect(compose(fields, "info@example.org")).toEqual({
      to: "info@example.org",
      replyTo: { name: "Pat Example", address: "pat@example.com" },
      subject: "Website message from Pat Example",
      text: "Pat Example\npat@example.com\n\nHi\n\n—\nSent from the Contact Us form on the website. Reply to this email to answer Pat Example.",
    });
  });

  it("names the email address when there's no name, and keeps a name to one line", () => {
    const fields = { first_name: "", last_name: "", email: "pat@example.com", phone: "", message: "Hi" };
    expect(compose(fields, "info@example.org").subject).toBe("Website message from pat@example.com");
    const injected = { ...fields, first_name: "Pat\r\nBcc: everyone@example.com" };
    expect(compose(injected, "info@example.org").replyTo.name).toBe("Pat Bcc: everyone@example.com");
  });
});

describe("limits", () => {
  it("allow so many per key in the window, then allow again once it passes", () => {
    const allow = limiter(3, 1000);
    expect([allow("a", 0), allow("a", 1), allow("a", 2), allow("a", 3)]).toEqual([true, true, true, false]);
    expect(allow("b", 3)).toBe(true);
    expect(allow("a", 1001)).toBe(true);
  });
});

describe("the contact route", () => {
  it("emails a message and sends the visitor to Message sent", async () => {
    const sent: Message[] = [];
    const { post } = harness(async (m) => void sent.push(m));
    expect(await post(form)).toBe(`303 ${site}/contact-us/sent`);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.replyTo.address).toBe("pat@example.com");
  });

  it("returns a visitor to the copy of the site they came from", async () => {
    const { post } = harness();
    expect(await post(form, "https://example.web.app")).toBe("303 https://example.web.app/contact-us/sent");
    expect(await post(form, "https://spam.example")).toBe(`303 ${site}/contact-us/not-sent`);
  });

  it("tells a bot its message was sent, and sends nothing", async () => {
    const sent: Message[] = [];
    const { post } = harness(async (m) => void sent.push(m));
    expect(await post({ ...form, website: "x" })).toBe(`303 ${site}/contact-us/sent`);
    expect(sent).toEqual([]);
  });

  it("sends 3 messages an hour from one address, and refuses the 4th", async () => {
    const sent: Message[] = [];
    const { post } = harness(async (m) => void sent.push(m));
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      expect(await post({ ...form, email: "Pat@Example.com" }, site, ip)).toBe(`303 ${site}/contact-us/sent`);
    }
    expect(await post(form, site, "198.51.100.4")).toBe(`303 ${site}/contact-us/not-sent`);
    expect(sent).toHaveLength(3);
  });

  it("refuses an 11th message an hour from one IP", async () => {
    const { post } = harness();
    for (let i = 0; i < 10; i++) {
      expect(await post({ ...form, email: `pat${i}@example.com` })).toBe(`303 ${site}/contact-us/sent`);
    }
    expect(await post({ ...form, email: "new@example.com" })).toBe(`303 ${site}/contact-us/not-sent`);
  });

  it("sends the visitor to Message not sent when the mail fails, and logs it", async () => {
    const { post, errors } = harness(async () => {
      throw new Error("relay refused");
    });
    expect(await post(form)).toBe(`303 ${site}/contact-us/not-sent`);
    expect(errors).toEqual(["forms: couldn't send a contact form message"]);
  });
});
