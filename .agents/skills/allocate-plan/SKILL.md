---
name: allocate-plan
description: Fill in a Financial Plan's blocks with their staff and boats, coach boats included, in a new draft, following the program settings and the planner's notes, then fix what the engine warns about. Use when a planner asks to allocate, staff, or re-allocate a plan or part of one, such as "allocate the 2027 plan" or "re-allocate Summer weeks 3 to 5".
---

# Allocate a Financial Plan

A planner's Financial Plan holds offerings and their activities. The engine prices only what each
block is given. A block is one or more activities on one date that share their staff and boats,
such as Guppies and Minnows on the morning of July 13. You decide the blocks and what each one gets,
from the program settings and the planner's notes. The engine then warns where a block breaks a
limit, and you fix what you can.

`docs/planning-schema.md` describes every collection named here, and `docs/planning-engine.md`
says how the engine costs blocks and what each warning means. Read both first.

You work as the planner, with their Plan Writer policy, which changes Program Plans in a draft but not
the Operations Plan, through the Directus MCP tools
(`mcp__directus__*`). If the tools need auth, run their `authenticate` tool first. Never use an
admin account or SQL.

## 1. Start a draft of your own

Ask the planner which Financial Plan to start from, and whether to allocate all of it or part of it,
such as one program area or some weeks.

1. Create a `financial_plans` row for the same `organization_id` and `fiscal_year`, with `parent_id` set
   to that Financial Plan, `status` `draft`, and a name that says it's yours, such as
   "2027 allocations, Nov 9". The planner's own Financial Plan stays as it is.
2. The hook copies the parent's plans into it a moment later. Read the `plans` whose
   `financial_plan_id` is the draft's until they're there, and note each one's `id`, `kind` and
   `program_area_id`. Every row you read or write from here on is in one of those plans.

## 2. Read the plan

From the Operations Plan:

- `plan_staff_levels`: each level's `key`, name and pay.
- `plan_salaried_positions`: each position's `key`, name and `hourly_coaching_rate_cents`.
- `plan_boat_rates`: which boat classes have a charter rate, for boats the organization doesn't have.
- Each boat class's `max_capacity` from `boat_classes`. A coach boat's class, such as RIB, takes 0.

From the catalog's asset list, how many boats of each class, sail or power, the organization has on
each day: the `boats` of that class whose asset counts from its `acquired_on`, or from the start when
it's empty, until its `disposed_on`.

- `plan_closed_dates`.
- The plan's own `notes` (`plans.notes`): the planner's notes for the whole organization.

From each Program Plan:

- `plan_programs`: each program's `staff_level_key`, `sailors_per_coach` and `notes`. Leave its
  `indirect_cost_rate` as it is: only a Plan Admin sets it.
- The plan's own `notes`: the planner's notes for the program area.
- `plan_offerings` with their most sailors (`capacity`, or the expected enrollment when it's empty)
  and their expected enrollment (`target_enrollment`),
  `plan_activities` with their dates and times, `plan_trips`, and any blocks already there:
  `plan_activity_blocks`, `plan_block_staff`, `plan_block_boats`.

Then read the draft's warnings: `plan_result_warnings` filtered on the draft's `financial_plan_id`.

Read the notes as a list of what the planner wants. A note is the planner's own words, so when one is
unclear, or two disagree, ask the planner rather than guess.

## 3. Write the blocks

Allocate for each offering's most sailors, not the number expected: a block holds what a full
program would use, so the checks pass with every offering full. The P&L costs every coach and boat a
block is given, so give a block no more than a full program needs.

For each date, in the part of the plan you're allocating:

1. **Group the activities into blocks**, by the notes. An activity that shares nothing is a block of
   one. A note such as "J-Pod and K-Pod share coaches on Wednesdays" puts those activities in one
   block on each Wednesday. Every activity other than a travel day needs a block with staff, and a
   travel day needs one if its trip's coaches fly or stay. A block's activities are all in one
   Program Plan.
2. **Give each block its staff**, in `plan_block_staff`. Start from each program's
   `sailors_per_coach`: a block of several programs needs Σ (a program's sailors ÷ its sailors per
   coach) staff, rounded up, at the program's own staff level, since a plan doesn't count on a
   higher level covering a lower one. A salaried position on the block counts as one coach for any
   of its programs. Then apply the
   notes, such as "if there are more than 12 Guppies, add a Junior Instructor". A row is either a
   `staff_level_key` with a `count`, or one salaried position's `position_key` with `count` 1 and
   `pay` `salary` or `hourly`. A note says who coaches what; a salaried position can't be on two
   blocks at once.
3. **Give it coach boats**, in `plan_block_boats` with their class, such as RIB, by the notes, such
   as one coach boat for every two coaches.
4. **Give it boats**, in `plan_block_boats`: the organization's boats of each class in `count`, the
   ones it charters in `chartered`, and the boats sailors bring in `sailor_owned`, such as "about a
   third bring their own Optis". Charter only when the notes say so, or the organization has too
   few that day. Enough seats means Σ (boats × the class's `max_capacity`) is at least the block's
   sailors. A block whose activities don't use boats needs none.

Each row you write needs a new `id` and `key`, and its plan's `id` as `plan_id`. A key field such as
`staff_level_key` takes the `key` of the row in the same Financial Plan's Operations Plan, not
its `id`. Set each activity's `block_id` to its block.

To rewrite a block, delete its `plan_block_staff` and `plan_block_boats`
rows and clear its activities' `block_id` before you delete the block itself: the database refuses
to delete a row another one still points at. When you re-allocate part of a plan, rewrite only the
blocks in that part.

## 4. Fix the warnings

Wait about a second after your last write, then read `plan_results.calculated_at` for the draft. Once
it's after your last write, read `plan_result_warnings` again. The hook works out a draft again a
moment after each change, so a burst of writes costs one run.

Fix each `allocation` warning you can within the notes: add staff, swap a boat class a note allows
("the Harpoon can take up to 10 instead of Sailqubes"), or split a block in two. Stop when only
warnings you can't fix are left, such as a date that needs more Sailqubes than the organization has.
Leave `data` warnings for the planner, apart from saying what they are.

Don't change offerings, prices, activities' dates or times, or anything in the Operations Plan,
unless the planner asked you to.

## 5. Report

Set the draft's note (`financial_plans.note`) to one short line, at most about 120 characters, that
says what you did, such as "Allocated Summer weeks 3 to 5. 2 warnings left". It's a comment people
read beside the plan's name in sail-team, not a report, so write it with the `ui-copy` skill from
[`cyc-seattle/agent-skills`](https://github.com/cyc-seattle/agent-skills). Never put the report in it.

Give the planner the report in the conversation: what you changed, and which warnings are left and
why. If they want it in a file too, write it where they say. Don't write which note made which row
anywhere else. Then tell the planner the draft's name, and that they can:

- read its warnings and its program area pages in sail-team, and compare it with the plan it started
  from;
- keep it, and ask a Plan Admin to save it, or make it active from a date, if it's the one
  to run;
- delete it, or tell you what to change.

Deleting is the planner's, and saving and making active a Plan Admin's. Don't do them
yourself.

## Check it

Every figure in a draft you try this skill on outside the planner's own plan is made up. Never copy a
plan's real figures into the repo, an issue, or a PR.
