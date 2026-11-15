// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// One model for a Financial Plan and its plans (cyc-seattle/platform#276). version_sets becomes
// financial_plans, and plan_versions becomes plans: one plan in one Financial Plan, with its own
// kind and program area. The old plans table and version_set_members, which joined them, go. Rows
// and results name their plan by plan_id, and results their Financial Plan by financial_plan_id.
// Saved becomes frozen. Notes become short, a plan's and a program's rules become lists of notes,
// and fields nothing reads go. Copies in no Financial Plan are deleted, with their rows.
//
// Directus can't rename a collection or field, so this renames each in place, with its keys and
// Directus's own records of it, and every row keeps its id. The frozen-plans hook's triggers name
// the old tables, so this drops them, and the hook installs new ones after the schema apply.
// Permissions and the default views are the backend stack's, which makes them under the new names.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once
// version_set_members is gone, or on a new database.

/** Each link between rows of one plan, checked at the end of a statement so a cascade can delete both. */
const INTERNAL = [
  ["plan_trips", "offering_id", "plan_offerings"],
  ["plan_activities", "offering_id", "plan_offerings"],
  ["plan_activities", "trip_id", "plan_trips"],
  ["plan_activities", "block_id", "plan_activity_blocks"],
  ["plan_salaried_positions", "remainder_pool_id", "plan_pools"],
  ["plan_salaried_bookings", "position_id", "plan_salaried_positions"],
  ["plan_bonus_owner_products", "bonus_owner_id", "plan_bonus_owners"],
  ["plan_block_staff", "block_id", "plan_activity_blocks"],
  ["plan_block_boats", "block_id", "plan_activity_blocks"],
];

/** The results, and whether each names the plan it's charged in. */
const RESULTS = {
  plan_results: false,
  plan_result_lines: true,
  plan_result_pnl: true,
  plan_result_bonuses: true,
  plan_result_positions: false,
  plan_result_capital: false,
  plan_result_warnings: true,
};

/** Each note, which holds at most 280 characters on one line. */
const NOTES = ["plan_offerings", "plan_labor_lines", "plan_budget_lines", "plan_capital_items", "plan_revenue_charges"];

/** Each field nothing reads, by table. */
const DROPPED = {
  plan_versions: ["plan_id", "parent_version_id", "status", "message", "saved_by", "saved_at", "platform_version"],
  plan_offerings: ["fill_rate"],
  plan_salaried_bookings: ["kind"],
};

