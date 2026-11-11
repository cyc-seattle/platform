/** `payload` with `key` set from its sailor and term, over `current`, the stored row an update changes. */
export function withKey<T extends Record<string, unknown>>(
  payload: T,
  current?: { person_id?: unknown; term_id?: unknown },
): Omit<T, "key"> & { key?: string };
export function recommendationKey(personId: string, termId: string): string;
export const DUPLICATE: string;
/** Registers the hook's filters with Directus. */
export function register(hooks: { filter: (event: string, handler: (...args: never[]) => unknown) => void }): void;
