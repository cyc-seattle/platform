import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSchemaTypes, loadSchemaTypes, typeName, type Snapshot } from "../src/directus/schema-types.ts";

const root = resolve(import.meta.dirname, "..");

const field = (collection: string, name: string, type: string, extra: object = {}) => ({
  collection,
  field: name,
  type,
  schema: { is_nullable: true, is_primary_key: false },
  ...extra,
});
const pk = (collection: string, type = "uuid") =>
  field(collection, "id", type, { schema: { is_nullable: false, is_primary_key: true } });

const snapshot: Snapshot = {
  collections: [
    { collection: "Teams", meta: { note: "A folder." } },
    { collection: "boats", meta: { note: "A boat the club owns." }, schema: {} },
    { collection: "boat_crew", schema: {} },
    { collection: "settings", meta: { singleton: true }, schema: {} },
  ],
  fields: [
    pk("boats"),
    field("boats", "name", "string", { schema: { is_nullable: false }, meta: { note: "Painted on the stern." } }),
    field("boats", "kind", "string", {
      schema: { is_nullable: false },
      meta: { options: { choices: [{ value: "dinghy" }, { value: "keelboat" }] } },
    }),
    field("boats", "color", "string", { meta: { options: { choices: [{ value: "red" }], allowOther: true } } }),
    field("boats", "length", "decimal"),
    field("boats", "seats", "integer"),
    field("boats", "in_service", "boolean"),
    field("boats", "tags", "json", { meta: { interface: "tags" } }),
    field("boats", "extra", "json"),
    field("boats", "crew", "alias", { schema: null }),
    field("boats", "divider", "alias", { schema: null }),
    field("boats", "owner", "uuid"),
    pk("boat_crew", "integer"),
    field("boat_crew", "boat_id", "uuid", { schema: { is_nullable: false } }),
    pk("settings", "integer"),
  ],
  relations: [
    {
      collection: "boat_crew",
      field: "boat_id",
      related_collection: "boats",
      meta: { one_collection: "boats", one_field: "crew" },
    },
    {
      collection: "boats",
      field: "owner",
      related_collection: "directus_users",
      meta: { one_collection: "directus_users" },
    },
  ],
};

const source = generateSchemaTypes(snapshot);
const body = (name: string) => source.slice(source.indexOf(`export interface ${name} {`)).split("\n}\n")[0]!;

describe("typeName", () => {
  it.each([
    ["plan_versions", "PlanVersions"],
    ["people", "People"],
    ["clubspot_custom_field_definitions", "ClubspotCustomFieldDefinitions"],
  ])("names %s %s", (collection, name) => {
    expect(typeName(collection)).toBe(name);
  });
});

describe("generateSchemaTypes", () => {
  it("lists every table-backed collection in Schema, a singleton as one item, and no folder", () => {
    expect(body("Schema")).toContain("boats: Boats[];");
    expect(body("Schema")).toContain("boat_crew: BoatCrew[];");
    expect(body("Schema")).toContain("settings: Settings;");
    expect(source).not.toContain("Teams");
  });

  it("types each scalar as Directus returns it", () => {
    const boats = body("Boats");
    expect(boats).toContain("  id: string;");
    expect(boats).toContain("  name: string;");
    expect(boats).toContain("  length: string | null;");
    expect(boats).toContain("  seats: number | null;");
    expect(boats).toContain("  in_service: boolean | null;");
    expect(boats).toContain("  tags: string[] | null;");
    expect(boats).toContain("  extra: unknown;");
  });

  it("types a field with fixed choices as their union, unless it allows others", () => {
    expect(body("Boats")).toContain('  kind: "dinghy" | "keelboat";');
    expect(body("Boats")).toContain("  color: string | null;");
  });

  it("types a many-to-one as the related key or item", () => {
    expect(body("BoatCrew")).toContain("  boat_id: string | Boats;");
  });

  it("types a relation to a collection outside the snapshot by its key", () => {
    expect(body("Boats")).toContain("  owner: string | null;");
  });

  it("types a one-to-many as a list of the related keys or items, and leaves out other aliases", () => {
    expect(body("Boats")).toContain("  crew: (number | BoatCrew)[];");
    expect(body("Boats")).not.toContain("divider");
  });

  it("carries the collection's and each field's note as a doc comment", () => {
    expect(source).toContain("/** A boat the club owns. */\nexport interface Boats {");
    expect(body("Boats")).toContain("  /** Painted on the stern. */\n  name: string;");
  });
});

describe("src/schema/index.ts", () => {
  it("matches schemas/*.yaml (run `mise run schema-types` if it doesn't)", async () => {
    const committed = readFileSync(resolve(root, "src/schema/index.ts"), "utf8");
    expect(committed).toBe(await loadSchemaTypes(resolve(root, "schemas")));
  });
});
