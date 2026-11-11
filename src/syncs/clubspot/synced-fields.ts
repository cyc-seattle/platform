import { type RegistrationRow } from "../../model/clubspot/index.ts";
import { compareByRegistrationRecency } from "./promoted-fields.ts";

/**
 * The one rule every curated CRM field follows (cyc-seattle/isthmia#137): `people` (the participant's own row and
 * every guardian/emergency-contact slot's), `medical_profiles`, and the primary email and phone
 * are all synced the same way. Pure; `person-sync.ts` is the thin, impure executor that resolves
 * `base`/`v` (via {@link resolveBase}, falling back to the person's previous newest linked
 * participant) and writes the result.
 */

export type SyncedFieldValue = string | number | boolean | null;

export type SyncedFieldOutcome<T extends SyncedFieldValue> =
  | { action: "write"; value: T; replacedStaffEdit: boolean }
  | { action: "skip"; reason: "blank" | "unchanged" | "already-set" | "edited-later" };

/**
 * When each side last set one field, for the latest-edit-wins rule (cyc-seattle/platform#157).
 * ISO timestamps.
 */
export interface EditTimes {
  /** When Clubspot's answer `v` was given - see {@link clubspotAnswerTime}. */
  clubspot: string;
  /**
   * When someone other than clubspot-sync set the field's current value in Directus. `undefined`
   * when the sync set it, or Directus's revisions show no one did - see `edit-times.ts`.
   */
  directus: string | undefined;
}

/**
 * `current` is the CRM value on file today; `base` is what Clubspot is known to have sent last
 * time (`undefined` when there's no such value on record - not the same as `null`, which means a
 * mirror exists and is blank; see {@link resolveBase} for how a caller arrives at this); `v` is
 * what Clubspot sends now.
 *
 * - `v` is `null`: never written, for any field - a blank never overrides anything.
 * - A Directus edit set `current` (`times.directus`): the later edit wins (cyc-seattle/isthmia#137).
 *   Clubspot's answer replaces it only if given after it.
 * - Otherwise the value came from Clubspot, so only a changed answer moves it:
 *   - No known base (`base` is `undefined`): fills a null CRM column only, and never counts as
 *     replacing a staff edit - there's no prior form answer to compare against yet.
 *   - `v` equals `base`: no write - Clubspot repeating itself never overrides a staff edit.
 *   - `v` differs from `base`: write `v`. If `current` was neither `base` nor null, a staff edit is
 *     being replaced.
 *
 * Two registrations naming the same guardian can disagree, and neither one's answer time orders
 * them, so the base rule, not time, settles Clubspot against itself.
 */
export function planSyncedField<T extends SyncedFieldValue>(
  current: T | null,
  base: T | null | undefined,
  v: T | null,
  times?: EditTimes,
): SyncedFieldOutcome<T> {
  if (v === null) {
    return { action: "skip", reason: "blank" };
  }
  if (times?.directus !== undefined) {
    if (v === current) {
      return { action: "skip", reason: "unchanged" };
    }
    return Date.parse(times.clubspot) > Date.parse(times.directus)
      ? { action: "write", value: v, replacedStaffEdit: current !== null }
      : { action: "skip", reason: "edited-later" };
  }
  if (base === undefined) {
    return current === null
      ? { action: "write", value: v, replacedStaffEdit: false }
      : { action: "skip", reason: "already-set" };
  }
  if (v === base) {
    return { action: "skip", reason: "unchanged" };
  }
  return { action: "write", value: v, replacedStaffEdit: current !== null && current !== base };
}

/**
 * When Clubspot's answer to one field was given (cyc-seattle/platform#157). A participant's
 * `updatedAt` moves when any of its answers changes, so it dates only an answer that differs from
 * this participant's own last mirrored one. Any other answer - a first mirror, or one unchanged
 * since - is dated by its registration's confirmation.
 */
export function clubspotAnswerTime(
  ownBase: SyncedFieldValue | undefined,
  v: SyncedFieldValue,
  registeredAt: string,
  participantUpdatedAt: string | undefined,
): string {
  return ownBase !== undefined && ownBase !== v && participantUpdatedAt !== undefined
    ? participantUpdatedAt
    : registeredAt;
}

/**
 * Parses a Clubspot Yes/No custom-field answer, case-insensitively. Blank (including
 * whitespace-only) means "not answered", same as every other promoted field - not "no". Anything
 * else - a typo, a different question entirely - is `undefined`: an answer this parser doesn't
 * recognize must never silently become `false`, so the caller counts and logs it instead of
 * treating it as a value.
 */
