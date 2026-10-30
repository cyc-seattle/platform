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

/** Runs SQL inside the transaction the caller opened. */
export interface Database {
  query(sql: string): Promise<Record<string, unknown>[]>;
  exec(sql: string): Promise<unknown>;
}

/** Throws a 403 for a write that would change a saved version; otherwise the payload to write. */
export function guard(write: Write, config: SavedVersionsConfig, lookup: Lookup): Promise<unknown>;

/** Directus's error for a database error: a trigger's refusal as a 403 or 400, otherwise as it is. */
export function databaseError(error: unknown): unknown;

/** Installs the triggers. Returns the tables that lack a column they need, and then installs none. */
export function installTriggers(config: SavedVersionsConfig, db: Database): Promise<string[]>;

/** The statements that install the triggers. */
export function triggerStatements(config: SavedVersionsConfig): string[];

export const REFUSED: string;
