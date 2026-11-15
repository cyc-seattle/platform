// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// A one-off fix to prod's 2026 Financial Plans, which the frozen-plans rules forbid: it sets which
// plan each was started from, and unfreezes "2026 with conflicts resolved", at the maintainer's
// request. A Financial Plan's parent never changes, and freezing is one way, so the frozen-plans
// triggers on financial_plans are off for these three updates. ALTER TABLE locks the table until
// the migration commits, so no other write gets in while they're off.
//
// The unfrozen plan's results were worked out when it was frozen, so they go, with the triggers on,
// and the hook works them out again as a draft's when Directus starts, as it does for every draft
// with none.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing unless all three
// exist, for the same organization and year, so it does nothing on dev or a new database, and
// running it again changes nothing.

/** "2026 as originally planned", which started from nothing. */
const ORIGINAL = "68a6c8f9-36c9-4899-a902-1f87222e82fc";
/** "2026 re-planned for Fall", started from the original. */
const FALL = "9c079c0d-70f1-4565-9923-116d097e4b9a";
/** "2026 with conflicts resolved", started from Fall's, and a draft again. */
const RESOLVED = "52cc84bf-8577-4472-82d3-b7ef57e9cb6b";

/** The tables of a Financial Plan's results, as stacks/backend/policies.ts lists them. */
const RESULTS = [
  "plan_results",
  "plan_result_lines",
  "plan_result_pnl",
  "plan_result_bonuses",
  "plan_result_positions",
  "plan_result_capital",
  "plan_result_warnings",
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const ids = [ORIGINAL, FALL, RESOLVED].map((id) => `${literal(id)}::uuid`).join(", ");

const SQL = `
DO $migration$
DECLARE
  t text;
BEGIN
  IF to_regclass('financial_plans') IS NULL THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM financial_plans WHERE id IN (${ids})) < 3 THEN
    RETURN;
  END IF;
  IF (SELECT count(DISTINCT (organization_id, fiscal_year)) FROM financial_plans WHERE id IN (${ids})) > 1 THEN
    RAISE WARNING 'cyc0022: the 2026 Financial Plans are for different organizations or years, so their parents stay';
    RETURN;
  END IF;

  ALTER TABLE financial_plans DISABLE TRIGGER USER;
  UPDATE financial_plans SET parent_id = NULL WHERE id = ${literal(ORIGINAL)};
  UPDATE financial_plans SET parent_id = ${literal(ORIGINAL)} WHERE id = ${literal(FALL)};
  UPDATE financial_plans
    SET parent_id = ${literal(FALL)}, status = 'draft', frozen_by = NULL, frozen_at = NULL, platform_version = NULL
    WHERE id = ${literal(RESOLVED)};
  ALTER TABLE financial_plans ENABLE TRIGGER USER;

  -- The results trigger lets a draft's results go while the hook's flag is on.
  PERFORM set_config('cyc.writing_results', 'on', true);
  FOREACH t IN ARRAY ARRAY[${RESULTS.map(literal).join(", ")}] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE financial_plan_id = %L', t, ${literal(RESOLVED)});
    END IF;
  END LOOP;
  PERFORM set_config('cyc.writing_results', 'off', true);
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way, like freezing.
async function down() {}

module.exports = { up, down, SQL, ORIGINAL, FALL, RESOLVED, RESULTS };
