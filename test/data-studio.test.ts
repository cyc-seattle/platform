import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, it, expect } from "vitest";
import { discoverSchemaFiles, mergeSchemas } from "../src/directus/client.ts";
import { defaultViews } from "../stacks/backend/default-views.ts";

// The rules that keep the Data Studio readable for staff, checked from the schemas
// (.agents/skills/directus-schema/SKILL.md). An exception names the field or collection and why.

interface Collection {
  collection: string;
  meta: { display_template: string | null; group: string | null; hidden: boolean; note: string | null };
  schema?: unknown;
}

interface Field {
  collection: string;
  field: string;
  type: string;
  meta: {
    display: string | null;
    display_options: { template?: string; choices?: { text: string; value: unknown }[]; type?: string } | null;
    hidden: boolean;
    interface: string | null;
    note: string | null;
    options: { choices?: { text: string; value: unknown }[] } | null;
    readonly: boolean;
    special: string[] | null;
    translations: { language: string; translation: string }[] | null;
  };
  schema?: { is_primary_key: boolean } | null;
}

interface Relation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta: { one_field: string | null; junction_field: string | null } | null;
}

const loaded = discoverSchemaFiles(path.join(import.meta.dirname, "../schemas")).map(({ name, path: file }) => ({
  name,
  schema: yaml.load(fs.readFileSync(file, "utf8")) as { collections: Collection[] },
}));
const schema = mergeSchemas(loaded) as { collections: Collection[]; fields: Field[]; relations: Relation[] };

/** Fields a staffer sees as an ID, but that say what a row is about. */
const VISIBLE_KEYS: Record<string, string> = {
  "sync_tasks.key": "Names what the task works on, such as a camp, not the task itself.",
};

/** Key fields planners type on the row's page, copying another row's Key. Out of the default columns. */
const PLANNER_KEYS: Record<string, string> = {
  "plan_offerings.coach_level_key": "Planners copy in a staff level's Key.",
  "plan_activity_resources.resource_key": "Planners copy in a resource's Key.",
  "plan_labor_lines.staff_level_key": "Planners copy in a staff level's Key.",
  "plan_labor_lines.cost_center_key": "Planners copy in an offering's or pool's Key, or a product's ID.",
  "plan_budget_lines.cost_center_key": "Planners copy in an offering's or pool's Key, or a product's ID.",
  "plan_staff_levels.qualifications": "Planners add each qualification's ID.",
  "plan_salaried_positions.qualifications": "Planners add each qualification's ID.",
  "plan_activity_block_rules.offering_keys": "Planners add each offering's Key.",
  "plan_activity_block_rules.salaried_positions": "Planners add each salaried position's Key.",
};

/** A planning row's own Key: read-only, and visible so planners can copy it into the fields above. */
const isPlanRowKey = (field: Field) => field.collection.startsWith("plan_") && field.field === "key";

const shownOnPurpose = (field: Field) =>
  key(field) in VISIBLE_KEYS || key(field) in PLANNER_KEYS || (isPlanRowKey(field) && field.meta.readonly);

/** Status fields that stay free text. */
const FREE_TEXT_STATUS: Record<string, string> = {
  "clubspot_registrations.status": "Clubspot's own code, stored as Clubspot sends it. Its full list isn't known.",
  "clubspot_registrations.waiver_status":
    "Clubspot's own code, stored as Clubspot sends it. Its full list isn't known.",
  "clubspot_registration_entries.clubspot_status": "Clubspot's own code, kept beside the status staff use.",
};

/** Join tables the sidebar still shows. */
const VISIBLE_JOIN_TABLES: Record<string, string> = {
  clubspot_session_classes: "No session or class links to it, so the sidebar is the only way in.",
};

/** Fields a Clubspot sync copies but staff set by hand. Matches the writer rules in policies.ts. */
const SET_BY_HAND = new Set(["clubspot_classes.program_id", "clubspot_participants.person_id"]);

/** Words in a field's key a staffer wouldn't know without a label or a note. */
const ACRONYMS = ["ga", "cogs", "byob", "mtdc", "990"];

const tables = schema.collections.filter((c) => c.schema !== undefined);
const visibleTables = tables.filter((c) => !c.meta.hidden);
const columns = schema.fields.filter((f) => f.type !== "alias");
const relationOf = (field: Field) =>
  schema.relations.find((r) => r.collection === field.collection && r.field === field.field && r.related_collection);