/** Directus's tables that name a collection, and their columns that do, as in cyc0001. */
const REFERENCES = [
  ["directus_collections", "collection"],
  ["directus_fields", "collection"],
  ["directus_relations", "many_collection"],
  ["directus_relations", "one_collection"],
  ["directus_revisions", "collection"],
  ["directus_activity", "collection"],
  ["directus_comments", "collection"],
  ["directus_versions", "collection"],
  ["directus_shares", "collection"],
  ["directus_notifications", "collection"],
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const array = (values) => `ARRAY[${values.map(literal).join(", ")}]::text[]`;

/** A note's text on one line, at most 280 characters. */
const short = (column) => `left(btrim(regexp_replace(${column}, '\\s*\\n\\s*', ' ', 'g')), 280)`;

/** A rules field's lines as a JSON list of notes: blank lines and list markers dropped. */
const noteList = (column) => `(
  SELECT json_agg(${short("regexp_replace(btrim(line), '^[-*•]\\s+', '')")} ORDER BY n)
    FROM regexp_split_to_table(${column}, '\\n') WITH ORDINALITY AS lines(line, n)
    WHERE btrim(line) <> ''
)`;

const SQL = `
DO $migration$
DECLARE
  t text;
  ref text[];
  pair text[];
  item record;
BEGIN
  IF to_regclass('version_set_members') IS NULL OR to_regclass('plan_versions') IS NULL
    OR to_regclass('version_sets') IS NULL OR to_regclass('directus_fields') IS NULL THEN
    RETURN;
  END IF;

  -- The hook's triggers read the old tables. It installs new ones once the schema apply is done.
  FOR item IN
    SELECT c.relname FROM pg_trigger tr JOIN pg_class c ON c.oid = tr.tgrelid
      WHERE tr.tgname = 'cyc_saved_versions' AND c.relnamespace = current_schema()::regnamespace
  LOOP
    EXECUTE format('DROP TRIGGER cyc_saved_versions ON %I', item.relname);
  END LOOP;
  DROP FUNCTION IF EXISTS cyc_saved_versions_row(), cyc_saved_versions_result(), cyc_saved_versions_version(),
    cyc_saved_versions_plan(), cyc_saved_versions_set(), cyc_saved_versions_member();

  -- A plan's rows go with it, and a link between two of them is checked at the end of the statement.
  FOR t IN
    SELECT table_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'version_id' AND table_name LIKE 'plan\\_%'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_version_id_foreign');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (version_id) REFERENCES plan_versions (id) ON DELETE CASCADE',
      t, t || '_plan_id_foreign');
    EXECUTE format('ALTER TABLE %I RENAME COLUMN version_id TO plan_id', t);
    UPDATE directus_fields SET field = 'plan_id' WHERE collection = t AND field = 'version_id';
    UPDATE directus_relations SET many_field = 'plan_id' WHERE many_collection = t AND many_field = 'version_id';
  END LOOP;
  FOREACH ref SLICE 1 IN ARRAY ARRAY[${INTERNAL.map(array).join(", ")}] LOOP
    IF to_regclass(ref[1]) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', ref[1], ref[1] || '_' || ref[2] || '_foreign');
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id) ON DELETE NO ACTION',
        ref[1], ref[1] || '_' || ref[2] || '_foreign', ref[2], ref[3]);
    END IF;
  END LOOP;

  -- Each copy takes its Financial Plan, kind and area. One in no Financial Plan goes, with its rows.
  ALTER TABLE plan_versions ADD COLUMN financial_plan_id uuid, ADD COLUMN kind varchar(255),
    ADD COLUMN program_area_id uuid;
  UPDATE plan_versions v SET financial_plan_id = m.version_set_id, kind = p.kind, program_area_id = p.program_area_id
    FROM version_set_members m, plans p WHERE m.version_id = v.id AND p.id = v.plan_id;
  UPDATE plan_versions SET parent_version_id = NULL;
  DELETE FROM plan_versions WHERE financial_plan_id IS NULL;

  -- A result names the plan it's charged in, in place of its member.
  FOR t IN SELECT unnest(${array(Object.keys(RESULTS))}) LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I RENAME COLUMN version_set_id TO financial_plan_id', t);
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', t, t || '_version_set_id_foreign', t || '_financial_plan_id_foreign');
    UPDATE directus_fields SET field = 'financial_plan_id' WHERE collection = t AND field = 'version_set_id';
    UPDATE directus_relations SET many_field = 'financial_plan_id' WHERE many_collection = t AND many_field = 'version_set_id';
  END LOOP;
  FOR t IN SELECT unnest(${array(Object.keys(RESULTS).filter((table) => RESULTS[table]))}) LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_version_set_member_id_foreign');
    EXECUTE format('UPDATE %I r SET version_set_member_id = m.version_id FROM version_set_members m WHERE m.id = r.version_set_member_id', t);
    EXECUTE format('ALTER TABLE %I RENAME COLUMN version_set_member_id TO plan_id', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (plan_id) REFERENCES plan_versions (id) ON DELETE CASCADE',
      t, t || '_plan_id_foreign');
    UPDATE directus_fields SET field = 'plan_id' WHERE collection = t AND field = 'version_set_member_id';
    UPDATE directus_relations SET many_field = 'plan_id', one_collection = 'plan_versions'
      WHERE many_collection = t AND many_field = 'version_set_member_id';
  END LOOP;

  -- The join and the old plans go, with what Directus records of them.
  DROP TABLE version_set_members;
  ${Object.entries(DROPPED)
    .map(([table, fields]) => `ALTER TABLE ${table} ${fields.map((f) => `DROP COLUMN IF EXISTS ${f}`).join(", ")};`)
    .join("\n  ")}
  DROP TABLE plans;
  DELETE FROM directus_relations WHERE many_collection IN ('version_set_members', 'plans')
    OR (many_collection, many_field) IN (${Object.entries(DROPPED)
      .flatMap(([table, fields]) => fields.map((f) => `('${table}', '${f}')`))
      .join(", ")});
  DELETE FROM directus_fields WHERE collection IN ('version_set_members', 'plans')
    OR (collection, field) IN (${Object.entries(DROPPED)
      .flatMap(([table, fields]) => fields.map((f) => `('${table}', '${f}')`))
      .join(", ")})
    OR (collection, field) = ('version_sets', 'members');
  DELETE FROM directus_collections WHERE collection IN ('version_set_members', 'plans');
  DELETE FROM directus_presets WHERE collection IN ('version_set_members', 'plans');

  -- A plan is in one Financial Plan, and a draft one's delete takes its plans.
  ALTER TABLE plan_versions ALTER COLUMN financial_plan_id SET NOT NULL, ALTER COLUMN kind SET NOT NULL,
    ADD CONSTRAINT plan_versions_financial_plan_id_foreign FOREIGN KEY (financial_plan_id)
      REFERENCES version_sets (id) ON DELETE CASCADE,
    ADD CONSTRAINT plan_versions_program_area_id_foreign FOREIGN KEY (program_area_id)
      REFERENCES program_areas (id) ON DELETE RESTRICT;
  INSERT INTO directus_fields (collection, field, special) VALUES
    ('plan_versions', 'financial_plan_id', 'm2o'), ('plan_versions', 'kind', NULL),
    ('plan_versions', 'program_area_id', 'm2o'), ('version_sets', 'plans', 'o2m');
  INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_deselect_action) VALUES
    ('plan_versions', 'financial_plan_id', 'version_sets', 'plans', 'nullify'),
    ('plan_versions', 'program_area_id', 'program_areas', NULL, 'nullify');

  -- A plan's and a program's rules become a list of short notes.
  ALTER TABLE plan_versions ADD COLUMN notes json;
  UPDATE plan_versions SET notes = ${noteList("rules")} WHERE rules IS NOT NULL;
  ALTER TABLE plan_versions DROP COLUMN rules;
  UPDATE directus_fields SET field = 'notes', special = 'cast-json' WHERE collection = 'plan_versions' AND field = 'rules';
  IF to_regclass('plan_programs') IS NOT NULL THEN
    ALTER TABLE plan_programs ADD COLUMN notes json;
    UPDATE plan_programs SET notes = ${noteList("rules")} WHERE rules IS NOT NULL;
    ALTER TABLE plan_programs DROP COLUMN rules;
    UPDATE directus_fields SET field = 'notes', special = 'cast-json' WHERE collection = 'plan_programs' AND field = 'rules';
  END IF;

  -- A Financial Plan's note is short: a long one keeps its first line, if that fits. Saved is frozen.
  UPDATE version_sets SET message = CASE
    WHEN length(message) <= 280 THEN ${short("message")}
    WHEN length(btrim(split_part(message, E'\\n', 1))) <= 280 THEN nullif(btrim(split_part(message, E'\\n', 1)), '')
  END WHERE message IS NOT NULL;
  ALTER TABLE version_sets ALTER COLUMN message TYPE varchar(280);
  ALTER TABLE version_sets RENAME COLUMN message TO note;
  ALTER TABLE version_sets RENAME COLUMN saved_by TO frozen_by;
  ALTER TABLE version_sets RENAME COLUMN saved_at TO frozen_at;
  UPDATE version_sets SET status = 'frozen' WHERE status = 'saved';
  UPDATE directus_fields SET field = 'note' WHERE collection = 'version_sets' AND field = 'message';
  UPDATE directus_fields SET field = 'frozen_by' WHERE collection = 'version_sets' AND field = 'saved_by';
  UPDATE directus_fields SET field = 'frozen_at' WHERE collection = 'version_sets' AND field = 'saved_at';

  FOR t IN SELECT unnest(${array(NOTES)}) LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET note = ${short("note").replaceAll("'", "''")} WHERE note IS NOT NULL', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN note TYPE varchar(280)', t);
    END IF;
  END LOOP;

  -- The two collections take their names, with their keys.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[ARRAY['plan_versions', 'plans'], ARRAY['version_sets', 'financial_plans']] LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I', pair[1], pair[2]);
    FOR item IN
      SELECT conname FROM pg_constraint
        WHERE conrelid = to_regclass(quote_ident(pair[2])) AND starts_with(conname, pair[1] || '_')
    LOOP
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', pair[2], item.conname,
        pair[2] || substr(item.conname, length(pair[1]) + 1));
    END LOOP;
    FOR item IN
      SELECT indexname FROM pg_indexes
        WHERE tablename = pair[2] AND schemaname = current_schema() AND starts_with(indexname, pair[1] || '_')
    LOOP
      EXECUTE format('ALTER INDEX %I RENAME TO %I', item.indexname, pair[2] || substr(item.indexname, length(pair[1]) + 1));
    END LOOP;
    FOREACH ref SLICE 1 IN ARRAY ARRAY[${REFERENCES.map(array).join(", ")}] LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ref[1] AND column_name = ref[2]
      ) THEN
        EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', ref[1], ref[2], ref[2]) USING pair[2], pair[1];
      END IF;
    END LOOP;
    -- A user's own saved views and bookmarks, but not the default views.
    UPDATE directus_presets SET collection = pair[2]
      WHERE collection = pair[1] AND NOT ("user" IS NULL AND role IS NULL AND bookmark IS NULL);
  END LOOP;
END
$migration$;

-- An asset's note is short too, in core.
DO $assets$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'assets' AND column_name = 'note' AND data_type = 'text'
  ) THEN
    UPDATE assets SET note = ${short("note")} WHERE note IS NOT NULL;
    ALTER TABLE assets ALTER COLUMN note TYPE varchar(280);
  END IF;
END
$assets$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the old tables are gone.
async function down() {}

module.exports = { up, down, SQL, INTERNAL, NOTES, DROPPED };
