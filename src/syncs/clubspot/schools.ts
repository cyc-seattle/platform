import winston from "winston";
import { type PersonRow, type SchoolRow } from "../../model/crm/index.ts";
import { normalizeName } from "./people.ts";

/** A person's school: one on the list, or their own words ("Other"), never both. */
export type SchoolFields = Required<Pick<PersonRow, "school_id" | "school">>;

/**
 * Matches a school as families wrote it to a `schools` row by its name or one of its aliases, after
 * {@link normalizeName} folds case and punctuation and collapses runs of spaces. No fuzzy matching: a near miss stays the
 * family's own words until staff add it as an alias.
 */
export class SchoolMatcher {
  private readonly byName = new Map<string, SchoolRow>();

  constructor(schools: readonly SchoolRow[]) {
    const ambiguous = new Set<string>();
    for (const school of schools) {
      for (const name of [school.name, ...(school.aliases ?? [])]) {
        const normalized = normalizeName(name);
        if (!normalized || ambiguous.has(normalized)) {
          continue;
        }
        const other = this.byName.get(normalized);
        if (other && other.id !== school.id) {
          // Picking either would quietly file families under the wrong school.
          winston.warn(`"${name}" names two schools, ${other.name} and ${school.name}; matching neither`, {
            name,
          });
          this.byName.delete(normalized);
          ambiguous.add(normalized);
          continue;
        }
        this.byName.set(normalized, school);
      }
    }
  }

  match(text: string | null | undefined): SchoolRow | undefined {
    const normalized = normalizeName(text);
    return normalized ? this.byName.get(normalized) : undefined;
  }

  /** The fields to write for `text`. Null for a blank, which never overwrites anything. */
  fieldsFor(text: string | null | undefined): SchoolFields | null {
    const trimmed = text?.trim();
    if (!trimmed) {
      return null;
    }
    const school = this.match(trimmed);
    return school ? { school_id: school.id, school: null } : { school_id: null, school: trimmed };
  }

  /**
   * One string standing for a school value, so the field rule can compare a person's current pick
   * with what Clubspot sent: two answers naming the same school compare equal.
   */
  keyFor(text: string | null | undefined): string | null {
    const fields = this.fieldsFor(text);
    return fields ? keyOf(fields) : null;
  }
}

/** The key {@link SchoolMatcher.keyFor} gives, for a person's stored fields. */
export function keyOf(fields: Partial<SchoolFields>): string | null {
  if (fields.school_id) {
    return `school:${fields.school_id}`;
  }
  const trimmed = fields.school?.trim();
  return trimmed ? `other:${trimmed}` : null;
}
