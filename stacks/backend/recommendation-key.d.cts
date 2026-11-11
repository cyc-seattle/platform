/** `payload` with `key` set from its sailor, year and season, over `current`, the stored row an update changes. */
export function withKey<T extends Record<string, unknown>>(
  payload: T,
  current?: { person_id?: unknown; year?: unknown; season?: unknown },
): Omit<T, "key"> & { key?: string };
export function recommendationKey(personId: string, year: number, season: string): string;
export const DUPLICATE: string;
/** Registers the hook's filters with Directus. */
export function register(hooks: { filter: (event: string, handler: (...args: never[]) => unknown) => void }): void;
