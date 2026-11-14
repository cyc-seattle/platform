-- What move-storage.sql would move, in each draft Financial Plan. Reads only.
SELECT s.name AS financial_plan, area.name AS program_area, row.name AS line, row.amount_cents
  FROM plan_budget_lines row
  JOIN version_set_members member ON member.version_id = row.version_id
  JOIN plans plan ON plan.id = member.plan_id AND plan.kind = 'program_area'
  JOIN program_areas area ON area.id = plan.program_area_id
  JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
  WHERE row.name = 'Storage (dinghy float and dry storage, by area)'
  ORDER BY s.name, area.name;
SELECT s.name AS financial_plan, row.name AS operations_line_to_rebook, row.amount_cents
  FROM plan_budget_lines row
  JOIN accounts account ON account.id = row.account_id AND account.number = '7350'
  JOIN version_set_members member ON member.version_id = row.version_id
  JOIN plans plan ON plan.id = member.plan_id AND plan.kind = 'operations'
  JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
  WHERE row.name IN ('Storage not allocated to programs (dinghy float and dry storage)', 'Self storage facility')
  ORDER BY s.name, row.name;
SELECT s.name AS financial_plan, area.name AS program_area, row.role_name AS bonus, row.bonus_rate
  FROM plan_bonus_owners row
  JOIN version_set_members member ON member.version_id = row.version_id
  JOIN plans plan ON plan.id = member.plan_id AND plan.kind = 'program_area'
  JOIN program_areas area ON area.id = plan.program_area_id
  JOIN version_sets s ON s.id = member.version_set_id AND s.status = 'draft'
  ORDER BY s.name, area.name;
SELECT number, name FROM accounts WHERE parent_id = (SELECT id FROM accounts WHERE number = '7350');
