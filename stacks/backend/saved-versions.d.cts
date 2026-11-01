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

export interface TriggerStatus {
  /** The installed triggers' {@link fingerprint}, or null when there are none. */
  fingerprint: string | null;
  /** Whether each table has its trigger. */
  tables: Record<string, boolean>;
}

/** What the hook's `/saved-versions/status` endpoint answers. */
export function triggerStatus(config: SavedVersionsConfig, db: Database): Promise<TriggerStatus>;

/** A hash of the triggers `config` installs. */
export function fingerprint(config: SavedVersionsConfig): string;

/** The statements that install the triggers. */
export function triggerStatements(config: SavedVersionsConfig): string[];

/** The engine's `computePlan`, as the hook loads it. */
export interface Engine {
  computePlan(data: unknown): unknown;
}

/**
 * Works out a saved version's results with the engine and writes them, unless it already has them.
 * `db` is Directus's knex. Returns whether it wrote them.
 */
export function writeResults(
  config: SavedVersionsConfig,
  db: unknown,
  versionId: string,
  engine: Engine,
): Promise<boolean>;

export const REFUSED: string;
export const RESULTS_BY_SAVE: string;
