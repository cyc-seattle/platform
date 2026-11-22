import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appJwt, debounced, dispatch, listen } from "../stacks/backend/website-publish.cjs";

const config = {
  collections: ["website_pages", "website_settings"],
  watched: { clubspot_camps: ["id", "registration_closed", "public"] },
  folder: "website-folder",
  repository: "cyc-seattle/csc-website",
  workflow: "publish.yml",
  ref: "main",
  appId: "12345",
};
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

describe("the website-publish hook's App token", () => {
  it("names the App, lasts under GitHub's ten minutes, and is signed with its key", () => {
    const now = Date.UTC(2026, 0, 1);
    const [header, claims, signature] = appJwt("12345", pem, now).split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      iss: "12345",
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
    });
    expect(
      crypto.verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature!, "base64url")),
    ).toBe(true);
  });
});

describe("the website-publish hook's dispatch", () => {
  it("starts the publish workflow with a token narrowed to the repo's workflows", async () => {
    const calls: { url: string; method: string; token: string; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        token: headers["authorization"]!,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      if (String(url).endsWith("/installation")) return Response.json({ id: 77 });
      if (String(url).endsWith("/access_tokens"))
        return Response.json({ token: "installation-token" }, { status: 201 });
      return new Response(null, { status: 204 });
    });
    await dispatch(config, pem, fetchFn);
    expect(calls.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: "https://api.github.com/repos/cyc-seattle/csc-website/installation", method: "GET", body: undefined },
      {
        url: "https://api.github.com/app/installations/77/access_tokens",
        method: "POST",
        body: { repositories: ["csc-website"], permissions: { actions: "write" } },
      },
      {
        url: "https://api.github.com/repos/cyc-seattle/csc-website/actions/workflows/publish.yml/dispatches",
        method: "POST",
        body: { ref: "main" },
      },
    ]);
    expect(calls[2]!.token).toBe("Bearer installation-token");
  });

  it("fails when GitHub refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("no", { status: 404 }));
    await expect(dispatch(config, pem, fetchFn)).rejects.toThrow(
      "GitHub answered 404 to /repos/cyc-seattle/csc-website/installation",
    );
  });
});

describe("the website-publish hook's wait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publishes once, after a burst of edits goes quiet", () => {
    const run = vi.fn();
    const publish = debounced(run, 30_000, 300_000);
    for (let edit = 0; edit < 5; edit++) {
      publish();
      vi.advanceTimersByTime(10_000);
    }
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("publishes during steady editing, and again for the edits after", () => {
    const run = vi.fn();
    const publish = debounced(run, 30_000, 300_000);
    for (let edit = 0; edit < 31; edit++) {
      publish();
      vi.advanceTimersByTime(10_000);
    }
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("the website-publish hook's events", () => {
  type Handler = (...args: unknown[]) => unknown;

  function listening(inFolder: string[] | Error) {
    const handlers = new Map<string, Handler>();
    const on = (event: string, handler: Handler) => handlers.set(event, handler);
    const publish = vi.fn();
    const logger = { error: vi.fn() };
    // Answers as knex does for `database("directus_files").whereIn("id", keys).where({ folder }).first("id")`.
    const database = () => ({
      whereIn: (_column: string, keys: string[]) => ({
        where: () => ({
          first: async () => {
            if (inFolder instanceof Error) throw inFolder;
            const id = keys.find((key) => inFolder.includes(key));
            return id === undefined ? undefined : { id };
          },
        }),
      }),
    });
    listen({ filter: on, action: on }, { database, logger }, config, publish);
    return { handlers, publish, logger };
  }

  it("publishes after any write to a website collection, and to no other", () => {
    const { handlers, publish } = listening([]);
    const items = [...handlers.keys()].filter((event) => event.includes(".items.") && event.startsWith("website_"));
    expect(items.sort()).toEqual(
      ["website_pages", "website_settings"]
        .flatMap((collection) => ["create", "delete", "sort", "update"].map((event) => `${collection}.items.${event}`))
        .sort(),
    );
    handlers.get("website_pages.items.update")!({ keys: ["1"], payload: {} });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("publishes when a row the site reads part of comes or goes, or one of the fields it reads changes", () => {
    const { handlers, publish } = listening([]);
    handlers.get("clubspot_camps.items.update")!({ keys: ["1"], payload: { synced_through: "now", quiet_runs: 2 } });
    expect(publish).not.toHaveBeenCalled();
    handlers.get("clubspot_camps.items.update")!({ keys: ["1"], payload: { public: true } });
    handlers.get("clubspot_camps.items.create")!({ key: "2", payload: {} });
    handlers.get("clubspot_camps.items.delete")!({ keys: ["2"] });
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("publishes for a file uploaded to the Website folder, or over one in it", async () => {
    const { handlers, publish } = listening(["old"]);
    await handlers.get("files.upload")!({ key: "new", payload: { folder: "website-folder" } });
    await handlers.get("files.upload")!({ key: "old", payload: {} });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("publishes when a file in the Website folder changes, moves in, moves out, or is deleted", async () => {
    const { handlers, publish } = listening(["in"]);
    const edited = { title: "A boat" };
    expect(await handlers.get("files.update")!(edited, { keys: ["in"] })).toBe(edited);
    await handlers.get("files.update")!({ folder: "website-folder" }, { keys: ["out"] });
    await handlers.get("files.update")!({ folder: null }, { keys: ["in"] });
    const keys = ["in"];
    expect(await handlers.get("files.delete")!(keys)).toBe(keys);
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("ignores files outside the Website folder", async () => {
    const { handlers, publish } = listening(["in"]);
    await handlers.get("files.upload")!({ key: "out", payload: { folder: "elsewhere" } });
    await handlers.get("files.update")!({ title: "A receipt" }, { keys: ["out"] });
    await handlers.get("files.delete")!(["out"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("lets the write through when it can't check the folder", async () => {
    const { handlers, publish, logger } = listening(new Error("no database"));
    const payload = { title: "A boat" };
    expect(await handlers.get("files.update")!(payload, { keys: ["in"] })).toBe(payload);
    expect(publish).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
