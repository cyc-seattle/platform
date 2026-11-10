import { describe, expect, it } from "vitest";
import { cents, load, picturesIn, plan, questions, stableId, type WebsiteApi } from "../scripts/load-website.ts";

// The by-hand load of the website's proof of concept, against a Directus held in memory.

const data = {
  settings: {
    name: "CYC Community Sailing Center",
    description: "Small boat sailing.",
    email: "info@example.org",
    phone: "206-555-0100",
    address: ["7755 Seaview Ave NW", "Seattle, WA 98117"],
    mapUrl: "https://maps.example.com",
    ein: "00-0000000",
    social: [{ label: "Instagram", url: "https://instagram.example.com" }],
    announcement: null,
    logo: "a_logo~mv2.png",
    menu: [{ label: "About Us", items: [{ label: "Contact Us", href: "/contact-us" }] }],
    policies: ["sick-policy"],
  },
  categories: [
    {
      slug: "summer-camp",
      title: "Summer Sailing Camps",
      summary: "Week-long camps.",
      status: "coming-soon" as const,
      sort: 0,
      banner: "a_banner~mv2.jpg",
      top: "Ages 6 to 16",
      bottom: "",
      gallery: ["a_photo~mv2.jpg", "a_banner~mv2.jpg"],
      programs: ["guppy"],
      faqs: ["00000000-0000-4000-8000-0000000000f1"],
      profiles: ["00000000-0000-4000-8000-0000000000c1", "gone"],
    },
  ],
  programs: [
    {
      slug: "guppy",
      title: "Guppy Sailing",
      sort: 0,
      subtitle: "Ages 6-8",
      summary: "First sails.",
      cardButtonLabel: "Register Now",
      body: "## Guppies",
      registrationLabel: "Register Now",
      registrationUrl: "https://clubspot.example.com",
      gallery: [],
    },
  ],
  faqs: [
    {
      id: "00000000-0000-4000-8000-0000000000f1",
      heading: "Registration Questions",
      title: "Registration Questions",
      body: "##### Do I need an account?\n\nYes.\n\n##### Can I get a refund?\n\nSee the policy.",
    },
  ],
  profiles: [
    {
      id: "00000000-0000-4000-8000-0000000000c1",
      name: "Jack",
      title: "Sailing Director",
      bio: "Coaches.",
      photo: "a_photo~mv2.jpg",
      groups: ["staff"],
    },
  ],
  policies: [
    {
      slug: "sick-policy",
      title: "Sick Policy",
      versions: [{ title: "v1", effective: "2025-01-16", body: "Stay home." }],
    },
    { slug: "open-boating-rules", title: "Open Boating Rules", versions: [] },
  ],
  sponsorLevels: [
    { id: "00000000-0000-4000-8000-0000000000a1", name: "Admiral", amount: "$10,000", benefits: "A boat" },
  ],
  sponsors: [
    { name: "Springline", url: "https://springline.example.com", level: "00000000-0000-4000-8000-0000000000a1" },
  ],
  pages: [
    {
      slug: "donate",
      title: "Donate",
      description: "Give.",
      faqs: "Registration Questions",
      sections: [{ title: "Online", body: "Give online.", action: { label: "Donate", href: "/donate" } }],
    },
  ],
};

/** Directus, in memory. */
function fakeDirectus() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => tables.get(name) ?? tables.set(name, new Map()).get(name)!;
  const files = new Map<string, string>();
  const counts = { uploads: 0, creates: 0, removes: 0 };
  let settings: Record<string, unknown> = {};
  const api: WebsiteApi = {
    findFile: async (name) => files.get(name),
    uploadFile: async (name) => {
      counts.uploads++;
      files.set(name, `file-${name}`);
      return `file-${name}`;
    },
    upsert: async (collection, row) => {
      if (!table(collection).has(row.id)) counts.creates++;
      table(collection).set(row.id, { ...table(collection).get(row.id), ...row });
    },
    childIds: async (collection, field, parentId) =>
      [...table(collection).values()].filter((row) => row[field] === parentId).map((row) => String(row["id"])),
    remove: async (collection, ids) => {
      for (const id of ids) {
        counts.removes++;
        table(collection).delete(id);
      }
    },
    setSingleton: async (_, next) => {
      settings = { ...settings, ...next };
    },
  };
  const snapshot = () =>
    JSON.stringify({ tables: [...tables].map(([name, rows]) => [name, [...rows]]), settings, files: [...files] });
  return { api, table, counts, snapshot, settings: () => settings };
}