const links = columns.filter((field) => relationOf(field) !== undefined);
const key = (field: Field) => `${field.collection}.${field.field}`;
const isPrimaryKey = (field: Field) => field.schema?.is_primary_key === true;
const label = (field: Field) => field.meta.translations?.find((t) => t.language === "en-US")?.translation;

/** A table that only pairs two others: its own ID and two links. */
function isJoinTable(collection: string): boolean {
  const own = columns.filter((field) => field.collection === collection && !isPrimaryKey(field));
  return own.length === 2 && own.every((field) => relationOf(field) !== undefined);
}

describe("the Data Studio", () => {
  describe("names each row", () => {
    it.each(tables.map((c) => [c.collection, c]))("%s has a display template", (_, c) => {
      expect(c.meta.display_template, "no display template").toBeTruthy();
    });

    it.each(tables.map((c) => [c.collection, c]))("%s's template shows no raw ID", (_, c) => {
      const raw = [...(c.meta.display_template ?? "").matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)]
        .map(([, ref]) => ref!)
        .filter((ref) => ref === "id" || ref === "key" || /_id$/.test(ref))
        .filter((ref) => !(`${c.collection}.${ref}` in VISIBLE_KEYS));
      expect(raw, "a template part that shows an ID").toEqual([]);
    });
  });

  describe("shows a link by the linked row's name", () => {
    it.each(links.map((f) => [key(f), f]))("%s", (_, field) => {
      expect(field.meta.special).toContain("m2o");
      expect(field.meta.display).toBe("related-values");
      expect(field.meta.display_options?.template).toBeTruthy();
    });

    it.each(
      schema.fields.filter((f) => ["list-o2m", "list-m2m"].includes(f.meta.interface ?? "")).map((f) => [key(f), f]),
    )("%s, a list of linked rows", (_, field) => {
      expect(field.meta.display).toBe("related-values");
      expect(field.meta.display_options?.template).toBeTruthy();
    });

    it("lists rows through a join table as many-to-many, so Add existing offers the real rows", () => {
      const oneToManyJoins = schema.fields
        .filter((field) => field.meta.interface === "list-o2m")
        .flatMap((field) => {
          const many = schema.relations.find(
            (r) => r.related_collection === field.collection && r.meta?.one_field === field.field,
          );
          return many && isJoinTable(many.collection) ? [key(field)] : [];
        });
      expect(oneToManyJoins).toEqual([]);
    });

    it("labels a link without ID", () => {
      const unlabelled = links
        .filter((field) => field.field.endsWith("_id"))
        .filter((field) => !label(field) || /\bID\b/i.test(label(field)!))
        .map(key);
      expect(unlabelled).toEqual([]);
    });
  });

  describe("hides IDs", () => {
    it("hides each row ID and key", () => {
      const shown = columns
        .filter((field) => isPrimaryKey(field) || field.field === "key" || /_keys?$/.test(field.field))
        .filter((field) => !field.meta.hidden && !shownOnPurpose(field))
        .map(key);
      expect(shown).toEqual([]);
    });

    it("keeps the key fields planners type out of the default columns, with a note", () => {
      const keyFields = columns.filter((field) => key(field) in PLANNER_KEYS || isPlanRowKey(field));
      const columned = keyFields.filter((field) =>
        defaultViews.some((view) => view.collection === field.collection && view.fields.includes(field.field)),
      );
      expect(columned.map(key)).toEqual([]);
      expect(keyFields.filter((field) => !field.meta.note).map(key)).toEqual([]);
      expect(Object.keys(PLANNER_KEYS).filter((k) => !columns.some((field) => key(field) === k))).toEqual([]);
    });

    it("hides an ID that links to nothing", () => {
      const shown = columns
        .filter((field) => field.type === "uuid" && !isPrimaryKey(field) && relationOf(field) === undefined)
        .filter((field) => !field.meta.hidden && !shownOnPurpose(field))
        .map(key);
      expect(shown).toEqual([]);
    });
  });

  describe("opens each table usefully", () => {
    it("gives every table the sidebar shows a default view", () => {
      const missing = visibleTables
        .map((c) => c.collection)
        .filter((c) => !defaultViews.some((v) => v.collection === c));
      expect(missing).toEqual([]);
    });

    it("puts every table the sidebar shows in a folder", () => {
      expect(visibleTables.filter((c) => c.meta.group === null).map((c) => c.collection)).toEqual([]);
    });

    it("keeps a join table out of the sidebar", () => {
      const shown = visibleTables.map((c) => c.collection).filter((c) => isJoinTable(c) && !(c in VISIBLE_JOIN_TABLES));
      expect(shown).toEqual([]);
    });
  });

  describe("shows values in words", () => {
    it("shows a dropdown's choices by their labels", () => {
      const raw = schema.fields
        .filter((field) => field.meta.interface === "select-dropdown")
        .filter((field) => {
          const shown = field.meta.display_options?.choices?.map(({ text, value }) => [text, value]);
          const offered = field.meta.options?.choices?.map(({ text, value }) => [text, value]);
          return field.meta.display !== "labels" || JSON.stringify(shown) !== JSON.stringify(offered);
        })
        .map(key);
      expect(raw).toEqual([]);
    });

    it("gives a dropdown's choices words, not codes", () => {
      const codes = schema.fields.flatMap((field) =>
        (field.meta.options?.choices ?? [])
          .filter(({ text }) => /_/.test(text) || /^[a-z]/.test(text))
          .map(({ text }) => `${key(field)}: ${text}`),
      );
      expect(codes).toEqual([]);
    });

    it("offers a status as a dropdown", () => {
      const freeText = columns
        .filter((field) => /(^|_)status$/.test(field.field) && field.meta.interface !== "select-dropdown")
        .filter((field) => !(key(field) in FREE_TEXT_STATUS))
        .map(key);
      expect(freeText).toEqual([]);
    });

    it("shows money in cents as dollars", () => {
      const wrong = columns
        .filter(
          (field) =>
            field.field.endsWith("_cents") ||
            (["integer", "bigInteger"].includes(field.type) && field.meta.display_options?.type === "currency"),
        )
        .filter((field) => field.meta.display !== "cents-as-dollars")
        .map(key);
      expect(wrong).toEqual([]);
    });

    it("gives a date a date picker", () => {
      const typed = columns
        .filter((field) => ["date", "timestamp", "dateTime", "time"].includes(field.type))
        .filter((field) => field.meta.interface === "input")
        .map(key);
      expect(typed).toEqual([]);
    });

    it("explains an acronym in a label or a note", () => {
      const unexplained = columns
        .filter((field) => field.field.split("_").some((part) => ACRONYMS.includes(part)))
        .filter((field) => !label(field) && !field.meta.note)
        .map(key);
      expect(unexplained).toEqual([]);
    });
  });

  describe("writes notes for staff", () => {
    const fieldKeys = new Set(schema.fields.map(key));
    const notes = [
      ...schema.collections.map((c) => [c.collection, c.meta.note] as const),
      ...schema.fields.map((f) => [key(f), f.meta.note] as const),
    ].filter((entry): entry is readonly [string, string] => typeof entry[1] === "string");

    it.each(notes)("%s", (_, note) => {
      expect(note, "names a code file").not.toMatch(/\b[\w-]+\.(ts|js|cjs|mjs|md|yaml)\b/);
      expect(note, "points to an issue").not.toMatch(/#\d+/);
      expect(note, "uses developer words").not.toMatch(/\bReverse of\b/i);
      const keys = [...note.matchAll(/\b([a-z_]+\.[a-z_]+)\b/g)]
        .map(([, ref]) => ref!)
        .filter((ref) => fieldKeys.has(ref));
      expect(keys, "names a field by its key").toEqual([]);
    });
  });

  describe("keeps a synced field read-only", () => {
    const clubspot = loaded.find(({ name }) => name === "clubspot")!.schema.collections.filter((c) => c.schema);
    // Staff keep promoted_fields themselves.
    const synced = clubspot.map((c) => c.collection).filter((c) => c !== "clubspot_promoted_fields");

    it.each(synced)("%s", (collection) => {
      const editable = columns
        .filter((field) => field.collection === collection && !field.meta.readonly && !SET_BY_HAND.has(key(field)))
        .map(key);
      expect(editable).toEqual([]);
    });
  });
});
