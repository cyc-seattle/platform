-- Moves storage rent, and bonuses, out of each draft Financial Plan's Program Plans into its
-- Operations Plan (cyc-seattle/platform#251), once, by hand. A saved Financial Plan never changes, so
-- it keeps them where they are.
--
-- - Adds the Storage account under 7350 Occupancy/Rent, if it isn't there.
-- - Each area's "Storage (dinghy float and dry storage, by area)" line goes to the Operations Plan,
--   still charged to the area, on Storage.
-- - The Operations Plan's own storage lines move from 7350 to Storage, so the Storage tab finds them.
-- - Each bonus in a Program Plan goes to the Operations Plan, with its products.
--
-- A row can't move to another plan copy, so each is copied there, keeping its key, then deleted.
-- It's one statement, so Postgres runs it in one transaction. Running it again finds nothing left
-- to move.
DO $move$
DECLARE
  occupancy uuid;
  storage uuid;
  item record;
  owner uuid;
  lines integer := 0;
  rebooked integer := 0;
  bonuses integer := 0;
BEGIN
  SELECT id INTO occupancy FROM accounts WHERE number = '7350';
  IF occupancy IS NULL THEN
    RAISE EXCEPTION 'There is no account 7350 Occupancy/Rent to put Storage under';
  END IF;
  SELECT id INTO storage FROM accounts WHERE parent_id = occupancy AND name = 'Storage';
  IF storage IS NULL THEN
    storage := gen_random_uuid();
    INSERT INTO accounts (id, number, name, type, parent_id, retired, default_function, form_990_part, form_990_line)
      SELECT storage, '7351', 'Storage', type, id, false, default_function, form_990_part, form_990_line
        FROM accounts WHERE id = occupancy;
    RAISE NOTICE 'Added the account 7351 Storage under 7350 Occupancy/Rent';
  END IF;

  FOR item IN
    SELECT row.id, operations.version_id AS operations
      FROM plan_budget_lines row
      JOIN version_set_members member ON member.version_id = row.version_id
      JOIN plans plan ON plan.id = member.plan_id AND plan.kind = 'program_area'
      JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
      JOIN version_set_members operations ON operations.version_set_id = s.id
      JOIN plans operations_plan ON operations_plan.id = operations.plan_id AND operations_plan.kind = 'operations'
      WHERE row.name = 'Storage (dinghy float and dry storage, by area)'
  LOOP
    INSERT INTO plan_budget_lines
      SELECT (jsonb_populate_record(NULL::plan_budget_lines, to_jsonb(line) || jsonb_build_object(
        'id', gen_random_uuid(), 'version_id', item.operations, 'account_id', storage))).*
        FROM plan_budget_lines line WHERE line.id = item.id;
    DELETE FROM plan_budget_lines WHERE id = item.id;
    lines := lines + 1;
  END LOOP;

  UPDATE plan_budget_lines row SET account_id = storage
    FROM version_set_members member
    JOIN plans plan ON plan.id = member.plan_id AND plan.kind = 'operations'
    JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
    WHERE member.version_id = row.version_id AND row.account_id = occupancy
      AND row.name IN ('Storage not allocated to programs (dinghy float and dry storage)', 'Self storage facility');
  GET DIAGNOSTICS rebooked = ROW_COUNT;

  FOR item IN
    SELECT row.id, operations.version_id AS operations
      FROM plan_bonus_owners row
      JOIN version_set_members member ON member.version_id = row.version_id
      JOIN plans plan ON plan.id = member.plan_id AND plan.kind = 'program_area'
      JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
      JOIN version_set_members operations ON operations.version_set_id = s.id
      JOIN plans operations_plan ON operations_plan.id = operations.plan_id AND operations_plan.kind = 'operations'
  LOOP
    owner := gen_random_uuid();
    INSERT INTO plan_bonus_owners
      SELECT (jsonb_populate_record(NULL::plan_bonus_owners, to_jsonb(bonus) || jsonb_build_object(
        'id', owner, 'version_id', item.operations))).*
        FROM plan_bonus_owners bonus WHERE bonus.id = item.id;
    INSERT INTO plan_bonus_owner_products
      SELECT (jsonb_populate_record(NULL::plan_bonus_owner_products, to_jsonb(owned) || jsonb_build_object(
        'id', gen_random_uuid(), 'version_id', item.operations, 'bonus_owner_id', owner))).*
        FROM plan_bonus_owner_products owned WHERE owned.bonus_owner_id = item.id;
    DELETE FROM plan_bonus_owner_products WHERE bonus_owner_id = item.id;
    DELETE FROM plan_bonus_owners WHERE id = item.id;
    bonuses := bonuses + 1;
  END LOOP;

  RAISE NOTICE 'Moved % storage lines and % bonuses into Operations Plans, and rebooked % Operations Plan storage lines to Storage',
    lines, bonuses, rebooked;
END
$move$;
