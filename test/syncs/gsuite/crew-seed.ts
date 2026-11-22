type Seed = Partial<Record<string, Record<string, unknown>[]>>;

/**
 * A test seed's `program_terms`, each a person's term for a program (`person_id`, `program_id`,
 * `starts_on`, `ends_on`), as Crew holds them: a `crew_terms` row through a `crew_members` row.
 */
export function withCrew(seed: Seed): Seed {
  const { program_terms: terms = [], ...rest } = seed;
  return {
    ...rest,
    crew_terms: [
      ...(rest["crew_terms"] ?? []),
      ...terms.map(({ person_id, program_id, starts_on = null, ends_on = null }) => ({
        crew_member_id: `crew-${String(person_id)}`,
        program_id,
        starts_on,
        ends_on,
      })),
    ],
    crew_members: [
      ...(rest["crew_members"] ?? []),
      ...[...new Set(terms.map((term) => String(term["person_id"])))].map((id) => ({
        id: `crew-${id}`,
        person_id: id,
      })),
    ],
  };
}
