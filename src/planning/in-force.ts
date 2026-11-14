/** A Financial Plan, as far as which one is in force: the date it's active from, if it's active. */
export interface Activatable {
  effective_from: string | null;
}

/**
 * The plan in force on `on` (`YYYY-MM-DD`): of one organization's year's Financial Plans, the one with
 * the latest date on or before it. None before the first one's date.
 */
export function planInForce<T extends Activatable>(sets: readonly T[], on: string): T | undefined {
  let inForce: T | undefined;
  for (const set of sets) {
    if (set.effective_from === null || set.effective_from > on) continue;
    if (inForce === undefined || set.effective_from > inForce.effective_from!) inForce = set;
  }
  return inForce;
}
