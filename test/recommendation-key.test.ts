import { describe, it, expect } from "vitest";
import { register, withKey, DUPLICATE } from "../stacks/backend/recommendation-key.cjs";

type Row = { id: string; person_id: string; year: number; season: string; key: string };
type Handler = (payload: Record<string, unknown>, meta: { keys?: string[] }, context: unknown) => Promise<unknown>;

/** Just enough of knex for the hook's two queries: a `where`, an optional `whereNot`, then `first`. */
function fakeDatabase(rows: Row[]) {
  return () => {
    let matches = rows;
    const query = {
      select: () => query,
      where: (match: Partial<Row>) => {
        matches = matches.filter((row) => Object.entries(match).every(([k, v]) => row[k as keyof Row] === v));
        return query;
      },
      whereNot: (match: Partial<Row>) => {
        matches = matches.filter((row) => !Object.entries(match).every(([k, v]) => row[k as keyof Row] === v));
        return query;
      },
      first: async () => matches[0],
    };
    return query;
  };
}

function hooks(rows: Row[]) {
  const handlers: Record<string, Handler> = {};
  register({
    filter: (event, handler) => {
      handlers[event] = handler as Handler;
    },
  });
  const context = { database: fakeDatabase(rows) };
  return {
    create: (payload: Record<string, unknown>) => handlers["recommendations.items.create"]!(payload, {}, context),
    update: (keys: string[], payload: Record<string, unknown>) =>
      handlers["recommendations.items.update"]!(payload, { keys }, context),
  };
}

const fall: Row = { id: "r1", person_id: "p1", year: 2026, season: "fall", key: "p1:2026-fall" };

describe("the recommendation-key hook", () => {
  it("keys a new recommendation by its sailor, year and season", async () => {
    await expect(hooks([]).create({ person_id: "p1", year: 2026, season: "fall", note: "Try J-Pod" })).resolves.toEqual(
      { person_id: "p1", year: 2026, season: "fall", note: "Try J-Pod", key: "p1:2026-fall" },
    );
  });

  it("reads the ID of a sailor given as a row", () => {
    expect(withKey({ person_id: { id: "p1" }, year: 2026, season: "fall" }).key).toBe("p1:2026-fall");
  });

  it("refuses a second recommendation for the same sailor and season", async () => {
    await expect(hooks([fall]).create({ person_id: "p1", year: 2026, season: "fall" })).rejects.toThrow(DUPLICATE);
  });

  it("allows the same season in another year", async () => {
    await expect(hooks([fall]).create({ person_id: "p1", year: 2027, season: "fall" })).resolves.toMatchObject({
      key: "p1:2027-fall",
    });
  });

  it("ignores a key the writer sends", async () => {
    await expect(
      hooks([]).create({ person_id: "p1", year: 2026, season: "fall", key: "other" }),
    ).resolves.toMatchObject({ key: "p1:2026-fall" });
    await expect(hooks([fall]).update(["r1"], { note: "Moved up", key: "other" })).resolves.toEqual({
      note: "Moved up",
    });
  });

  it("leaves a missing sailor, year or season to the required fields", async () => {
    await expect(hooks([]).create({ person_id: "p1", year: 2026 })).resolves.toEqual({ person_id: "p1", year: 2026 });
  });

  it("keys a changed season with the stored sailor and year", async () => {
    await expect(hooks([fall]).update(["r1"], { season: "winter" })).resolves.toEqual({
      season: "winter",
      key: "p1:2026-winter",
    });
  });

  it("lets a recommendation keep its own sailor and season", async () => {
    await expect(hooks([fall]).update(["r1"], { person_id: "p1", season: "fall" })).resolves.toMatchObject({
      key: "p1:2026-fall",
    });
  });

  it("refuses moving a recommendation onto another one's sailor and season", async () => {
    const winter: Row = { id: "r2", person_id: "p1", year: 2026, season: "winter", key: "p1:2026-winter" };
    await expect(hooks([fall, winter]).update(["r1"], { season: "winter" })).rejects.toThrow(DUPLICATE);
  });

  it("refuses changing the sailor or season of many recommendations at once", async () => {
    await expect(hooks([fall]).update(["r1", "r2"], { year: 2027 })).rejects.toThrow(/one recommendation at a time/);
  });

  it("lets a change to many recommendations' notes through", async () => {
    await expect(hooks([fall]).update(["r1", "r2"], { note: "Moved up" })).resolves.toEqual({ note: "Moved up" });
  });
});