const readPicture = () => new Uint8Array([1]);

describe("loading the website's proof of concept", () => {
  it("uploads each picture once, however many places show it", async () => {
    const directus = fakeDirectus();
    await load(directus.api, data, readPicture);
    expect(picturesIn(data)).toEqual(["a_banner~mv2.jpg", "a_logo~mv2.png", "a_photo~mv2.jpg"]);
    expect(directus.counts.uploads).toBe(3);
  });

  it("changes nothing when run again", async () => {
    const directus = fakeDirectus();
    await load(directus.api, data, readPicture);
    const first = directus.snapshot();
    const { creates } = directus.counts;
    await load(directus.api, data, readPicture);
    expect(directus.snapshot()).toBe(first);
    expect(directus.counts).toMatchObject({ uploads: 3, creates, removes: 0 });
  });

  it("puts a list back as the proof of concept has it", async () => {
    const directus = fakeDirectus();
    await load(directus.api, data, readPicture);
    const category = stableId("website_categories", "summer-camp");
    await directus.api.upsert("website_categories_programs", { id: "added", category_id: category, program_id: "x" });
    await load(directus.api, data, readPicture);
    expect([...directus.table("website_categories_programs").keys()]).not.toContain("added");
  });

  it("links each picture by its file", async () => {
    const directus = fakeDirectus();
    await load(directus.api, data, readPicture);
    const category = directus.table("website_categories").get(stableId("website_categories", "summer-camp"))!;
    expect(category).toMatchObject({ banner: "file-a_banner_mv2.jpg", status: "coming_soon" });
    const gallery = [...directus.table("website_categories_files").values()].sort(
      (a, b) => Number(a["sort"]) - Number(b["sort"]),
    );
    expect(gallery.map((row) => row["file_id"])).toEqual(["file-a_photo_mv2.jpg", "file-a_banner_mv2.jpg"]);
    expect(directus.settings()).toMatchObject({
      logo: "file-a_logo_mv2.png",
      badge: null,
      address: "7755 Seaview Ave NW\nSeattle, WA 98117",
    });
  });
});

describe("plan", () => {
  const writes = plan(data, (media) => (media === undefined ? null : `file-${media}`));
  const rows = (collection: string) => writes.rows.filter(([c]) => c === collection).map(([, row]) => row);
  const children = (collection: string) =>
    writes.children.filter((c) => c.collection === collection).flatMap((c) => c.rows);

  it("splits a set of questions into one row per question, in order", () => {
    expect(children("website_faqs").map((row) => [row["question"], row["answer"], row["sort"]])).toEqual([
      ["Do I need an account?", "Yes.", 0],
      ["Can I get a refund?", "See the policy.", 1],
    ]);
  });

  it("puts the footer's policies first, in the footer's order", () => {
    expect(rows("website_policies").map((row) => [row["slug"], row["in_footer"], row["sort"]])).toEqual([
      ["sick-policy", true, 0],
      ["open-boating-rules", false, 2],
    ]);
  });

  it("links a page to the questions under its heading", () => {
    expect(children("website_pages_faq_topics").map((row) => row["topic_id"])).toEqual([data.faqs[0]!.id]);
    expect(children("website_page_sections")[0]).toMatchObject({ action_label: "Donate", action_url: "/donate" });
  });

  it("leaves out crew the proof of concept doesn't have", () => {
    expect(children("website_categories_profiles").map((row) => row["profile_id"])).toEqual([data.profiles[0]!.id]);
  });

  it("stores a sponsorship level's amount in cents", () => {
    expect(rows("website_sponsor_levels")[0]).toMatchObject({ amount_cents: 1_000_000 });
    expect(cents("$250")).toBe(25_000);
  });

  it("gives a row the same ID every time", () => {
    expect(stableId("website_pages", "donate")).toBe(stableId("website_pages", "donate"));
    expect(stableId("website_pages", "donate")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stableId("website_pages", "donate")).not.toBe(stableId("website_pages", "home"));
  });

  it("reads a question's heading at any level", () => {
    expect(questions("## One\nA\n### Two\nB")).toEqual([
      { question: "One", answer: "A" },
      { question: "Two", answer: "B" },
    ]);
  });
});