export function parseYesNo(value: string | null): boolean | null | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  switch (trimmed.toLowerCase()) {
    case "yes":
      return true;
    case "no":
      return false;
    default:
      return undefined;
  }
}

/**
 * Resolves the base one field actually compares against (cyc-seattle/isthmia#137): this participant's own stored
 * mirror value wins whenever it has one at all, including a known blank - the mirror keeps
 * Clubspot's last non-blank answer (see `people.ts`'s `mergeParticipantMirrorFields`), so a blank
 * `own` here means Clubspot has never answered this field, not that a prior answer was lost. Only
 * a participant mirrored for the first time - `own` entirely `undefined` - falls back to the
 * person's previous newest linked participant's own value (`fallback`). With neither, there's no
 * known base at all, so the field falls to {@link planSyncedField}'s fill-null-only rule.
 */
export function resolveBase<T extends SyncedFieldValue>(
  own: T | null | undefined,
  fallback: T | null | undefined,
): T | null | undefined {
  return own !== undefined ? own : fallback;
}

export interface FieldTally {
  written: number;
  replacedStaffEdits: number;
  blankSkipped: number;
  /** Field names only, for the caller to log alongside a person id - never the values themselves. */
  replacedFields: string[];
}

export function emptyFieldTally(): FieldTally {
  return { written: 0, replacedStaffEdits: 0, blankSkipped: 0, replacedFields: [] };
}

export function addFieldTally(a: FieldTally, b: FieldTally): FieldTally {
  return {
    written: a.written + b.written,
    replacedStaffEdits: a.replacedStaffEdits + b.replacedStaffEdits,
    blankSkipped: a.blankSkipped + b.blankSkipped,
    replacedFields: [...a.replacedFields, ...b.replacedFields],
  };
}

export interface SyncedFieldsPlan<Row> extends FieldTally {
  patch: Partial<Row>;
}

/** One row's worth of `base`/`v` values - nullable regardless of whether `Row`'s own column is NOT NULL, since a mirror field starts out unset. */
export type FieldValues<Row> = Partial<Record<keyof Row, SyncedFieldValue>>;

/**
 * The row-level counterpart to {@link resolveBase}: merges a participant's own stored base with
 * the fallback sourced from the person's previous newest linked participant, one field at a time.
 * A field present in neither carries no base at all into {@link planSyncedFields} below, same as
 * passing `undefined` for the whole row.
 *
 * `own` itself, not a per-field access, is what's checked against `undefined` - a whole row missing
 * (this participant's first mirror write) is what falls back; a row that's present but holds a
 * known blank for one field is real information, resolved to `null` by {@link resolveBase} rather
 * than coerced away.
 */
export function resolveFieldBase<Row>(
  own: FieldValues<Row> | undefined,
  fallback: FieldValues<Row> | undefined,
): FieldValues<Row> {
  const ownFields = own as Record<string, SyncedFieldValue> | undefined;
  const fallbackFields = fallback as Record<string, SyncedFieldValue> | undefined;

  const merged: Record<string, SyncedFieldValue> = {};
  for (const field of new Set([...Object.keys(ownFields ?? {}), ...Object.keys(fallbackFields ?? {})])) {
    const ownValue = ownFields ? (ownFields[field] ?? null) : undefined;
    const resolved = resolveBase(ownValue, fallbackFields?.[field] ?? null);
    if (resolved !== undefined) {
      merged[field] = resolved;
    }
  }
  return merged as FieldValues<Row>;
}

/** What dates one registration's answers - see {@link clubspotAnswerTime}. */
export interface AnswerTimes {
  /** The registration's confirmation. */
  registeredAt: string;
  /** The participant's `updatedAt`, when Parse has one. */
  participantUpdatedAt: string | undefined;
}

/** {@link EditTimes} for every field of one row. */
export interface RowEditTimes {
  /** When Clubspot gave each field's answer, by field - see {@link clubspotAnswerTime}. */
  clubspot: Partial<Record<string, string>>;
  /** The answer time for a field missing from `clubspot`: its registration's confirmation. */
  registeredAt: string;
  /** {@link EditTimes.directus}, by field. */
  directus: ReadonlyMap<string, string>;
}

/**
 * {@link RowEditTimes} for one row's fields. `ownBase` is this participant's own last mirrored
 * answers, never the fallback's: another registration's answer says nothing about when this one
 * changed.
 */
