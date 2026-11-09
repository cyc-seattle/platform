import { describe, it, expect } from "vitest";
import { planPhoneNormalization } from "../../../src/syncs/clubspot/normalize-phones.ts";

describe("planPhoneNormalization", () => {
  it("rewrites bare digits into E.164, and leaves alone one already in it or one that won't parse", () => {
    expect(
      planPhoneNormalization([
        { id: "p1", phone: "2065550100" },
        { id: "p2", phone: "(206) 555-0101" },
        { id: "p3", phone: "+12065550102" },
        { id: "p4", phone: "call my mom" },
        { id: "p5", phone: null },
      ]),
    ).toEqual({
      updates: [
        { id: "p1", phone: "+12065550100" },
        { id: "p2", phone: "+12065550101" },
      ],
      unparsed: ["p4"],
    });
  });
});
