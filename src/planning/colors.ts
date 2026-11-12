// Each program's color on a calendar or a chart, so a program looks the same in every app.

/**
 * The colors a program takes when it has none of its own: twelve hues a step apart, alternately darker and lighter so
 * neighbors stay apart, each dark enough for white words on it at 4.5:1 (test/program-colors.test.ts).
 */
export const PROGRAM_PALETTE = [
  "#a12628",
  "#ab5803",
  "#735603",
  "#548108",
  "#046c46",
  "#00837e",
  "#02657c",
  "#0274c7",
  "#4d49b1",
  "#8e51b6",
  "#912b76",
  "#b93f65",
] as const;

/** A 32-bit FNV-1a hash, so the same id picks the same color in every app and every load. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A program's color: its own, when the catalog sets one, or else one of the palette's, picked by its id. */
export function programColor(program: { id: string; color?: string | null }): string {
  return program.color || PROGRAM_PALETTE[hash(program.id) % PROGRAM_PALETTE.length]!;
}
