---
name: allocate-plan
description: Fill in a Financial Plan's blocks with their staff, RIBs and boats, in a new draft, following the program settings and the planner's rules, then fix what the engine warns about. Use when a planner asks to allocate, staff, or re-allocate a plan or part of one, such as "allocate the 2027 plan" or "re-allocate Summer weeks 3 to 5".
---

# Allocate a Financial Plan

A planner's Financial Plan holds offerings and their activities. The engine prices only what each
block is given. A block is one or more activities on one date that share their staff and boats,
such as Guppies and Minnows on the morning of July 13. You decide the blocks and what each one gets,
from the program settings and the planner's rules. The engine then warns where a block breaks a
limit, and you fix what you can.

`docs/planning-schema.md` describes every collection named here, and `docs/planning-engine.md`
says how the engine costs blocks and what each warning means. Read both first.

You work as the planner, with their Plan Writer policy, through the Directus MCP tools
(`mcp__directus__*`). If the tools need auth, run their `authenticate` tool first. Never use an
admin account or SQL.

## 1. Start a draft of your own

Ask the planner which Financial Plan to start from, and whether to allocate all of it or part of it,
such as one program area or some weeks.

1. Create a `version_sets` row for the same `organization_id` and `fiscal_year`, with `parent_id` set
   to that Financial Plan, `status` `draft`, and a name that says it's yours, such as
   "2027 allocations, Nov 9". The planner's own Financial Plan stays as it is.
2. The hook copies the parent's plans into it a moment later. Read its `version_set_members` until
   they're there, and note each member's `version_id` and its plan's `kind` and `program_area_id`.
   Every row you read or write from here on is in one of those copies.

## 2. Read the plan

From the Operations Plan's copy:

- `plan_staff_levels`: each level's `key`, name, pay and `qualifications`.
- `plan_salaried_positions`: each position's `key`, name, `qualifications` and
  `hourly_coaching_rate_cents`.
- `plan_resources`: each resource's `key`, name, kind and `quantity`. The resource kind in
  `plan_rates.rib_resource_kind_id` is RIBs.
- `plan_boat_rates`: each boat class's `quantity`, how many the organization has. Read each class's
  `sailors_per_boat` from `boat_classes`.
- `plan_closed_dates`.
- The copy's own `rules` (`plan_versions.rules`): rules for the whole organization.

From each Program Plan's copy:

- `plan_programs`: each program's `staff_level_key`, `sailors_per_coach` and `rules`.
- The copy's own `rules`: rules for the program area.
- `plan_offerings` with their enrollment (`target_enrollment`, or `capacity × fill_rate`),
  `plan_activities` with their dates and times, `plan_trips`, and any blocks already there:
  `plan_activity_blocks`, `plan_block_staff`, `plan_block_resources`, `plan_block_boats`.

Then read the draft's warnings: `plan_result_warnings` filtered on the draft's `version_set_id`.

Read the rules as a list of what the planner wants. A rule is the planner's own words, so when one is
unclear, or two disagree, ask the planner rather than guess.

## 3. Write the blocks

For each date, in the part of the plan you're allocating:

1. **Group the activities into blocks**, by the rules. An activity that shares nothing is a block of
   one. A rule such as "J-Pod and K-Pod share coaches on Wednesdays" puts those activities in one
   block on each Wednesday. Every activity other than a travel day needs a block with staff, and a
   travel day needs one if its trip's coaches fly or stay. A block's activities are all in one
   Program Plan copy.
2. **Give each block its staff**, in `plan_block_staff`. Start from each program's
   `sailors_per_coach`: a block of several programs needs Σ (a program's sailors ÷ its sailors per
   coach) staff, rounded up, at the program's staff level or one qualified for it. Then apply the
   rules, such as "if there are more than 12 Guppies, add a Junior Instructor". A row is either a
   `staff_level_key` with a `count`, or one salaried position's `position_key` with `count` 1 and
   `pay` `salary` or `hourly`. A rule says who coaches what; a salaried position can't be on two
   blocks at once.
3. **Give it RIBs and other equipment**, in `plan_block_resources`, by the rules, such as one RIB
   for every two coaches. Leave `hours` empty unless a rule says otherwise.
4. **Give it boats**, in `plan_block_boats`: the organization's boats of each class in `count`, and
   the boats sailors bring in `sailor_owned`, such as "about a third bring their own Optis". Enough
   seats means Σ (boats × the class's `sailors_per_boat`) is at least the block's sailors. A block
   whose activities don't use boats needs none.

Each row you write needs a new `id` and `key`, and the copy's `version_id`. A key field such as
`staff_level_key` takes the `key` of the row in the same Financial Plan's Operations Plan copy, not
its `id`. Set each activity's `block_id` to its block.

To rewrite a block, delete its `plan_block_staff`, `plan_block_resources` and `plan_block_boats`
rows and clear its activities' `block_id` before you delete the block itself: the database refuses
to delete a row another one still points at. When you re-allocate part of a plan, rewrite only the
blocks in that part.

## 4. Fix the warnings

Wait about a second after your last write, then read `plan_results.calculated_at` for the draft. Once
it's after your last write, read `plan_result_warnings` again. The hook works out a draft again a
moment after each change, so a burst of writes costs one run.

Fix each `allocation` warning you can within the rules: add staff, swap a boat class a rule allows
("the Harpoon can take up to 10 instead of Sailqubes"), or split a block in two. Stop when only
warnings you can't fix are left, such as a date that needs more Sailqubes than the organization has.
Leave `data` warnings for the planner, apart from saying what they are.

Don't change offerings, prices, activities' dates or times, or anything in the Operations Plan,
unless the planner asked you to.

## 5. Report

Write a short report in the draft's note (`version_sets.message`): what you changed, and which
warnings are left and why. Don't write which rule made which row anywhere else. Then tell the planner
the draft's name, and that they can:

- read its warnings and its program area pages in sail-team, and compare it with the plan it started
  from;
- keep it by saving it, and mark it active if it's the one to run;
- delete it, or tell you what to change.

Saving, marking active, and deleting are the planner's. Don't do them yourself.

## Check it

Every figure in a draft you try this skill on outside the planner's own plan is made up. Never copy a
plan's real figures into the repo, an issue, or a PR.
