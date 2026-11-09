import fs from "node:fs";
import * as yaml from "js-yaml";
import winston from "winston";
import { type PersonRow, type SchoolRow } from "../../model/crm/index.ts";
import { type DirectusClient } from "../runtime/index.ts";
import { normalizeName } from "./people.ts";
import { type PersonPatch } from "./promoted-fields.ts";
import { SchoolMatcher } from "./schools.ts";

/**
 * The reviewed list of schools for `--apply-schools` (docs/syncs.md): each school with every old
 * value that means it, and the values that mean no school at all.
 */
export interface SchoolsFile {
  schools: { name: string; aliases?: string[] }[];
  clear?: string[];
}

export function parseSchoolsFile(text: string): SchoolsFile {
  const parsed = yaml.load(text) as Partial<SchoolsFile> | null;
  const schools = parsed?.schools;
  if (!Array.isArray(schools) || schools.some((school) => typeof school?.name !== "string" || !school.name.trim())) {
    throw new Error("A schools file lists `schools`, each with a `name`");
  }
  const strings = (value: unknown, what: string): string[] => {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`${what} must be a list of strings`);
    }
    return value as string[];
  };
  return {
    schools: schools.map((school) => ({
      name: school.name.trim(),
      aliases: strings(school.aliases, `${school.name}'s aliases`),
    })),
    clear: strings(parsed?.clear, "`clear`"),
  };
}

export interface SchoolUpserts {
  create: Omit<SchoolRow, "id">[];
  update: Pick<SchoolRow, "id" | "aliases">[];
}

/**
 * Adds each school in the file that isn't on the list by name, and adds its aliases to one that is.
 * Never removes a school or an alias: staff may have added them since.
 */
export function planSchoolUpserts(file: SchoolsFile, existing: readonly SchoolRow[]): SchoolUpserts {
  const byName = new Map(existing.map((school) => [normalizeName(school.name), school] as const));
  const plan: SchoolUpserts = { create: [], update: [] };
  for (const school of file.schools) {
    const current = byName.get(normalizeName(school.name));
    const aliases = withAliases(current?.aliases ?? [], school.aliases ?? []);
    if (!current) {
      plan.create.push({ name: school.name, aliases });
    } else if (aliases.length > (current.aliases ?? []).length) {
      plan.update.push({ id: current.id, aliases });
    }
  }
  return plan;
}

/** `current` plus each of `added` that doesn't already match one of them. */
function withAliases(current: readonly string[], added: readonly string[]): string[] {
  const seen = new Set(current.map((alias) => normalizeName(alias)));
  const aliases = [...current];
  for (const alias of added) {
    const normalized = normalizeName(alias);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      aliases.push(alias.trim());
    }
  }
  return aliases;
}

export interface SchoolCleanup {
  patches: PersonPatch[];
  /** Each value still in a person's own words, with how many people hold it. */
  leftOver: Map<string, number>;
}

/**
 * Moves each person's school in their own words onto the list where it matches, and clears a value in
 * `clear`. One already on the list is left alone.
 */
export function planSchoolCleanup(
  people: readonly Pick<PersonRow, "id" | "school_id" | "school">[],
  schools: SchoolMatcher,
  clear: readonly string[],
): SchoolCleanup {
  const cleared = new Set(clear.map((value) => normalizeName(value)));
  const cleanup: SchoolCleanup = { patches: [], leftOver: new Map() };
  for (const person of people) {
    const text = person.school?.trim();
    if (!person.id || person.school_id || !text) {
      continue;
    }
    if (cleared.has(normalizeName(text))) {
      cleanup.patches.push({ id: person.id, patch: { school: null } });
      continue;
    }
    const school = schools.match(text);
    if (school) {
      cleanup.patches.push({ id: person.id, patch: { school_id: school.id, school: null } });
    } else {
      cleanup.leftOver.set(text, (cleanup.leftOver.get(text) ?? 0) + 1);
    }
  }
  return cleanup;
}

export interface ApplySchoolsResult {
  schoolsCreated: number;
  schoolsUpdated: number;
  peopleMatched: number;
  peopleCleared: number;
  peopleLeftOver: number;
}

/**
 * `--apply-schools`, run by hand: adds the file's schools and aliases, then matches everyone's school
 * against the list. Safe to run again, as after staff add an alias. A dry run logs the same counts.
 */
export async function applySchools(directus: DirectusClient, path: string): Promise<ApplySchoolsResult> {
  const file = parseSchoolsFile(fs.readFileSync(path, "utf8"));
  const existing = await directus.readItems<SchoolRow>("schools", { limit: -1 });
  const upserts = planSchoolUpserts(file, existing);

  const created = await directus.createItems<Omit<SchoolRow, "id">>("schools", upserts.create);
  if (upserts.update.length > 0) {
    await directus.updateItems<SchoolRow>("schools", upserts.update);
  }
  // A dry run creates nothing, so its new schools match under a stand-in id.
  const createdRows = created.map((row, index) => ({
    ...row,
    id: (row as Partial<SchoolRow>).id ?? `new-school-${index}`,
  }));
  const updatedById = new Map(upserts.update.map((row) => [row.id, row.aliases] as const));
  const schools = new SchoolMatcher([
    ...existing.map((school) => ({ ...school, aliases: updatedById.get(school.id) ?? school.aliases })),
    ...createdRows,
  ]);

  const people = await directus.readItems<PersonRow>("people", {
    limit: -1,
    fields: ["id", "school_id", "school"],
    filter: { _and: [{ school_id: { _null: true } }, { school: { _nnull: true } }] },
  });
  const cleanup = planSchoolCleanup(people, schools, file.clear ?? []);
  if (cleanup.patches.length > 0) {
    await directus.updateItems<PersonRow>(
      "people",
      cleanup.patches.map(({ id, patch }) => ({ id, ...patch })),
    );
  }

  for (const [value, count] of [...cleanup.leftOver].sort((a, b) => b[1] - a[1])) {
    winston.info("Left as the family's own words", { value, count });
  }
  const peopleCleared = cleanup.patches.filter(({ patch }) => patch.school_id === undefined).length;
  return {
    schoolsCreated: upserts.create.length,
    schoolsUpdated: upserts.update.length,
    peopleMatched: cleanup.patches.length - peopleCleared,
    peopleCleared,
    peopleLeftOver: [...cleanup.leftOver.values()].reduce((sum, count) => sum + count, 0),
  };
}
