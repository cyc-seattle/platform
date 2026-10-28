import type { SavedVersionsConfig } from "./policies.ts";

export interface Write {
  collection: string;
  event: "create" | "update" | "delete";
  payload: Record<string, unknown> | string[];
  /** The rows an update or delete touches. */
  keys?: string[];
  user?: string | null;
  now: string;
}

export interface Version {
  id: string;
  plan_id: string;
  status: "draft" | "saved";
  platform_version?: string | null;
}

export interface Lookup {
  versionIds(collection: string, keys: string[]): Promise<string[]>;
  versions(ids: string[]): Promise<Version[]>;
  deletesSaved(user: string | null | undefined): Promise<boolean>;
}

/** Throws a 403 for a write that would change a saved version; otherwise the payload to write. */
export function guard(write: Write, config: SavedVersionsConfig, lookup: Lookup): Promise<unknown>;

export const REFUSED: string;