export function rowEditTimes<Row>(
  fields: readonly (keyof Row & string)[],
  ownBase: FieldValues<Row> | undefined,
  v: FieldValues<Row>,
  answer: AnswerTimes,
  directus: ReadonlyMap<string, string>,
): RowEditTimes {
  const ownFields = ownBase as Record<string, SyncedFieldValue> | undefined;
  const vFields = v as Record<string, SyncedFieldValue>;
  const clubspot: Partial<Record<string, string>> = {};
  for (const field of fields) {
    clubspot[field] = clubspotAnswerTime(
      ownFields ? (ownFields[field] ?? null) : undefined,
      vFields[field] ?? null,
      answer.registeredAt,
      answer.participantUpdatedAt,
    );
  }
  return { clubspot, registeredAt: answer.registeredAt, directus };
}

/**
 * The fields whose current value Clubspot's answer would replace - the only ones whose Directus
 * edit times are worth reading.
 */
export function fieldsToOverwrite<Row>(
  fields: readonly (keyof Row & string)[],
  current: Partial<Row>,
  v: FieldValues<Row>,
): string[] {
  const currentFields = current as Record<string, SyncedFieldValue>;
  const vFields = v as Record<string, SyncedFieldValue>;
  return fields.filter(
    (field) => (vFields[field] ?? null) !== null && vFields[field] !== (currentFields[field] ?? null),
  );
}

/**
 * Applies {@link planSyncedField} across every curated field of one row - `people` (the
 * participant's own or a guardian/emergency contact's slot) or `medical_profiles`. `Row`'s
 * concrete interfaces have no index signature of their own, same as `schedule.ts`'s `diffFields`,
 * so the cast to a plain record is internal rather than pushed onto every caller. A field absent
 * from `base` - whether `base` itself is `undefined`, or `resolveFieldBase` left the key out -
 * carries no base of its own, same as the whole-row `undefined` case.
 */
export function planSyncedFields<Row extends { id?: string }>(
  fields: readonly (keyof Row & string)[],
  current: Partial<Row>,
  base: FieldValues<Row> | undefined,
  v: FieldValues<Row>,
  times?: RowEditTimes,
): SyncedFieldsPlan<Row> {
  const currentFields = current as Record<string, SyncedFieldValue>;
  const baseFields = base as Record<string, SyncedFieldValue> | undefined;
  const vFields = v as Record<string, SyncedFieldValue>;

  const patch: Partial<Row> = {};
  const tally = emptyFieldTally();

  for (const field of fields) {
    const outcome = planSyncedField(
      currentFields[field] ?? null,
      baseFields === undefined ? undefined : field in baseFields ? (baseFields[field] ?? null) : undefined,
      vFields[field] ?? null,
      times && { clubspot: times.clubspot[field] ?? times.registeredAt, directus: times.directus.get(field) },
    );
    if (outcome.action === "write") {
      patch[field] = outcome.value as Row[typeof field];
      tally.written++;
      if (outcome.replacedStaffEdit) {
        tally.replacedStaffEdits++;
        tally.replacedFields.push(field);
      }
    } else if (outcome.reason === "blank") {
      tally.blankSkipped++;
    }
  }

  return { patch, ...tally };
}

export type RegistrationRank = Pick<RegistrationRow, "id" | "archived" | "registered_at">;

/**
 * True when `self` ranks first among every registration linked to the same person - the
 * newest-linked-participant order `docs/crm-schema.md` documents: non-archived first, then
 * `registered_at` descending, then `id` as a tiebreak. An older participant's form must never
 * overwrite a newer one's, so only this registration's sync is allowed to touch the person's
 * curated fields.
 */
export function isNewestParticipant(self: RegistrationRank, others: readonly RegistrationRank[]): boolean {
  return others.every((other) => compareByRegistrationRecency(self, other) < 0);
}

/** A ranking candidate carrying whatever payload the caller needs once it wins - see {@link bestRanked}. */
export interface Ranked<T> extends RegistrationRank {
  data: T;
}

/**
 * The best-ranked (see {@link isNewestParticipant}) of a list of candidates - the "previous
 * newest linked participant" cyc-seattle/isthmia#137's fallback-base rule draws a field's value from, when the
 * current participant has none of its own. `undefined` with an empty list.
 */
export function bestRanked<T>(candidates: readonly Ranked<T>[]): Ranked<T> | undefined {
  return candidates.reduce<Ranked<T> | undefined>(
    (best, candidate) => (!best || compareByRegistrationRecency(candidate, best) < 0 ? candidate : best),
    undefined,
  );
}
