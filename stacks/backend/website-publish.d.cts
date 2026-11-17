import type { WebsitePublishConfig } from "./policies.ts";

/** The token a GitHub App proves itself with: its ID, signed with its private key. */
export function appJwt(appId: string, privateKey: string, now?: number): string;
/** Runs `run` once calls have stopped for `quietMs`, or `maxWaitMs` after the first, whichever is sooner. */
export function debounced(run: () => void, quietMs: number, maxWaitMs: number): () => void;
/** Starts the publish workflow, as the App's installation on the repo. */
export function dispatch(config: WebsitePublishConfig, privateKey: string, fetchFn?: typeof fetch): Promise<void>;
/** Calls `publish` after each write to the website's content. */
export function listen(
  events: {
    filter(event: string, handler: (...args: unknown[]) => unknown): void;
    action(event: string, handler: (...args: unknown[]) => unknown): void;
  },
  context: { database: unknown; logger: { error(error: unknown, message: string): void } },
  config: WebsitePublishConfig,
  publish: () => void,
): void;
