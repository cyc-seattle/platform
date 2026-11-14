// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// An offering's season becomes a choice of winter, spring, summer, or fall, or none
// (cyc-seattle/platform#251), in place of free text. In each draft offering, text naming exactly one
// season becomes that season, such as "Summer 2026" to summer, and any other text becomes none. A
// saved copy never changes, so a saved offering keeps its text, which the engine reads as none.
// It does nothing where every draft offering already holds a season or none.

const SEASONS = ["winter", "spring", "summer", "fall"];

const matches = SEASONS.map((season) => `(lower(o.season_term) LIKE '%${season}%')::int`).join(" + ");
const cases = SEASONS.map((season) => `WHEN lower(o.season_term) LIKE '%${season}%' THEN '${season}'`).join(" ");

const SQL = `
DO $migration$
BEGIN
  IF to_regclass('plan_offerings') IS NULL OR to_regclass('plan_versions') IS NULL THEN
    RETURN;
  END IF;
  UPDATE plan_offerings o
    SET season_term = CASE WHEN ${matches} = 1 THEN CASE ${cases} END END
    FROM plan_versions v
    WHERE v.id = o.version_id AND v.status = 'draft'
      AND o.season_term IS NOT NULL AND o.season_term NOT IN (${SEASONS.map((s) => `'${s}'`).join(", ")});
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the free text is gone.
async function down() {}

module.exports = { up, down, SQL, SEASONS };
