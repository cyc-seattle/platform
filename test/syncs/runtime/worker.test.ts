import { describe, it, expect, vi, afterEach } from "vitest";
import winston from "winston";
import { DirectusClient } from "../../../src/syncs/runtime/client.ts";
import { runQueue, SyncQueue } from "../../../src/syncs/runtime/worker.ts";
import { type SyncTaskRow } from "../../../src/syncs/runtime/sync-tasks.ts";

// This package's tsconfig has no DOM lib, so the ambient `RequestInit` resolves to an empty
// structural type (see client.ts) rather than undici's real one. This local alias covers the
// fields these tests assert on from a captured fetch-mock call.
type FetchInit = { method?: string; body?: unknown };

const baseUrl = "https://directus.example.com";
const token = "test-token";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("SyncQueue.enqueue", () => {
  it("creates a new row when no task with this key exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] })) // lookup by key
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "task-1" }] })); // create
    vi.stubGlobal("fetch", fetchMock);
    const queue = new SyncQueue(new DirectusClient(baseUrl, token));

    await queue.enqueue(
      { queue: "clubspot-sync", kind: "sync_camp", target: "camp-1" },
      new Date("2026-01-15T12:00:00Z"),
    );

    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, FetchInit];
    expect(createUrl).toBe(`${baseUrl}/items/sync_tasks`);
    expect(createInit.method).toBe("POST");
    const [body] = JSON.parse(createInit.body as string) as [Record<string, unknown>];
    expect(body).toMatchObject({
      queue: "clubspot-sync",
      kind: "sync_camp",
      key: "clubspot-sync:sync_camp:camp-1",
      status: "pending",
    });
  });

  it("updates the existing row with this key instead of creating a duplicate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "task-1", key: "camp-1" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: "task-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const queue = new SyncQueue(new DirectusClient(baseUrl, token));

    await queue.enqueue(
      { queue: "clubspot-sync", kind: "sync_camp", target: "camp-1" },
      new Date("2026-01-15T12:00:00Z"),
    );

    const [updateUrl, updateInit] = fetchMock.mock.calls[1] as [string, FetchInit];
    expect(updateUrl).toBe(`${baseUrl}/items/sync_tasks/task-1`);
    expect(updateInit.method).toBe("PATCH");
  });
});

describe("runQueue", () => {
  const dueTask: SyncTaskRow = {
    id: "task-1",
    queue: "clubspot-sync",
    kind: "sync_camp",
    key: "camp-1",
    parent_id: null,
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    run_after: null,
    last_error: null,
    started_at: null,
    finished_at: null,
    needs_attention: false,
  };

  const secondTask: SyncTaskRow = { ...dueTask, id: "task-3", key: "camp-3" };

  function calls(fetchMock: ReturnType<typeof vi.fn>): { method: string; url: URL; body: unknown }[] {
    return (fetchMock.mock.calls as [string, FetchInit][]).map(([url, init]) => ({
      method: init.method ?? "GET",
      url: new URL(url),
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    }));
  }

  it("claims a due task, runs its handler, and marks it done", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] })) // no stale running tasks
      .mockResolvedValueOnce(jsonResponse(200, { data: [dueTask] })) // read claimable
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ ...dueTask, status: "running", attempts: 1 }] })) // claim
      .mockResolvedValueOnce(jsonResponse(200, { data: { ...dueTask, status: "done" } })) // success
      .mockResolvedValueOnce(jsonResponse(200, { data: [] })); // no more claimable tasks
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await runQueue(new DirectusClient(baseUrl, token), "clubspot-sync", { sync_camp: handler });

    expect(result.processed).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
    const [, , claim, success] = calls(fetchMock);
    expect(claim).toMatchObject({
      method: "PATCH",
      body: {
        query: { filter: { id: { _eq: "task-1" }, status: { _eq: "pending" } } },
        data: { status: "running", attempts: 1 },
      },
    });
    expect(claim!.url.pathname).toBe("/items/sync_tasks");
    expect(success).toMatchObject({ method: "PATCH", body: { status: "done" } });
  });

  it("reads only the stale running tasks, then only the claimable ones, once per batch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [dueTask, secondTask] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ ...dueTask, status: "running", attempts: 1 }] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ...dueTask, status: "done" } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ ...secondTask, status: "running", attempts: 1 }] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ...secondTask, status: "done" } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runQueue(
      new DirectusClient(baseUrl, token),
      "clubspot-sync",
      { sync_camp: vi.fn().mockResolvedValue(undefined) },
      () => new Date("2026-01-15T12:00:00Z"),
    );

    expect(result.taskIds).toEqual(["task-1", "task-3"]);
    const reads = calls(fetchMock).filter((call) => call.method === "GET");
    expect(reads).toHaveLength(3);
    expect(Object.fromEntries(reads[0]!.url.searchParams)).toMatchObject({
      "filter[queue][_eq]": "clubspot-sync",
      "filter[status][_eq]": "running",
    });
    expect(Object.fromEntries(reads[1]!.url.searchParams)).toMatchObject({
      "filter[queue][_eq]": "clubspot-sync",
      "filter[status][_eq]": "pending",
      "filter[_or][0][run_after][_null]": "true",
      "filter[_or][1][run_after][_lte]": "2026-01-15T12:00:00.000Z",
    });
  });

  it("skips a task that changed since the batch was read, such as one staff cancelled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [dueTask] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] })) // the claim matched no row
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn();

    const result = await runQueue(new DirectusClient(baseUrl, token), "clubspot-sync", { sync_camp: handler });

    expect(result.processed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("marks a task pending with backoff when its handler throws and attempts remain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [dueTask] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ ...dueTask, status: "running", attempts: 1 }] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ...dueTask, status: "pending" } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn().mockRejectedValue(new Error("clubspot is down"));
    const warnSpy = vi.spyOn(winston, "warn").mockReturnThis();

    await runQueue(new DirectusClient(baseUrl, token), "clubspot-sync", { sync_camp: handler });

    expect(calls(fetchMock)[3]!.body).toMatchObject({ status: "pending", last_error: "clubspot is down" });
    expect(warnSpy).toHaveBeenCalledWith(
      "Sync task failed",
      expect.objectContaining({ queue: "clubspot-sync", key: "camp-1", attempts: 1, error: "clubspot is down" }),
    );

    warnSpy.mockRestore();
  });

  it("throws when a claimable task's kind has no registered handler, without claiming it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [dueTask] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runQueue(new DirectusClient(baseUrl, token), "clubspot-sync", {})).rejects.toThrow(
      /No handler registered for sync_tasks kind "sync_camp"/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resets a task still running at the start of a run back to pending, keeping its attempts, and reports the count", async () => {
    const stuck: SyncTaskRow = { ...dueTask, id: "task-2", status: "running", attempts: 3 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [stuck] })) // read: one stale running task
      .mockResolvedValueOnce(jsonResponse(200, { data: { ...stuck, status: "pending" } })) // sweep
      .mockResolvedValueOnce(jsonResponse(200, { data: [] })); // nothing claimable
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(winston, "warn").mockReturnThis();

    const result = await runQueue(new DirectusClient(baseUrl, token), "clubspot-sync", {});

    expect(result.processed).toBe(0);
    const sweep = calls(fetchMock)[1]!;
    expect(sweep.url.pathname).toBe("/items/sync_tasks/task-2");
    expect(sweep.body).toEqual({ status: "pending", started_at: null });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reset 1 stale "running" sync_tasks back to pending',
      expect.objectContaining({ queue: "clubspot-sync", count: 1 }),
    );

    warnSpy.mockRestore();
  });
});
