-- Deletes every Financial Plan, plan, plan copy, row and result, saved or draft, so plans can be
-- drafted afresh in blocks (cyc-seattle/platform#149). The catalog, and Directus's revisions of the
-- plans, stay.
--
-- TRUNCATE skips the saved-versions hook's row triggers, which refuse to delete a saved plan. It
-- takes every planning table at once, without CASCADE, so it fails, deleting nothing, if a table
-- outside planning points at one. It does nothing on a database with no plans.
DO $delete$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('%I', tablename), ', ' ORDER BY tablename) INTO tables
    FROM pg_tables
    WHERE schemaname = current_schema()
      AND (tablename IN ('version_sets', 'version_set_members', 'plans') OR tablename LIKE 'plan\_%');
  IF tables IS NULL THEN
    RETURN;
  END IF;
  RAISE NOTICE 'Emptying %', tables;
  EXECUTE 'TRUNCATE ' || tables;
END
$delete$;
