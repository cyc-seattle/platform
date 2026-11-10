// Loads the public website's content and pictures into a Directus, once, by hand (cyc-seattle/platform#150),
// from the proof of concept that copied them from Wix: its src/data/*.json and its pictures. No deploy runs
// it. Each row's ID comes from what the row is, so a second run updates the same rows and adds nothing. It
// puts each row's lists back as the proof of concept has them, so it undoes any edit made since.
//
//   DIRECTUS_URL=https://directus.<domain> DIRECTUS_TOKEN=<an admin's token> mise run load-website -- <proof of concept>
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { WEBSITE_FOLDER } from "../stacks/backend/migrations/cyc0007-website-folder.cjs";

type Row = Record<string, unknown> & { id: string };

/** What the loader asks of Directus. */
export interface WebsiteApi {
  /** The file in the Website folder with this name, if there is one, and its MIME type. */
  findFile(name: string): Promise<{ id: string; type: string | null } | undefined>;
  /** Uploads a file into the Website folder, and returns its ID. */
  uploadFile(name: string, bytes: Uint8Array, type: string): Promise<string>;
  /** Uploads a file's contents again, over the file with this ID. */
  replaceFile(id: string, name: string, bytes: Uint8Array, type: string): Promise<void>;
  /** Adds the row, or changes it to match if a row has its ID. */
  upsert(collection: string, row: Row): Promise<void>;
  /** The IDs of the rows in `collection` whose `field` is `parentId`. */
  childIds(collection: string, field: string, parentId: string): Promise<string[]>;
  remove(collection: string, ids: string[]): Promise<void>;
  /** Sets the one row of a singleton. */
  setSingleton(collection: string, data: Record<string, unknown>): Promise<void>;
}

// The proof of concept's shapes, as its src/lib/content.ts reads them.
interface Action {
  label: string;
  href: string;
}
interface Data {
  settings: {
    name: string;
    description: string;
    email: string;
    phone: string;
    address: string[];
    mapUrl: string;
    ein: string;
    social: { label: string; url: string }[];
    announcement: string | null;
    logo?: string;
    badge?: string;
    menu: { label: string; items: Action[] }[];
    policies: string[];
  };
  categories: {
    slug: string;
    title: string;
    summary: string;
    status: "open" | "closed" | "coming-soon";
    sort: number;
    image?: string;
    banner?: string;
    top: string;
    bottom: string;
    testimonial?: string;
    gallery: string[];
    programs: string[];
    faqs: string[];
    profiles: string[];
  }[];
  programs: {
    slug: string;
    title: string;
    sort: number;
    subtitle: string;
    summary: string;
    cardImage?: string;
    cardButtonLabel: string;
    cardLink?: string;
    banner?: string;
    body: string;
    registrationLabel: string;
    registrationUrl?: string;
    gallery: string[];
  }[];
  faqs: { id: string; heading: string; title: string; body: string }[];
  profiles: { id: string; name: string; title: string; bio: string; photo?: string; groups: string[] }[];
  policies: { slug: string; title: string; versions: { title: string; effective: string; body: string }[] }[];
  sponsorLevels: { id: string; name: string; amount: string; benefits: string }[];
  sponsors: { name: string; url: string; logo?: string; level: string }[];
  pages: {
    slug: string;
    title: string;
    description: string;
    banner?: string;
    image?: string;
    body?: string;
    action?: Action;
    faqs?: string;
    sections?: { title: string; image?: string; body: string; action?: Action }[];
  }[];
}

const FILES = [
  "settings",
  "categories",
  "programs",
  "faqs",
  "profiles",
  "policies",
  "sponsorLevels",
  "sponsors",
  "pages",
];

export function readData(dir: string): Data {
  return Object.fromEntries(
    FILES.map((name) => [name, JSON.parse(fs.readFileSync(path.join(dir, "src/data", `${name}.json`), "utf8"))]),
  ) as unknown as Data;
}

