// A Directus endpoint extension, mounted into Directus as-is: CommonJS, with no imports but Node's,
// since an extension's folder has no node_modules of its own.
//
// The website's contact form (cyc-seattle/csc-website#9), at /forms/contact. It emails info@ with the
// visitor as Reply-To, and keeps nothing: its limits live in this pod's memory, and are gone after an
// hour or a restart. The form is plain HTML, so each answer is a redirect to a page on the site.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const querystring = require("node:querystring");

const HOUR_MS = 60 * 60 * 1000;
const PER_ADDRESS = 3;
const PER_IP = 10;
const MAX_BODY = 64 * 1024;
const MAX_LENGTH = { first_name: 100, last_name: 100, email: 254, phone: 40, message: 5000 };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Allows `limit` calls per key in any `windowMs`. */
function limiter(limit, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    // Forgets quiet keys now and then, so a flood of addresses can't grow the map for good.
    if (hits.size > 10_000) {
      for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    hits.set(key, [...recent, now]);
    return true;
  };
}

/** One line of a header, so a name can't add a header of its own. */
const oneLine = (value) => value.replace(/[\r\n]+/g, " ").trim();

/**
 * What to do with a submitted form: `drop` a bot's (it filled the hidden field), `refuse` one that's
 * incomplete, too long, or from another site, or `send` its trimmed fields.
 */
function check(form, origin, allowedOrigins) {
  if (!allowedOrigins.includes(origin)) return { outcome: "refuse", reason: "origin" };
  if (String(form.website ?? "").trim() !== "") return { outcome: "drop" };
  const fields = {};
  for (const [name, max] of Object.entries(MAX_LENGTH)) {
    const value = String(form[name] ?? "").trim();
    if (value.length > max) return { outcome: "refuse", reason: `${name} too long` };
    fields[name] = value;
  }
  if (!EMAIL.test(fields.email)) return { outcome: "refuse", reason: "email" };
  if (fields.message === "") return { outcome: "refuse", reason: "message" };
  return { outcome: "send", fields };
}

/** The email info@ gets. */
function compose(fields, to) {
  const name = oneLine([fields.first_name, fields.last_name].filter(Boolean).join(" ")) || fields.email;
  const email = oneLine(fields.email);
  return {
    to,
    replyTo: { name, address: email },
    subject: `Website message from ${name}`,
    text: [
      name,
      email,
      ...(fields.phone ? [oneLine(fields.phone)] : []),
      "",
      fields.message,
      "",
      "—",
      `Sent from the Contact Us form on the website. Reply to this email to answer ${name}.`,
    ].join("\n"),
  };
}

/** The form's fields, whether Directus parsed the body or left it. */
async function readForm(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) return req.body;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) return {};
  }
  return querystring.parse(body);
}

/** The router for `config`: `{ to, allowedOrigins, siteUrl }`. `send` sends one email. */
function routes(router, config, send, logger) {
  const byAddress = limiter(PER_ADDRESS, HOUR_MS);
  const byIp = limiter(PER_IP, HOUR_MS);

  router.post("/contact", async (req, res) => {
    const origin = req.get("origin") ?? "";
    // Back to the site the form was on, so a test copy of the site gets its own pages.
    const site = config.allowedOrigins.includes(origin) ? origin : config.siteUrl;
    const done = (page) => res.redirect(303, `${site}/contact-us/${page}`);

    const result = check(await readForm(req), origin, config.allowedOrigins);
    if (result.outcome === "drop") return done("sent");
    if (!byIp(req.ip ?? "")) return done("not-sent");
    if (result.outcome === "refuse") return done("not-sent");
    if (!byAddress(result.fields.email.toLowerCase())) return done("not-sent");
    try {
      await send(compose(result.fields, config.to));
      return done("sent");
    } catch (error) {
      logger.error(error, "forms: couldn't send a contact form message");
      return done("not-sent");
    }
  });
}

module.exports = {
  id: "forms",
  handler: (router, { services, getSchema, env, logger }) => {
    // Written beside this file by `backend`, from its stack config.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
    const config = require("./config.json");
    const send = async (message) => {
      const mail = new services.MailService({ schema: await getSchema() });
      await mail.send({ ...message, from: { name: "CSC website", address: String(env["EMAIL_FROM"]) } });
    };
    routes(router, config, send, logger);
  },
};
module.exports.limiter = limiter;
module.exports.check = check;
module.exports.compose = compose;
module.exports.routes = routes;
