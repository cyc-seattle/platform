import { describe, it, expect } from "vitest";
import { register, withKey, DUPLICATE } from "../stacks/backend/recommendation-key.cjs";

type Row = { id: string; person_id: string; term_id: string; key: string };
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

const stored: Row = { id: "r1", person_id: "p1", term_id: "t1", key: "p1:t1" };

describe("the recommendation-key hook", () => {
  it("keys a new recommendation by its sailor and term", async () => {
    await expect(hooks([]).create({ person_id: "p1", term_id: "t1", note: "Try J-Pod" })).resolves.toEqual({
      person_id: "p1",
      term_id: "t1",
      note: "Try J-Pod",
      key: "p1:t1",
    });
  });

  it("reads the IDs of a sailor or term given as a row", () => {
    expect(withKey({ person_id: { id: "p1" }, term_id: { id: "t1" } }).key).toBe("p1:t1");
  });

  it("refuses a second recommendation for the same sailor and term", async () => {
    await expect(hooks([stored]).create({ person_id: "p1", term_id: "t1" })).rejects.toThrow(DUPLICATE);
  });

  it("ignores a key the writer sends", async () => {
    await expect(hooks([]).create({ person_id: "p1", term_id: "t1", key: "other" })).resolves.toMatchObject({
      key: "p1:t1",
    });
    await expect(hooks([stored]).update(["r1"], { note: "Moved up", key: "other" })).resolves.toEqual({
      note: "Moved up",
    });
  });

  it("leaves a missing sailor or term to the required fields", async () => {
    await expect(hooks([]).create({ person_id: "p1" })).resolves.toEqual({ person_id: "p1" });
  });

  it("keys a changed term with the stored sailor", async () => {
    await expect(hooks([stored]).update(["r1"], { term_id: "t2" })).resolves.toEqual({
      term_id: "t2",
      key: "p1:t2",
    });
  });

  it("lets a recommendation keep its own sailor and term", async () => {
    await expect(hooks([stored]).update(["r1"], { person_id: "p1", term_id: "t1" })).resolves.toMatchObject({
      key: "p1:t1",
    });
  });

  it("refuses moving a recommendation onto another one's sailor and term", async () => {
    const other: Row = { id: "r2", person_id: "p1", term_id: "t2", key: "p1:t2" };
    await expect(hooks([stored, other]).update(["r1"], { term_id: "t2" })).rejects.toThrow(DUPLICATE);
  });

  it("refuses changing the sailor or term of many recommendations at once", async () => {
    await expect(hooks([stored]).update(["r1", "r2"], { term_id: "t2" })).rejects.toThrow(
      /one recommendation at a time/,
    );
  });

  it("lets a change to many recommendations' notes through", async () => {
    await expect(hooks([stored]).update(["r1", "r2"], { note: "Moved up" })).resolves.toEqual({ note: "Moved up" });
  });
});
