/** The seasons an offering can run in. An offering with none, such as Adult Learn to Sail, has no season. */
export const SEASONS = ["winter", "spring", "summer", "fall"] as const;

export type Season = (typeof SEASONS)[number];

/** An offering's season, or null for none. A saved plan's offering can still hold free text, which is none. */
export function seasonOf(offering: { season_term: string | null }): Season | null {
  return (SEASONS as readonly string[]).includes(offering.season_term ?? "") ? (offering.season_term as Season) : null;
}
