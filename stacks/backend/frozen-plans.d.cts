import type { FrozenPlansConfig } from "./policies.ts";

export interface Write {
  collection: string;
  event: "create" | "update" | "delete";
  payload: Record<string, unknown> | string[];
  /** The rows an update or delete touches. */
  keys?: string[];
  user?: string | null;
  now: string;
}

export interface Plan {
  id: string;
  financial_plan_id: string;
  kind: "program_area" | "operations";
  program_area_id: string | null;
}

export interface FinancialPlan {
  id: string;
  status: "draft" | "frozen";
  /** When it was archived, or none. */
  archived_at?: string | null;
}

export interface Lookup {
  planIds(collection: string, keys: string[]): Promise<string[]>;
  plans(ids: string[]): Promise<Plan[]>;
  sets(ids: string[]): Promise<FinancialPlan[]>;
  deletesFrozen(user: string | null | undefined): Promise<boolean>;
}

/** Runs SQL inside the transaction the caller opened. */
export interface Database {
  query(sql: string): Promise<Record<string, unknown>[]>;
  exec(sql: string): Promise<unknown>;
}

/** Throws a 403 for a write that would change a frozen Financial Plan; otherwise the payload to write. */
export function guard(write: Write, config: FrozenPlansConfig, lookup: Lookup): Promise<unknown>;

/** Directus's error for a database error: a trigger's refusal as a 403 or 400, otherwise as it is. */
export function databaseError(error: unknown): unknown;

/**
 * Installs the triggers, unless the same ones are on every table. `missing` lists the tables that
 * lack a column they need, and then it installs none.
 */
export function installTriggers(
  config: FrozenPlansConfig,
  db: Database,
): Promise<{ missing: string[]; installed: boolean }>;

/**
 * Adds the roles and levels the staff levels migration (cyc0018) listed, and points each row it
 * listed at its level, once the schema apply has added them. Returns the drafts it changed.
 */
export function seedStaffLevels(db: Database): Promise<string[]>;

export interface TriggerStatus {
  /** The installed triggers' {@link fingerprint}, or null when there are none. */
  fingerprint: string | null;
  /** Whether each table has its trigger. */
  tables: Record<string, boolean>;
}

/** What the hook's `/frozen-plans/status` endpoint answers. */
export function triggerStatus(config: FrozenPlansConfig, db: Database): Promise<TriggerStatus>;

/** A hash of the triggers `config` installs. */
export function fingerprint(config: FrozenPlansConfig): string;

/** The statements that install the triggers. */
export function triggerStatements(config: FrozenPlansConfig): string[];

/** The engine's `computePlan`, as the hook loads it. */
export interface Engine {
  computePlan(data: unknown): unknown;
}

export const REFUSED: string;
export const RESULTS_BY_HOOK: string;
export const SET_STAYS: string;
export const PLANS_FIXED: string;
export const PLAN_STAYS: string;
export const NEEDS_OPERATIONS: string;
export const ONE_PER_AREA: string;
export const ONE_PER_DATE: string;
export const IN_FORCE_NOT_ARCHIVED: string;
export const ARCHIVED_NOT_ACTIVE: string;
export const ACTIVE_STAYS: string;
export const BONUS_IN_OPERATIONS: string;
export const SHORT_NOTES: string;

/**
 * Copies a new Financial Plan's parent into it: a draft copy of each plan, with every row and its
 * key. `db` is Directus's knex. Returns whether it copied anything.
 */
export function copyParent(config: FrozenPlansConfig, db: unknown, setId: string): Promise<boolean>;

/** The plans' row tables, each after every table it links to. */
export function copyOrder(config: FrozenPlansConfig): string[];

/**
 * Works out a frozen Financial Plan's results with the engine, from the plans it holds, and writes
 * them, unless it already has them. `db` is Directus's knex. Returns whether it wrote them.
 */
export function writeSetResults(
  config: FrozenPlansConfig,
  db: unknown,
  setId: string,
  engine: Engine,
): Promise<boolean>;

/**
 * Works out a draft Financial Plan's results again, in place of the ones it has, and returns whether
 * it wrote them. If the engine fails, it clears them and throws. `db` is Directus's knex.
 */
export function writeDraftResults(
  config: FrozenPlansConfig,
  db: unknown,
  setId: string,
  engine: Engine,
): Promise<boolean>;

/**
 * Works out a draft's results again now, for a user who `mayEdit` it. Answers with an HTTP status:
 * 403 if they may not, 409 if it isn't a draft, and 200 once they're written.
 */
export function workOutAgain(
  config: FrozenPlansConfig,
  db: unknown,
  setId: string,
  engine: Engine,
  mayEdit: (setId: string) => Promise<boolean>,
): Promise<200 | 403 | 409>;

/** The draft Financial Plans whose results a write to these rows of `collection` changes. */
export function draftsChangedBy(
  config: FrozenPlansConfig,
  db: unknown,
  collection: string,
  keys: string[],
): Promise<string[]>;

/**
 * Runs `run` once for each Financial Plan marked, after writes to it stop for `delayMs`, or
 * `maxWaitMs` after the first, one at a time.
 */
export function draftQueue(
  run: (id: string) => Promise<unknown>,
  delayMs: number,
  maxWaitMs: number,
): { mark(ids: string[]): void };
