import winston from "winston";
import { type DirectusClient } from "./client.ts";

/** Row shape for the `sync_leases` collection: the one worker draining a queue. See `schemas/sync.yaml`. */
export interface SyncLeaseRow {
  id?: string;
  /** Unique, so the database lets only one worker create a queue's lease. */
  queue: string;
  expires_at: string;
}

export const LEASE_TTL_MS = 5 * 60 * 1000;
export const LEASE_RENEW_MS = 60 * 1000;

/** The row a worker creates to take `queue`'s lease. */
export function planLease(queue: string, now: Date): SyncLeaseRow {
  return { queue, expires_at: new Date(now.getTime() + LEASE_TTL_MS).toISOString() };
}

export function isExpired(lease: Pick<SyncLeaseRow, "expires_at">, now: Date): boolean {
  return new Date(lease.expires_at).getTime() <= now.getTime();
}

/** Whether a create failed on a unique field, such as another worker's lease on the same queue. */
export function isNotUnique(error: unknown): boolean {
  return error instanceof Error && error.message.includes('"RECORD_NOT_UNIQUE"');
}

export type LeaseOutcome<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Takes the lease on each of `queues`, runs `fn` while renewing them, and releases them after. Only
 * one worker at a time holds a queue's lease, so `runQueue` can treat every `running` task it
 * finds as one a dead worker left behind. If another worker holds one, this runs nothing.
 *
 * `fn`'s signal aborts once a renewal finds the lease gone, after which the worker must stop
 * claiming: another worker may have taken the queue.
 */
export async function withQueueLease<T>(
  directus: DirectusClient,
  queues: readonly string[],
  fn: (signal: AbortSignal) => Promise<T>,
  now: () => Date = () => new Date(),
): Promise<LeaseOutcome<T>> {
  // A dry run writes nothing, so it can't take a lease, and nothing it does needs one.
  if (directus.isDryRun) {
    return { acquired: true, value: await fn(new AbortController().signal) };
  }

  const held: SyncLeaseRow[] = [];
  try {
    for (const queue of queues) {
      const lease = await takeLease(directus, queue, now());
      if (!lease) {
        winston.warn("Another run holds this sync's queue, so this run skipped it", { queue });
        return { acquired: false };
      }
      held.push(lease);
    }

    const lost = new AbortController();
    const timer = setInterval(() => {
      void renewLeases(directus, held, now()).then((ok) => {
        if (!ok && !lost.signal.aborted) {
          winston.error("This run lost its lease on the queue, so it stops claiming tasks", {
            queues: held.map((lease) => lease.queue),
          });
          lost.abort(new Error("Lost the queue's lease to another run"));
        }
      });
    }, LEASE_RENEW_MS);
    try {
      return { acquired: true, value: await fn(lost.signal) };
    } finally {
      clearInterval(timer);
    }
  } finally {
    for (const lease of held) {
      await releaseLease(directus, lease);
    }
  }
}

/** Creates `queue`'s lease, first deleting one that has expired. Returns nothing if another worker
 * holds it. The delete targets the expired row's id, so it can't remove a lease taken since. */
async function takeLease(directus: DirectusClient, queue: string, now: Date): Promise<SyncLeaseRow | undefined> {
  const [existing] = await directus.readItems<SyncLeaseRow>("sync_leases", { filter: { queue: { _eq: queue } } });
  if (existing?.id) {
    if (!isExpired(existing, now)) {
      return undefined;
    }
    winston.warn("Took over an expired lease, from a run that stopped without releasing it", { queue });
    // Another worker taking it over at the same moment may delete it first. The create settles which of us holds it.
    await directus.deleteItem("sync_leases", existing.id).catch(() => undefined);
  }
  try {
    const [created] = await directus.createItems<SyncLeaseRow>("sync_leases", [planLease(queue, now)]);
    if (!created?.id) {
      throw new Error("Directus did not return the created sync_leases row");
    }
    return created;
  } catch (error) {
    if (isNotUnique(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Pushes each lease's expiry out. False once one is gone, after another worker took it over: that
 * worker's lease is a new row, with a new id. A failed request isn't a lost lease: the next renewal
 * tries again, well before it expires. */
async function renewLeases(directus: DirectusClient, leases: readonly SyncLeaseRow[], now: Date): Promise<boolean> {
  try {
    for (const lease of leases) {
      const [renewed] = await directus.updateItemsByQuery<SyncLeaseRow>(
        "sync_leases",
        { id: { _eq: lease.id as string } },
        { expires_at: planLease(lease.queue, now).expires_at },
      );
      if (!renewed) {
        return false;
      }
    }
    return true;
  } catch (error) {
    winston.warn("Renewing the queue's lease failed", { error: error instanceof Error ? error.message : error });
    return true;
  }
}

/** Deletes the lease, so the next run needn't wait for it to expire. If that fails, it expires anyway. */
async function releaseLease(directus: DirectusClient, lease: SyncLeaseRow): Promise<void> {
  try {
    await directus.deleteItem("sync_leases", lease.id as string);
  } catch (error) {
    winston.warn("Releasing the queue's lease failed, so it holds the queue until it expires", {
      queue: lease.queue,
      error: error instanceof Error ? error.message : error,
    });
  }
}
