import { describe, expect, it } from "vitest";
import { PROGRAM_PALETTE, programColor } from "../src/planning/index.ts";

const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

/** WCAG relative luminance. */
const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** OKLab, where a distance is how different two colors look. */
const oklab = (hex: string) => {
  const [r, g, b] = linear(hex);
  const [l, m, s] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt) as [number, number, number];
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

describe("the program palette", () => {
  it.each(PROGRAM_PALETTE)("puts white words on %s at 4.5:1 or more", (color) => {
    expect(1.05 / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every color clearly apart from the others", () => {
    for (const [i, x] of PROGRAM_PALETTE.entries()) {
      for (const y of PROGRAM_PALETTE.slice(i + 1)) {
        const [a, b] = [oklab(x), oklab(y)];
        expect(Math.hypot(...a.map((v, k) => v - b[k]!)), `${x} and ${y}`).toBeGreaterThan(0.09);
      }
    }
  });
});

describe("programColor", () => {
  it("is the program's own color, when it has one", () => {
    expect(programColor({ id: "a", color: "#123456" })).toBe("#123456");
  });

  it("is the same palette color for the same program, every time", () => {
    const id = "6dce0756-dbae-552b-a868-1fa0dcff9b5a";
    expect(PROGRAM_PALETTE).toContain(programColor({ id, color: null }));
    expect(programColor({ id })).toBe(programColor({ id, color: null }));
  });

  it("spreads programs over the palette", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(new Set(ids.map((id) => programColor({ id }))).size).toBe(PROGRAM_PALETTE.length);
  });
});