/** A UUID that's always the same for the same `parts`, so a second run finds the rows the first made. */
export function stableId(...parts: string[]): string {
  const hex = createHash("sha256")
    .update(["csc-website", ...parts].join("\0"))
    .digest("hex");
  // Shaped as a version 8 (custom) UUID.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A Wix picture's name in the proof of concept, `e43759_…~mv2.jpg`, as its file is named on disk. */
export const pictureFile = (media: string) => media.replace("~", "_");

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** A picture's MIME type, from its name. Directus stores what the upload says, and serves it. */
export function mimeType(name: string): string {
  const type = MIME_TYPES[path.extname(name).slice(1).toLowerCase()];
  if (type === undefined) {
    throw new Error(`No MIME type for ${name}`);
  }
  return type;
}

/** Every picture the content names. */
export function picturesIn(data: Data): string[] {
  const all = [
    data.settings.logo,
    data.settings.badge,
    ...data.categories.flatMap((c) => [c.image, c.banner, ...c.gallery]),
    ...data.programs.flatMap((p) => [p.cardImage, p.banner, ...p.gallery]),
    ...data.profiles.map((p) => p.photo),
    ...data.sponsors.map((s) => s.logo),
    ...data.pages.flatMap((p) => [p.banner, p.image, ...(p.sections ?? []).map((s) => s.image)]),
  ];
  return [...new Set(all.filter((media): media is string => media !== undefined))].sort();
}

/** "$10,000" in cents. */
export function cents(amount: string): number {
  const dollars = Number(amount.replace(/[$,]/g, ""));
  if (!Number.isFinite(dollars)) {
    throw new Error(`Not an amount: ${amount}`);
  }
  return Math.round(dollars * 100);
}

/** Splits a set of questions, each under its own heading, into one per question. */
export function questions(body: string): { question: string; answer: string }[] {
  return body
    .split(/^#{1,6} /m)
    .slice(1)
    .map((part) => {
      const [question, ...rest] = part.split("\n");
      return { question: question!.trim(), answer: rest.join("\n").trim() };
    });
}

/** A list of rows that link to one parent, as the content has them: those, and no others. */
interface Children {
  collection: string;
  field: string;
  parentId: string;
  rows: Row[];
}

/** Every row to write, in an order where each row's links exist before it. */
export interface Writes {
  rows: [string, Row][];
  children: Children[];
  settings: Record<string, unknown>;
}

/** The rows the content becomes, given each picture's file ID. */
export function plan(data: Data, file: (media: string | undefined) => string | null): Writes {
  const rows: [string, Row][] = [];
  const children: Children[] = [];
  const add = (collection: string, row: Row) => rows.push([collection, row]);
  const list = (collection: string, field: string, parentId: string, made: Row[]) =>
    children.push({ collection, field, parentId, rows: made });
  /** A sorted many-to-many list, through `junction`. */
  const links = (junction: string, from: string, to: string, parentId: string, targets: string[]) =>
    list(
      junction,
      from,
      parentId,
      targets.map((target, sort) => ({
        id: stableId(junction, parentId, target),
        [from]: parentId,
        [to]: target,
        sort,
      })),
    );
  const action = (a: Action | undefined) => ({ action_label: a?.label ?? null, action_url: a?.href ?? null });

  const profileIds = new Set(data.profiles.map((p) => p.id));
  data.profiles.forEach((p, sort) =>
    add("website_profiles", {
      id: p.id,
      name: p.name,
      title: p.title,
      bio: p.bio,
      photo: file(p.photo),
      groups: p.groups,
      sort,
    }),
  );

  for (const topic of data.faqs) {
    add("website_faq_topics", { id: topic.id, title: topic.title, heading: topic.heading });
    list(
      "website_faqs",
      "topic_id",
      topic.id,
      questions(topic.body).map(({ question, answer }, sort) => ({
        id: stableId("website_faqs", topic.id, String(sort)),
        topic_id: topic.id,
        question,
        answer,
        sort,
      })),
    );
  }

  const programId = (slug: string) => stableId("website_programs", slug);
  for (const p of data.programs) {
    const id = programId(p.slug);
    add("website_programs", {
      id,
      slug: p.slug,
      title: p.title,
      status: "published",
      sort: p.sort,
      subtitle: p.subtitle,
      summary: p.summary,
      card_image: file(p.cardImage),
      card_button_label: p.cardButtonLabel,
      card_link: p.cardLink ?? null,
      banner: file(p.banner),
      body: p.body,
      registration_label: p.registrationLabel,
      registration_url: p.registrationUrl ?? null,
    });
    links(
      "website_programs_files",
      "program_id",
      "file_id",
      id,
      p.gallery.map((m) => file(m)!),
    );
  }

  for (const c of data.categories) {
    const id = stableId("website_categories", c.slug);
    add("website_categories", {
      id,
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      status: c.status === "coming-soon" ? "coming_soon" : c.status,
      sort: c.sort,
      image: file(c.image),
      banner: file(c.banner),
      top: c.top,
      bottom: c.bottom,
      testimonial: c.testimonial ?? null,
    });
    links("website_categories_programs", "category_id", "program_id", id, c.programs.map(programId));
    links("website_categories_faq_topics", "category_id", "topic_id", id, c.faqs);
    links(
      "website_categories_profiles",
      "category_id",
      "profile_id",
      id,
      c.profiles.filter((p) => profileIds.has(p)),
    );
    links(
      "website_categories_files",
      "category_id",
      "file_id",
      id,
      c.gallery.map((m) => file(m)!),
    );
  }

  data.policies.forEach((p, i) => {
    const id = stableId("website_policies", p.slug);
    const footer = data.settings.policies.indexOf(p.slug);
    add("website_policies", {
      id,
      slug: p.slug,
      title: p.title,
      in_footer: footer >= 0,
      sort: footer >= 0 ? footer : data.settings.policies.length + i,
    });
    list(
      "website_policy_versions",
      "policy_id",
      id,
      p.versions.map((v) => ({
        id: stableId("website_policy_versions", p.slug, v.effective),
        policy_id: id,
        title: v.title,
        effective: v.effective,
        body: v.body,
      })),
    );
  });

  for (const p of data.pages) {
    const id = stableId("website_pages", p.slug);
    add("website_pages", {
      id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      banner: file(p.banner),
      image: file(p.image),
      body: p.body ?? null,
      ...action(p.action),
    });
    list(
      "website_page_sections",
      "page_id",
      id,
      (p.sections ?? []).map((s, sort) => ({
        id: stableId("website_page_sections", p.slug, String(sort)),
        page_id: id,
        sort,
        title: s.title,
        image: file(s.image),
        body: s.body,
        ...action(s.action),
      })),
    );
    const topics = p.faqs === undefined ? [] : data.faqs.filter((f) => f.heading === p.faqs).map((f) => f.id);
    links("website_pages_faq_topics", "page_id", "topic_id", id, topics);
  }

  data.sponsorLevels.forEach((l, sort) =>
    add("website_sponsor_levels", {
      id: l.id,
      name: l.name,
      amount_cents: cents(l.amount),
      benefits: l.benefits,
      sort,
    }),
  );
  data.sponsors.forEach((s, sort) =>
    add("website_sponsors", {
      id: stableId("website_sponsors", s.name),
      name: s.name,
      url: s.url,
      logo: file(s.logo),
      level_id: s.level,
      sort,
    }),
  );

  const { settings } = data;
  return {
    rows,
    children,
    settings: {
      name: settings.name,
      description: settings.description,
      email: settings.email,
      phone: settings.phone,
      address: settings.address.join("\n"),
      map_url: settings.mapUrl,
      ein: settings.ein,
      social: settings.social,
      announcement: settings.announcement,
      logo: file(settings.logo),
      badge: file(settings.badge),
      menu: settings.menu.map(({ label, items }) => ({ label, items })),
    },
  };
}

/** Finds a picture in the proof of concept, where the site keeps it. */
function picturePath(dir: string, media: string): string {
  for (const folder of ["src/assets/media", "public/media"]) {
    const candidate = path.join(dir, folder, pictureFile(media));
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No picture ${pictureFile(media)} in ${dir}`);
}

/** Loads the proof of concept in `dir` into Directus. */
export async function load(api: WebsiteApi, data: Data, readPicture: (media: string) => Uint8Array): Promise<void> {
  const fileIds = new Map<string, string>();
  for (const media of picturesIn(data)) {
    const name = pictureFile(media);
    const type = mimeType(name);
    const found = await api.findFile(name);
    if (found === undefined) {
      fileIds.set(media, await api.uploadFile(name, readPicture(media), type));
      continue;
    }
    // An earlier run uploaded it with no type. Uploading again makes Directus read its size too.
    if (!found.type || found.type === "application/octet-stream") {
      await api.replaceFile(found.id, name, readPicture(media), type);
    }
    fileIds.set(media, found.id);
  }
  const writes = plan(data, (media) => (media === undefined ? null : fileIds.get(media)!));
  for (const [collection, row] of writes.rows) {
    await api.upsert(collection, row);
  }
  for (const { collection, field, parentId, rows } of writes.children) {
    for (const row of rows) {
      await api.upsert(collection, row);
    }
    const keep = new Set(rows.map((row) => row.id));
    await api.remove(
      collection,
      (await api.childIds(collection, field, parentId)).filter((id) => !keep.has(id)),
    );
  }
  await api.setSingleton("website_settings", writes.settings);
}

/** The loader's calls, over Directus's REST API. */
export function directusApi(baseUrl: string, token: string): WebsiteApi {
  const call = async (method: string, route: string, body?: unknown): Promise<{ status: number; data: any }> => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text).data : undefined };
  };
  const ok = async (method: string, route: string, body?: unknown) => {
    const { status, data } = await call(method, route, body);
    if (status >= 300) {
      throw new Error(`${method} ${route}: ${status}`);
    }
    return data;
  };
  const send = async (method: string, route: string, name: string, bytes: Uint8Array, type: string) => {
    const form = new FormData();
    // Directus reads the fields before the file.
    form.append("folder", WEBSITE_FOLDER);
    form.append("file", new Blob([bytes], { type }), name);
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    if (response.status >= 300) {
      throw new Error(`upload ${name}: ${response.status} ${await response.text()}`);
    }
    return ((await response.json()) as { data: { id: string } }).data;
  };
  const query = (filter: object, fields = "id") =>
    `?fields=${fields}&limit=-1&filter=${encodeURIComponent(JSON.stringify(filter))}`;
  return {
    async findFile(name) {
      const found = await ok(
        "GET",
        `/files${query({ folder: { _eq: WEBSITE_FOLDER }, filename_download: { _eq: name } }, "id,type")}`,
      );
      return found[0];
    },
    async uploadFile(name, bytes, type) {
      return (await send("POST", "/files", name, bytes, type)).id;
    },
    async replaceFile(id, name, bytes, type) {
      await send("PATCH", `/files/${id}`, name, bytes, type);
    },
    async upsert(collection, row) {
      const { id, ...rest } = row;
      const existing = await call("GET", `/items/${collection}/${id}?fields=id`);
      if (existing.status === 200 && existing.data) {
        await ok("PATCH", `/items/${collection}/${id}`, rest);
      } else {
        await ok("POST", `/items/${collection}`, row);
      }
    },
    async childIds(collection, field, parentId) {
      return (await ok("GET", `/items/${collection}${query({ [field]: { _eq: parentId } })}`)).map(
        (row: Row) => row.id,
      );
    },
    async remove(collection, ids) {
      if (ids.length > 0) {
        await ok("DELETE", `/items/${collection}`, ids);
      }
    },
    async setSingleton(collection, data) {
      await ok("PATCH", `/items/${collection}`, data);
    },
  };
}

async function main(): Promise<void> {
  const [dir] = process.argv.slice(2);
  const baseUrl = process.env["DIRECTUS_URL"];
  const token = process.env["DIRECTUS_TOKEN"];
  if (!dir || !baseUrl || !token) {
    throw new Error("Usage: DIRECTUS_URL=… DIRECTUS_TOKEN=… mise run load-website -- <proof of concept>");
  }
  const data = readData(dir);
  console.log(
    `Loading ${data.pages.length} pages, ${data.categories.length} categories, ${data.programs.length} programs, ` +
      `${picturesIn(data).length} pictures and the rest into ${baseUrl}. It replaces what's there with the proof of concept's.`,
  );
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Type ${new URL(baseUrl).host} to go ahead: `);
  prompt.close();
  if (answer.trim() !== new URL(baseUrl).host) {
    throw new Error("Nothing loaded.");
  }
  await load(directusApi(baseUrl.replace(/\/$/, ""), token), data, (media) => fs.readFileSync(picturePath(dir, media)));
  console.log("Loaded.");
}

if (import.meta.main) {
  await main();
}
