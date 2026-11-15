// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// Staff levels become records of their own, a role at a grade, and a plan sets only each one's rate
// (cyc-seattle/platform#295). Each plan's staff level maps by its name onto a level in LEVELS. A
// name it doesn't know becomes a level of its own, an Instructor at the standard grade, so none is
// lost. Where two of a plan's levels map onto one, such as the summer head instructor's, the plan
// keeps one row, at the first one's rate. A volunteer's rate, and an empty one, become $0, which is
// what the engine charged for them. Frozen plans' rows change too, since a row keeps its meaning,
// so the frozen-plans triggers are off while it runs.
//
// The schema apply refuses a column that's already there without Directus's record of it, so this
// adds none. It lists each level in cyc_seed_staff_levels, and each row that named one in
// cyc_seed_staff_level_rows, for the frozen-plans hook to add the levels and fill in staff_level_id
// once the apply has added them. Then it drops the old fields, which the apply never deletes.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once
// plan_staff_levels.name is gone, or on a new database.

/** Each level the plans' names map onto: its name, role, grade, and the old names that map onto it. */
const LEVELS = [
  ["Volunteer Coach", "Coach", "volunteer", ["volunteer"]],
  ["Junior Instructor", "Instructor", "junior", []],
  ["Instructor", "Instructor", "standard", ["1 - min wage"]],
  ["Senior Instructor", "Instructor", "senior", ["2 - experienced"]],
  ["Head Instructor", "Instructor", "head", ["4 - head instructor", "summer head instructor (level 4 + 10%)"]],
  ["Coach", "Coach", "standard", ["3 - coach"]],
  ["Head Coach", "Coach", "head", ["5 - senior staff"]],
  ["Office Staff", "Office", "standard", ["g&a hourly labor (level 3 rate)"]],
];

/** The roles, in the order planning lists them. */
const ROLES = ["Instructor", "Coach", "Office"];

/** The fields that named a staff level by its key in the Operations Plan. */
const USES = ["plan_programs", "plan_block_staff", "plan_labor_lines"];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;

/** A name as the map matches it: trimmed, lowercase, with single spaces. */
const normal = (column) => `lower(regexp_replace(btrim(${column}), '\\s+', ' ', 'g'))`;

// Each old name, and each level's own, with the order a plan keeps one of two that map onto a level.
const names = LEVELS.flatMap(([name, , , old]) =>
  [name.toLowerCase(), ...old].map((alias, rank) => `(${literal(alias)}, ${literal(name)}, ${rank})`),
);
const levels = LEVELS.map(
  ([name, role, grade]) => `(${literal(name)}, ${literal(role)}, ${literal(grade)}, ${ROLES.indexOf(role) + 1})`,
);
const dropped = [
  ["plan_staff_levels", "name"],
  ["plan_staff_levels", "pay_type"],
  ...USES.map((table) => [table, "staff_level_key"]),
];
const pairs = dropped.map(([table, field]) => `(${literal(table)}, ${literal(field)})`).join(", ");
const tables = ["plan_staff_levels", ...USES];

const SQL = `
DO $migration$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'plan_staff_levels' AND column_name = 'name'
  ) OR to_regclass('plans') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS cyc_seed_staff_levels (
    name text PRIMARY KEY, role text NOT NULL, grade text NOT NULL, role_sort integer NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cyc_seed_staff_level_rows (
    collection text NOT NULL, id uuid NOT NULL, level text NOT NULL, PRIMARY KEY (collection, id)
  );
  CREATE TEMPORARY TABLE cyc_staff_level_names (alias text PRIMARY KEY, name text NOT NULL, rank integer NOT NULL)
    ON COMMIT DROP;
  INSERT INTO cyc_staff_level_names VALUES ${names.join(", ")};
  INSERT INTO cyc_seed_staff_levels VALUES ${levels.join(", ")} ON CONFLICT DO NOTHING;

  -- Each plan's level, by the name it maps onto, or its own.
  CREATE TEMPORARY TABLE cyc_staff_level_map ON COMMIT DROP AS
    SELECT l.id, l.plan_id, l.key, coalesce(n.name, btrim(l.name)) AS level,
      row_number() OVER (PARTITION BY l.plan_id, coalesce(n.name, btrim(l.name)) ORDER BY coalesce(n.rank, 0), l.id) AS nth
      FROM plan_staff_levels l LEFT JOIN cyc_staff_level_names n ON n.alias = ${normal("l.name")};
  INSERT INTO cyc_seed_staff_levels
    SELECT DISTINCT m.level, 'Instructor', 'standard', ${ROLES.indexOf("Instructor") + 1} FROM cyc_staff_level_map m
    ON CONFLICT DO NOTHING;

  FOREACH t IN ARRAY ARRAY[${tables.map(literal).join(", ")}] LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
  END LOOP;

  -- Each row that named a level by key names it by the level it maps onto, in the same Financial Plan.
  FOREACH t IN ARRAY ARRAY[${USES.map(literal).join(", ")}] LOOP
    EXECUTE format(
      'INSERT INTO cyc_seed_staff_level_rows
        SELECT DISTINCT ON (r.id) %L, r.id, m.level FROM %I r
          JOIN plans p ON p.id = r.plan_id
          JOIN plans o ON o.financial_plan_id = p.financial_plan_id
          JOIN cyc_staff_level_map m ON m.plan_id = o.id AND m.key = r.staff_level_key
          ORDER BY r.id, (o.kind = ''operations'') DESC
        ON CONFLICT DO NOTHING', t, t);
  END LOOP;

  INSERT INTO cyc_seed_staff_level_rows SELECT 'plan_staff_levels', m.id, m.level FROM cyc_staff_level_map m
    WHERE m.nth = 1 ON CONFLICT DO NOTHING;
  UPDATE plan_staff_levels SET hourly_rate_cents = 0 WHERE pay_type = 'volunteer' OR hourly_rate_cents IS NULL;
  DELETE FROM plan_staff_levels WHERE id IN (SELECT id FROM cyc_staff_level_map WHERE nth > 1);

  FOREACH t IN ARRAY ARRAY[${tables.map(literal).join(", ")}] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
  END LOOP;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE (many_collection, many_field) IN (${pairs});
    DELETE FROM directus_fields WHERE (collection, field) IN (${pairs});
  END IF;
  ALTER TABLE plan_staff_levels DROP COLUMN name, DROP COLUMN pay_type;
  FOREACH t IN ARRAY ARRAY[${USES.map(literal).join(", ")}] LOOP
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS staff_level_key', t);
  END LOOP;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// Nothing to restore: the old fields are gone from the schema.
async function down() {}

module.exports = { up, down, SQL, LEVELS, ROLES };
