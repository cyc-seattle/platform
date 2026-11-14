// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Fills a link's preview fields from the page it links to, the way a social network shows a card:
// its Open Graph title, description, and picture (docs/access.md). It runs after the save, so a slow
// or broken page never holds up or fails one. Directus fetches the page, not the reader's browser,
// so it refuses anything but a public https address: a link can't make it read inside the cluster.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const dns = require("node:dns");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const https = require("node:https");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const net = require("node:net");

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TITLE_LENGTH = 200;
const DESCRIPTION_LENGTH = 500;

/** Ranges no link should reach: private, loopback, link-local (the metadata server), and the like. */
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
]) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

/** Whether an IP address is one a link may reach. An IPv4-mapped IPv6 address is checked as IPv4. */
function isPublicAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = net.isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** The URL, if it's an https address on the default port a link may name, or undefined. */
function allowedUrl(value, base) {
  let parsed;
  try {
    parsed = new URL(value, base);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || (parsed.port !== "" && parsed.port !== "443")) return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  return parsed;
}

/** Resolves like `dns.lookup`, but refuses a non-public address, so the check and the connection agree. */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const usable = addresses.filter(({ address }) => isPublicAddress(address));
    if (usable.length !== addresses.length || usable.length === 0) {
      return callback(new Error(`${hostname} resolves to an address a link can't reach`));
    }
    if (options.all) return callback(null, usable);
    callback(null, usable[0].address, usable[0].family);
  });
}

/** One GET, without following a redirect: its status, its Location, and up to MAX_BYTES of an HTML body. */
function get(url, signal) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: publicLookup,
        signal,
        headers: { "user-agent": "CSC Sail Team link preview", accept: "text/html" },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          return resolve({ status, location: response.headers.location });
        }
        const type = response.headers["content-type"] ?? "";
        if (status !== 200 || !/^text\/html\b/i.test(type)) {
          response.resume();
          return reject(new Error(`${url} answered ${status} ${type}`));
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BYTES) response.destroy();
        });
        const done = () => resolve({ status, html: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8") });
        response.on("end", done);
        response.on("close", done);
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

/** The page at `url`'s HTML and its final address, following at most MAX_REDIRECTS, within TIMEOUT_MS. */
async function fetchPage(url) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = allowedUrl(url);
  for (let redirects = 0; current !== undefined; redirects++) {
    const response = await get(current, signal);
    if (response.html !== undefined) return { html: response.html, url: current };
    if (redirects === MAX_REDIRECTS || !response.location) break;
    current = allowedUrl(response.location, current);
  }
  throw new Error(`${url} isn't a public https page, or redirects too often`);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function tidy(text, length) {
  if (text === undefined) return null;
  const clean = decode(text).replace(/\s+/g, " ").trim();
  if (clean === "") return null;
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}…` : clean;
}

/** Each `<meta>` tag's attributes, by lower-cased name. */
function metaTags(html) {
  return [...html.matchAll(/<meta\b([^>]*)>/gi)].map(([, attributes]) => {
    const found = {};
    for (const [, name, doubled, single, bare] of attributes.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
    )) {
      found[name.toLowerCase()] = doubled ?? single ?? bare;
    }
    return found;
  });
}

/** A page's preview: its Open Graph tags, or its title and description when it has none. */
function parsePreview(html, pageUrl) {
  const tags = metaTags(html);
  const meta = (key) => tags.find((tag) => (tag.property ?? tag.name ?? "").toLowerCase() === key)?.content;
  const title = meta("og:title") ?? /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const description = meta("og:description") ?? meta("description");
  const image = meta("og:image");
  return {
    preview_title: tidy(title, TITLE_LENGTH),
    preview_description: tidy(description, DESCRIPTION_LENGTH),
    preview_image: image === undefined ? null : (allowedUrl(decode(image).trim(), pageUrl)?.href ?? null),
  };
}

const EMPTY = { preview_title: null, preview_description: null, preview_image: null, previewed_at: null };

/** The preview fields for a link to `url`. Empty, never thrown, when the page can't be read. */
async function preview(url, logger) {
  try {
    const page = await fetchPage(url);
    return { ...parsePreview(page.html, page.url), previewed_at: new Date().toISOString() };
  } catch (error) {
    logger.warn(`link-preview: couldn't read ${url}: ${error.message}`);
    return EMPTY;
  }
}

function register({ action }, { services, database, getSchema, logger }) {
  const refresh = async (keys) => {
    const schema = await getSchema();
    // No accountability: only this hook writes the preview fields, which no person's policy can.
    const links = new services.ItemsService("links", { schema, knex: database });
    for (const key of keys) {
      const link = await links.readOne(key, { fields: ["url"] });
      if (!link?.url) continue;
      await links.updateOne(key, await preview(link.url, logger), { emitEvents: false });
    }
  };
  const run = (keys) => {
    refresh(keys).catch((error) => logger.error(error, "link-preview: couldn't save a preview"));
  };
  action("links.items.create", ({ key }) => run([key]));
  action("links.items.update", ({ keys, payload }) => {
    if (Object.prototype.hasOwnProperty.call(payload, "url")) run(keys);
  });
}

module.exports = register;
module.exports.isPublicAddress = isPublicAddress;
module.exports.allowedUrl = allowedUrl;
module.exports.parsePreview = parsePreview;
