import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import winston from "winston";
import { DirectusClient } from "../../../src/syncs/runtime/client.ts";
import {
  isExpired,
  LEASE_RENEW_MS,
  LEASE_TTL_MS,
  type SyncLeaseRow,
  withQueueLease,
} from "../../../src/syncs/runtime/lease.ts";

type FetchInit = { method?: string; body?: string };

const baseUrl = "https://directus.example.com";
const now = new Date("2026-01-15T12:00:00Z");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const notUnique = {
  errors: [{ message: 'Value "gsuite-sync" has to be unique.', extensions: { code: "RECORD_NOT_UNIQUE" } }],
};

/** A `sync_leases` table that enforces the unique `queue`, as Postgres does. */
function leaseStore(rows: SyncLeaseRow[] = []) {
  let nextId = 1;
  const fetchMock = vi.fn(async (url: string, init?: FetchInit) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url);
    const id = parsed.pathname.split("/")[3];
    if (method === "GET") {
      const queue = parsed.searchParams.get("filter[queue][_eq]");
      return jsonResponse(200, { data: rows.filter((row) => row.queue === queue) });
    }
    if (method === "POST") {
      const [item] = JSON.parse(init!.body!) as SyncLeaseRow[];
      if (rows.some((row) => row.queue === item!.queue)) {
        return jsonResponse(400, notUnique);
      }
      const created = { id: `lease-${nextId++}`, ...item! };
      rows.push(created);
      return jsonResponse(200, { data: [created] });
    }
    if (method === "PATCH") {
      const { query, data } = JSON.parse(init!.body!) as {
        query: { filter: { id: { _eq: string } } };
        data: Partial<SyncLeaseRow>;
      };
      const row = rows.find((each) => each.id === query.filter.id._eq);
      if (row) Object.assign(row, data);
      return jsonResponse(200, { data: row ? [row] : [] });
    }
    if (method === "DELETE") {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return jsonResponse(403, { errors: [{ message: "Forbidden" }] });
      rows.splice(index, 1);
    }
    return jsonResponse(204, undefined);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, rows };
}

beforeEach(() => {
  vi.spyOn(winston, "warn").mockReturnThis();
  vi.spyOn(winston, "error").mockReturnThis();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isExpired", () => {
  it("is expired once its time has come", () => {
    expect(isExpired({ expires_at: now.toISOString() }, now)).toBe(true);
    expect(isExpired({ expires_at: new Date(now.getTime() + 1).toISOString() }, now)).toBe(false);
  });
});

describe("withQueueLease", () => {
  it("holds each queue's lease while it runs, then releases them", async () => {
    const { rows } = leaseStore();
    const directus = new DirectusClient(baseUrl, "token");

    const outcome = await withQueueLease(
      directus,
      ["gsuite-sync-discovery", "gsuite-sync"],
      async () => rows.map((row) => row.queue),
      () => now,
    );

    expect(outcome).toEqual({ acquired: true, value: ["gsuite-sync-discovery", "gsuite-sync"] });
    expect(rows).toEqual([]);
  });

  it("runs nothing while another run holds the queue, and leaves that run's lease alone", async () => {
    const theirs = { id: "theirs", queue: "gsuite-sync", expires_at: new Date(now.getTime() + 1000).toISOString() };
    const { rows } = leaseStore([{ ...theirs }]);
    const fn = vi.fn();

    const outcome = await withQueueLease(new DirectusClient(baseUrl, "token"), ["gsuite-sync"], fn, () => now);

    expect(outcome).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
    expect(rows).toEqual([theirs]);
  });

  it("releases the queues it took when a later one is held", async () => {
    const theirs = { id: "theirs", queue: "gsuite-sync", expires_at: new Date(now.getTime() + 1000).toISOString() };
    const { rows } = leaseStore([{ ...theirs }]);

    const outcome = await withQueueLease(
      new DirectusClient(baseUrl, "token"),
      ["gsuite-sync-discovery", "gsuite-sync"],
      vi.fn(),
      () => now,
    );

    expect(outcome).toEqual({ acquired: false });
    expect(rows).toEqual([theirs]);
  });

  it("takes over a lease that expired, from a run that died holding it", async () => {
    const { rows } = leaseStore([{ id: "dead", queue: "clubspot-sync", expires_at: now.toISOString() }]);

    const outcome = await withQueueLease(
      new DirectusClient(baseUrl, "token"),
      ["clubspot-sync"],
      async () => [...rows],
      () => now,
    );

    expect(outcome).toEqual({
      acquired: true,
      value: [
        {
          id: "lease-1",
          queue: "clubspot-sync",
          expires_at: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
        },
      ],
    });
  });

  it("treats losing the create race as the queue being held", async () => {
    const { fetchMock } = leaseStore();
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { data: [] }));
    fetchMock.mockImplementationOnce(async () => jsonResponse(400, notUnique));

    const outcome = await withQueueLease(new DirectusClient(baseUrl, "token"), ["clubspot-sync"], vi.fn());

    expect(outcome).toEqual({ acquired: false });
  });

  it("releases the lease when the run throws", async () => {
    const { rows } = leaseStore();

    await expect(
      withQueueLease(new DirectusClient(baseUrl, "token"), ["clubspot-sync"], async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(rows).toEqual([]);
  });

  it("renews the lease while it runs, and aborts the run's signal once another run takes it over", async () => {
    vi.useFakeTimers({ now });
    const { rows } = leaseStore();
    let signal: AbortSignal | undefined;

    await withQueueLease(new DirectusClient(baseUrl, "token"), ["clubspot-sync"], async (given) => {
      signal = given;
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      expect(rows[0]!.expires_at).toBe(new Date(now.getTime() + LEASE_RENEW_MS + LEASE_TTL_MS).toISOString());
      expect(given.aborted).toBe(false);

      rows.splice(0, 1, { id: "theirs", queue: "clubspot-sync", expires_at: rows[0]!.expires_at });
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      expect(given.aborted).toBe(true);
    });

    expect(signal?.reason).toEqual(new Error("Lost the queue's lease to another run"));
    expect(rows.map((row) => row.id)).toEqual(["theirs"]);
  });

  it("writes no lease on a dry run", async () => {
    const { fetchMock } = leaseStore();

    const outcome = await withQueueLease(new DirectusClient(baseUrl, "token", true), ["clubspot-sync"], async () => 1);

    expect(outcome).toEqual({ acquired: true, value: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
