import winston from "winston";
import { type DirectusClient } from "./client.ts";
import {
  claimableFilter,
  claimTaskFilter,
  type EnqueueInput,
  planCancel,
  planClaim,
  planEnqueue,
  planFailure,
  planSuccess,
  planSweep,
  staleRunningFilter,
  taskKey,
} from "./queue.ts";
import { type SyncTaskRow } from "./sync-tasks.ts";

/** Does one task's work. Enqueuing child tasks (via `parent_id`) is the handler's job, not the
 * worker's - the worker has no notion that a task tree exists. */
export type SyncTaskHandler = (task: SyncTaskRow) => Promise<void>;

/** Thrown by a handler when a precondition the seeder guaranteed at enqueue time is gone by the
 * time the task is claimed - e.g. a class had its `google_group_id` cleared. Retrying can never
 * succeed, so `runQueue` retires the task as `cancelled` instead of treating this as a failure. */
export class TaskOrphaned extends Error {}

/**
 * Thin executor over `DirectusClient` and the pure decisions in `queue.ts`. Holds no decision
 * logic of its own - see `planClaim` for why claiming needs no lease.
 */
export class SyncQueue {
  private readonly directus: DirectusClient;

  constructor(directus: DirectusClient) {
    this.directus = directus;
  }

  /** Creates a task, or resets an existing one with the same `key` back to pending. This is what
   * makes a re-enqueue update in place instead of piling up a duplicate row. */
  async enqueue(input: EnqueueInput, now = new Date()): Promise<SyncTaskRow> {
    const [existing] = await this.directus.readItems<SyncTaskRow>("sync_tasks", {
      filter: { key: { _eq: taskKey(input) } },
    });
    const row = planEnqueue(input, existing, now);
    if (existing?.id) {
      return this.directus.updateItem<SyncTaskRow>("sync_tasks", existing.id, row);
    }
    const [created] = await this.directus.createItems<SyncTaskRow>("sync_tasks", [row as SyncTaskRow]);
    if (!created) {
      throw new Error("Directus did not return the created sync_tasks row");
    }
    return created;
  }
}

/**
 * Claims and runs every due task in `queue`, one at a time, until none remain. It reads the due tasks
 * in batches: a handler may enqueue children mid-run, and the next batch picks them up. So a run
 * reads the queue once per level of the task tree, not once per task (cyc-seattle/platform#81).
 */
export async function runQueue(
  directus: DirectusClient,
  queue: string,
  handlers: Readonly<Record<string, SyncTaskHandler>>,
  now: () => Date = () => new Date(),
): Promise<{ processed: number; taskIds: string[] }> {
  // A `running` row this early can only be one a prior run's worker crashed on - see
  // `staleRunningTasks`.
  const stale = await directus.readItems<SyncTaskRow>("sync_tasks", { filter: staleRunningFilter(queue), limit: -1 });
  for (const task of stale) {
    if (task.id) {
      await directus.updateItem<SyncTaskRow>("sync_tasks", task.id, planSweep());
    }
  }
  if (stale.length > 0) {
    winston.warn(`Reset ${stale.length} stale "running" sync_tasks back to pending`, { queue, count: stale.length });
  }

  const taskIds: string[] = [];
  for (;;) {
    const batch = await directus.readItems<SyncTaskRow>("sync_tasks", {
      filter: claimableFilter(queue, now()),
      limit: -1,
    });
    if (batch.length === 0) {
      return { processed: taskIds.length, taskIds };
    }
    for (const task of batch) {
      if (!task.id) {
        continue;
      }
      const handler = handlers[task.kind];
      if (!handler) {
        throw new Error(`No handler registered for sync_tasks kind "${task.kind}" in queue "${queue}"`);
      }

      const [claimed] = await directus.updateItemsByQuery<SyncTaskRow>(
        "sync_tasks",
        claimTaskFilter(task.id),
        planClaim(task, now()),
      );
      if (!claimed) {
        continue;
      }
      try {
        await handler(claimed);
        await directus.updateItem<SyncTaskRow>("sync_tasks", task.id, planSuccess(now()));
      } catch (error) {
        if (error instanceof TaskOrphaned) {
          await directus.updateItem<SyncTaskRow>("sync_tasks", task.id, planCancel(error.message, now()));
        } else {
          const message = error instanceof Error ? error.message : String(error);
          // A later success clears `last_error`, so the log is the only lasting record of a failure.
          winston.warn("Sync task failed", { queue, key: task.key, attempts: claimed.attempts, error: message });
          await directus.updateItem<SyncTaskRow>("sync_tasks", task.id, planFailure(claimed, message, now()));
        }
      }
      taskIds.push(task.id);
    }
  }
}
