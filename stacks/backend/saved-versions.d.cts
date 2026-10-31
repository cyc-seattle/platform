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

export interface Plan {
  id: string;
  kind: "program_area" | "operations";
  program_area_id: string | null;
}

export interface Lookup {
  plans(ids: string[]): Promise<Plan[]>;
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

/**
 * Installs the triggers, unless the same ones are on every table. `missing` lists the tables that
 * lack a column they need, and then it installs none.
 */
export function installTriggers(
  config: SavedVersionsConfig,
  db: Database,
): Promise<{ missing: string[]; installed: boolean }>;

export interface UniqueIndex {
  name: string;
  kind: "program_area" | "operations";
  columns: string[];
  /** How Directus names the index's columns in its error. */
  field: string;
}

/** The unique indexes on `plans`. */
export const INDEXES: UniqueIndex[];

/** Makes the index unless it exists, and returns whether it did. Throws naming the plans that clash. */
export function installIndex(index: UniqueIndex, db: Database): Promise<boolean>;

export interface TriggerStatus {
  /** The installed triggers' {@link fingerprint}, or null when there are none. */
  fingerprint: string | null;
  /** Whether each table has its trigger. */
  tables: Record<string, boolean>;
  /** Whether each of {@link INDEXES} exists. */
  indexes: Record<string, boolean>;
}

/** What the hook's `/saved-versions/status` endpoint answers. */
export function triggerStatus(config: SavedVersionsConfig, db: Database): Promise<TriggerStatus>;

/** A hash of the triggers `config` installs. */
export function fingerprint(config: SavedVersionsConfig): string;

/** The statements that install the triggers. */
export function triggerStatements(config: SavedVersionsConfig): string[];

export const REFUSED: string;
