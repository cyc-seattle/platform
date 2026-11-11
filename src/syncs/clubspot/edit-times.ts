import { type DirectusClient } from "../runtime/index.ts";

/** The part of a `directus_revisions` row, with its activity, that dates an edit. */
export interface FieldRevision {
  id: number;
  delta: Record<string, unknown> | null;
  activity: { user: string | null; timestamp: string } | null;
}

/**
 * When someone other than clubspot-sync set each field's current value, from one item's revisions.
 * A field whose latest revision is the sync's own is left out: its value came from Clubspot, even
 * if staff edited it before that.
 */
export function directusEditTimes(revisions: readonly FieldRevision[], syncUserId: string): Map<string, string> {
  const latest = new Map<string, FieldRevision>();
  for (const revision of [...revisions].sort((a, b) => a.id - b.id)) {
    for (const field of Object.keys(revision.delta ?? {})) {
      latest.set(field, revision);
    }
  }
  const times = new Map<string, string>();
  for (const [field, revision] of latest) {
    if (revision.activity && revision.activity.user !== syncUserId) {
      times.set(field, revision.activity.timestamp);
    }
  }
  return times;
}

/**
 * Reads Directus edit times for the latest-edit-wins rule (cyc-seattle/platform#157), from
 * Directus's own revisions. An edit made outside the API, or a pruned revision, isn't seen.
 */
export class EditTimeReader {
  private readonly directus: DirectusClient;
  private syncUserId: Promise<string> | undefined;

  constructor(directus: DirectusClient) {
    this.directus = directus;
  }

  /** Reads nothing when `fields` is empty: only an item the sync is about to overwrite is read. */
  async forItem(collection: string, itemId: string, fields: readonly string[]): Promise<Map<string, string>> {
    if (fields.length === 0) {
      return new Map();
    }
    const revisions = await this.directus.readItems<FieldRevision>("directus_revisions", {
      filter: { collection: { _eq: collection }, item: { _eq: itemId } },
      fields: ["id", "delta", "activity.user", "activity.timestamp"],
      limit: -1,
    });
    if (revisions.length === 0) {
      return new Map();
    }
    return directusEditTimes(revisions, await this.syncUser());
  }

  private syncUser(): Promise<string> {
    this.syncUserId ??= this.directus
      .readItems<{ id: string }>("directus_users", {
        filter: { id: { _eq: "$CURRENT_USER" } },
        fields: ["id"],
        limit: 1,
      })
      .then(([me]) => {
        if (!me) {
          throw new Error(
            "clubspot-sync can't read its own Directus user, so it can't tell its own edits from staff's",
          );
        }
        return me.id;
      });
    return this.syncUserId;
  }
}
