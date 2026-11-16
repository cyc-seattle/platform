---
tags: [architecture, planning]
---

## Planning: engine

The planning engine calculates a plan's P&L for one year from the plan's rows in
[the planning schema](planning-schema.md). It's part of `@cyc-seattle/platform`, imported as
`@cyc-seattle/platform/planning`. It doesn't read from or save to the database: an app or an agent
loads the rows, calls `computePlan`, and shows the answer. The `frozen-plans` hook runs the engine
deployed with `backend` and stores each Financial Plan's results
([docs/planning-schema.md](planning-schema.md#a-financial-plans-results)): a draft's again after
each change to it, and a frozen one's when it's frozen. Each records which version of the engine
calculated it, and a new engine leaves a draft's as they were until it changes or someone asks for
them again. So an app reads a Financial Plan's P&L from its results, and needn't run the engine itself.

```ts
import { computePlan, perDay, perSailorDay } from "@cyc-seattle/platform/planning";

const { lines, pnl, organization, activities, positions, warnings } = computePlan(data);
```

`data` holds the catalog, the organization, and every row of the plans being calculated,
named as the schema names them, plus:

- `fiscal_year`, the plan year. Fiscal year 2027 ends in calendar year 2027 and starts in the
  organization's `fiscal_year_start_month`.
- `staff_roles` and `staff_levels`: the [staff levels](hr-schema.md), whose names the engine gives
  labor lines. A plan row names its level by `staff_level_id`, and the Operations Plan's
  `plan_staff_levels` gives each level's rate.
- `assets` and `boats`: the asset list, which says how many boats of each class, sailboats and
  powerboats, the organization has on each day.
- `plans`: the plans being calculated, so the engine can tell which plan each row is in.

Planners enter each of these in the plans ([docs/planning-schema.md](planning-schema.md)):

- `fiscal_year` and the organization are the Financial Plan's own `fiscal_year` and
  `organization_id`.
- The plans are the ones a Financial Plan holds: its Operations Plan and each of its Program
  Plans. A Program Plan's row that names an Operations Plan row by key means the row with that key
  in that Operations Plan.
- Each program's indirect cost rate is in its Program Plan's `plan_programs` row, and the shared
  costs are in the Operations Plan, so the organization's totals count every plan in the Financial Plan.
- The catalog is read as it is now. A frozen Financial Plan doesn't copy it, so recalculating an old
  one uses today's catalog.

It returns:

- `lines`: every cost and revenue line for the year, on its offering, product, program area, pool or
  the organization, by account. Amounts are positive cents, but for the credit when the indirect cost
  rates allocate more than the shared costs (see [Indirect costs](#indirect-costs)); the account's type
  says whether it's revenue or expense. Each has a `line_key`, and a `line_name` that says in plain words what it is.
  See [Line names](#line-names).
- `pnl`: each offering's revenue, costs by account, and net, then each product's and each program
  area's, which add up their offerings. Each also has its MTDC, enrollment, days and sailor-days.
  An offering's also has its `max_enrollment`, `allocation_holds` and `breakeven_enrollment`. See
  [A full program](#a-full-program).
  Last come each program area's terms. See [Terms](#terms).
- `bonuses`: each bonus owner's net and bonus in each term. See [Bonuses](#bonuses).
- `organization`: the organization's year. See [The organization's totals](#the-organizations-totals).
- `perDay(p)` and `perSailorDay(p)`: an offering's, product's or area's P&L for one day it runs, and
  for one sailor on one day.
- `activities`: each activity, with its block and its share of the block's staff and boats, the organization's and chartered.
- `positions`: each salaried position's year. See [Salaried positions](#salaried-positions).
- `capital`: the planned purchases in rank order. See [Capital](#capital).
- `warnings`: what breaks a limit, and anything the engine had to skip or couldn't price. See
  [Warnings](#warnings).

## Modelling over MCP

An AI working over Directus's MCP server can change a draft's rows but can't run the engine. It
doesn't need to. Change the draft's inputs, wait about a second, then read the draft's
`plan_results` and `plan_result_*` rows, filtered on its `financial_plan_id`. `plan_results.calculated_at`
says when they were worked out, so a time before the last change means they aren't in yet. A draft
with no `plan_results` row is still being worked out, or the engine failed on it. Anyone with a
Plan policy can read them.

## Terms

- **Pool:** a group of shared costs, such as general and administrative (G&A) costs or program
  admin, that no single offering owns.
- **Indirect cost rate:** the share of a program's fees it pays toward the shared costs, set for each
  program in the plan and fixed for the year. A program's indirect costs are its rate × its fees.
- **Program fees:** an offering's price × its enrollment, without the card fees families pay on top.
- **Non-program:** every offering whose product isn't a program, such as merchandise, storage and
  charters.
- **MTDC** (modified total direct costs): an offering's own costs, less a few kinds a federal grant
  rule leaves out.

## Order

1. **Activities.** The plan year's activities, with their paid time and time on the water.
2. **Blocks.** The engine costs each block's staff and boats, and checks them against
   the program settings and the fleet.
3. **Revenue**, with COGS and the charges set as a share of revenue.
4. **Lines.** Budget lines, capital items, labor lines and salaried positions. Costs on a product or area are divided among
   its offerings last, once every offering's own costs are in.
5. **Payroll taxes** on every wage and paid hour.
6. **Indirect costs**, each program's rate × its offerings' fees.
7. **Bonuses**, with their taxes on wages.

## Rules

### The plan year

- All of an offering's revenue and costs go in its plan's year, whatever its dates. A winter
  offering from December to March sits whole in one plan, normally the year most of its sessions
  fall in ([cyc-seattle/platform#252](https://github.com/cyc-seattle/platform/issues/252)). The
  organization books on a cash basis, so the books may record its fees and wages a year apart from
  the plan; budget-against-actuals tracking deals with that, not the plan.
- The engine checks coaches and boats only across the blocks of one Financial Plan, so a block in
  late December of one plan and a block in January of the next aren't checked against each other.
- Each staff level, salaried position and boat class has one rate for the year.
- Each cost the engine calculates (coach wages, salaries, payroll tax, coach boats (`ribs`), boat maintenance,
  boat charters (`resources`), travel and COGS) is recorded in the account set for it in
  `organization_cost_accounts`. If no account is set, the engine leaves that cost out and shows a
  warning.

### Activities

- An activity is paid from `start_time` to `end_time`, plus setup and put-away. One that ends before it
  starts runs past midnight.
- Time on the water is `on_water_minutes` if set, otherwise start to end. It's zero for travel days
  and for activities that don't use boats.
- An offering's days are the dates it has an activity other than travel. Its sailor-days are its
  enrollment × its days.
- The engine warns about an activity, other than a travel day, on one of the Operations Plan's
  `plan_closed_dates`. It still counts it. A closed day in a program area's plan is ignored, with a
  warning.

### Blocks

The engine never works out how many coaches or boats an activity needs: the planner, or their AI,
decides that from the program settings and the planner's notes, and writes it on the blocks
([cyc-seattle/platform#149](https://github.com/cyc-seattle/platform/issues/149)). A block costs
everything it's given, however many sailors are expected
([cyc-seattle/platform#287](https://github.com/cyc-seattle/platform/issues/287)). The checks make
sure the organization has the boats for every offering to run full; it can always hire more
coaches ([cyc-seattle/platform#294](https://github.com/cyc-seattle/platform/issues/294)).

- Enrollment, the sailors expected, is a whole number of kids: `target_enrollment`, or none when it's
  empty. Kids who join or leave partway through aren't counted. Revenue and
  every cost set per sailor use it, and it splits a block's costs.
- An offering's most sailors, its max enrollment, is its `capacity`, or its enrollment when it has
  none. The checks use it.
- A block's paid time runs from its first activity's start to its last one's end, plus the longest
  setup and the longest put-away among them. A block with an activity that has no times has no paid
  time.
- Its time on the water is the longest `on_water_minutes` its activities set. If none sets one, it's
  the span of its activities that use boats.
- Each of its costs is split among its offerings by their enrollment, each offering counted once, or
  evenly if none has any. An offering with several activities in the block splits its share among
  them. `activities` gives each activity its share of the block's staff and boats, the organization's and chartered.
- Staff at a level cost `count` × paid hours × the level's `hourly_rate_cents`. Volunteers cost
  nothing.
- A salaried position on a block with `pay` `salary`, the default, is charged its paid hours at the
  salary's hourly equivalent (see [Salaried positions](#salaried-positions)). With `hourly`, it's paid
  by the hour, on top of the salary, at its own `hourly_coaching_rate_cents`. With no rate of its own,
  those hours cost nothing, and the engine warns.
- The organization's boats cost `count` × time on the water × their class's
  (`fuel_per_hour_cents` + `maintenance_per_boat_hour_cents`), booked to the class's `account_id`,
  such as Coach boats for RIBs, or else to boat maintenance. Boats sailors bring (`sailor_owned`)
  cost nothing.
- Chartered boats cost their class's `charter_per_day_cents` once a day: for the most of the class
  chartered at once that day, shared among the blocks that
  charter them by how many each does. A RIB chartered for a morning block and an afternoon one is
  one day. A charter is a rental, so it's left out of MTDC, and it's booked to boat charters
  (`resources`). With no charter rate, it costs nothing, and the engine warns (`no_charter_rate`).
- A trip costs each coach's airfare, plus `nights` × the year's lodging rate for each coach, plus
  `miles` × the year's mileage rate once. Its coaches are the staff on its block on its busiest
  travel day. With no staff there, it charges only the miles, and the engine warns. Sailors' own
  travel isn't charged.

### A full program

- An offering's `allocation_holds` is the most sailors its blocks' boats can seat: on each of its
  blocks whose activities use boats, with every other offering in the block at its max, the block's
  seats − the others' Σ max, at least 0. A block's seats are Σ (boats, the organization's, chartered
  and the sailors' own, × the class's `max_capacity`); a coach boat's class takes 0. Coaches don't
  limit it, since more can always be hired. It's the fewest over its blocks, and null when none of
  them use boats. It can be more than the max enrollment.
- Its `breakeven_enrollment` is the fewest sailors, from 1 up to its `capacity`, at which its net after
  indirect costs is zero or more. The engine recalculates only the offering's slice: it, its
  activities, trips and own lines, and its blocks with the activities that share them, less its
  program's indirect cost rate × its fees at n sailors. Its net at n sailors is the slice's net at n, plus
  its planned net less the slice's net at its enrollment, so bonuses and anything else outside the
  slice stay as planned. Each number is tried in turn, since costs set per sailor can step. It's null when the
  offering doesn't cover its costs even when full, or has no `capacity`.
- An offering with a `capacity` gets a data warning, naming it in `key`, when its
  `breakeven_enrollment` is more than its enrollment (`breakeven_above_target`), or null
  (`never_breaks_even`).

### Warnings

Each warning has a `code`, a `message`, and a `category`. When it's about one plan or one date,
it names them in `plan_id` and `date`. Its `severity` is `error` when the plan can't run as allocated
for the sailors expected, and otherwise `warning`, such as too few boats if every offering fills
(cyc-seattle/platform#313). A warning about a row that's given once for each plan, such as a program with no settings, names the first date it's seen on. `allocation` warnings say the blocks break a limit or run on
a closed day; the rest are `data`, a row that's missing or wrong. The engine still costs what it's
given.

A message gives only the detail, in a few plain words, since the warning already gives its plan and
date, and Sail Team names each code: "Guppies Week 2 and Opti Camp Week 2 need 12 Sailqubes when
full. CSC has 10.", or "9 Sailqubes out for Guppies Week 4. CSC has 8.". One about a block names the
block's offerings. A message names an offering by its program, then its own name, which is only what it adds to the
program, such as Week 4; one whose own name already starts with its program keeps it. Each sentence ends with a period.
Messages follow the `ui-copy` skill from
[`cyc-seattle/agent-skills`](https://github.com/cyc-seattle/agent-skills).

Allocation warnings:

- `over_inventory_boats`: more of the organization's boats of one class out at once on a date than
  the boats of that class, sail or power, it has that day: those on the asset list acquired on or
  before it, or with no acquired date, and not yet disposed of. Every class with a `max_capacity` of
  0, such as a RIB or a support boat, is a coach boat, and coach boats are counted together, since
  any can stand in for another. A sailboat class out beyond what the organization has is covered by spare
  boats of another class that every program in the block can sail, its catalog program's `boat_classes`:
  those the organization has that day, less the most of them out at once that day, and less those
  already standing in. Each seats its own `max_capacity`, a block lends out no more seats than its own
  boats of the class take, and the block still pays for the class it's given. Boats it charters, or sailors bring,
  don't count. Blocks are out
  from their first activity's start to their last one's end; one with no times is out all day.
- Results frozen before boats were counted by class may also have `over_inventory_resource`, for
  RIBs and other equipment.
- Results worked out before cyc-seattle/platform#313 may have `unallocated_activity`, for an activity
  with no staff. The engine no longer checks it: a program such as open boating runs without staff.
- `short_of_boats`: too few of the organization's boats of one class, or coach boats, on a date
  for every offering to run full, when the boats given aren't already more than it has
  (`over_inventory_boats`). It's an error when they're too few even for the sailors expected: each
  offering's enrollment in place of its max. For each block whose activities use boats, with every
  offering at its max enrollment:
  - Its sailboats, the classes with a `max_capacity` above 0, are the organization's it's given. If
    their seats, with the chartered ones and the boats sailors bring, are fewer than its sailors, the
    seats it's short come in the fewest more boats: of the class it's given that seats the most, and
    of those, the one it's given most of. Seats count across classes, so a block with a Harpoon and a
    Venture that's 4 short needs 1 more Harpoon, not 1 more of each (cyc-seattle/platform#313).
  - It needs a coach boat for each coach a full program needs: Σ (each program's max ÷ its
    `sailors_per_coach`), rounded up. If that's more than the coach boats it's given, the rest are
    of the coach boat class it's given most of. A block given no coach boats needs none, and a
    program with no settings adds no coaches.
  - Charters stay as given, so the organization's own boats make up the rest.

  The most of a class the blocks need at once on a date, counted as for `over_inventory_boats`, is
  checked against the boats of that class the organization has that day. Spare boats of a class its programs can sail
  stand in, as for `over_inventory_boats`, counted against the most of them needed at once. A class it has none of
  that day isn't checked, since it can charter more. Coaches aren't checked: the organization can
  always hire more. Qualifications aren't checked either (#208).

- Results frozen before cyc-seattle/platform#294 may have `over_capacity`, for a block whose coaches
  or boats were too few for every offering at its max.
- Results frozen before cyc-seattle/platform#318 may have `no_program_settings`, for a program in a
  block with no staff level or sailors per coach.
- `capacity_below_max`: an offering whose blocks take fewer sailors (`allocation_holds`) than its
  max enrollment. It's an error when they take fewer than its enrollment. It names the offering in
  `key`, and no date.
- `position_double_booked`: a salaried position on two blocks whose times overlap.
- `closed_date`: an activity, other than a travel day, on a closed day.

Data warnings about blocks:

- `no_max_capacity`: a block's boat class with no `max_capacity`. Its boats take no sailors and
  aren't scaled.
- `no_charter_rate`: a block's chartered boats, whose class has no `charter_per_day_cents`.
  Results frozen before it was renamed call it `no_sailors_per_boat`, and may also have
  `no_fleet_quantity`, which the engine no longer gives.
- `unknown_staff_level`: a block's staff, or a labor line, at a staff level with no rate in the
  Operations Plan. They cost nothing.
- `no_hourly_rate`, `trip_without_staff`, `unknown_block`,
  and `block_date_mismatch`, an activity in a block on another date.

### Revenue

- An offering's revenue is its `price_cents` × its enrollment.
- COGS is `cogs_rate` × revenue.
- A product in a program area books its revenue to the area's account, and one in no area to its
  own. If a product in an area has its own account, and it differs, the engine warns.
- Each of the Operations Plan's `plan_revenue_charges` applies to every offering whose product is one
  of its `product_kinds`: its `rate` × the offering's revenue (price × enrollment), booked to its
  account on the offering. A charge on a revenue account adds revenue, such as the card fees families
  pay. One on an expense account adds a cost, such as scholarships or the card company's fees.
  Charges are figured on revenue before any other charge.
- A charge counts toward MTDC when it's `in_mtdc`, the default.

### Budget and labor lines

- A budget line counts only in its `fiscal_year`. Equipment is a cost in the year it's bought.
- A labor line costs its hours × its staff level's rate, and is a wage. A volunteer's rate is $0.
- A cost on a product, or on a program area, is divided among its offerings that year by MTDC. If it
  has no offerings that year, the cost stays where it is and the engine shows a warning.
- A budget line on an asset account is capital. It's the organization's, so a capital line on an
  offering, product, area or pool is moved to the organization, with a warning.

### Capital

Capital is something lasting the organization buys, such as a coach boat. Planners list it in the
Operations Plan's `plan_capital_items`, each with its `sort`, its rank: 1 is the most needed.

- Each item is a line on its asset account, on the organization, keyed `capital:<item key>`. It
  never reaches a program area or an offering, and never counts toward MTDC. An item on any other
  kind of account is left out, with a warning (`capital_not_asset`).
- `capital` lists the items by `sort`, then name, with an item with no `sort` last. Each has its
  rank, its amount, its running total (its amount and every item's above it), and whether it's
  covered: whether the operating net plus the fundraising net is at least its running total. So
  the money left after the year's operations and fundraising buys the items in rank order, as far
  as it goes.
- Capital entered as a budget line on an asset account has no rank. It comes after the items, by
  name, with a warning (`capital_unranked`).

### Program areas and plans

The engine warns about:

- a program with no program area, or another kind of product with one
- an offering in an area plan whose product is in another area, and an offering in the Operations
  Plan whose product is in an area
- a line in a Program Plan that moves a cost off the area's programs (`cost_off_programs`): one left
  out of MTDC, one charged to a pool or to the organization, or capital charged to the organization
  (capital charged anywhere else has `capital_off_org`). A Plan Admin looks these over
  before making a plan active (cyc-seattle/platform#251). The Operations Plan's lines never get
  one, and the engine costs the line as it's given.

### Salaried positions

- A position costs its `annual_salary_cents`.
- Its hourly rate is `annual_salary_cents / paid_hours_per_year`. The hours it spends coaching on a
  block out of its salary, and its `plan_salaried_bookings` hours, are charged at that rate to the offerings
  or products they were for. A booking names a product or a program area, whose offerings share it
  by MTDC. A booking that names both, or neither, is left out with a warning.
- First, the `ga_share` part of the salary goes to G&A. If the hours charged to programs add up to
  more than what's left, the engine scales them down and shows a warning.
- The rest of the salary, including the `ga_share` part, goes to the position's `remainder_pool_id`
  pool, or to the organization if it has none.

`positions` gives each position's year:

- its salary
- the hours it coached out of its salary, and what they charged
- the hours it coached by the hour, and their wages
- its booking hours, and what they charged
- the bonuses that name it in `position_key`
- its total pay: salary, hourly wages and bonus
- the year's payroll taxes: each tax on wages on that total, and each tax by the hour on its paid hours
  per year and its hours coached by the hour
- its double-booked hours: the hours another coach would need while it's on two or more blocks at
  once. At each moment it's on n blocks, it counts n − 1, so three blocks at once for 3 hours count 6.
  It uses each block's start-to-end time, without setup or put-away. A block with no times adds no
  hours.
- its double-booked dates: the dates it's warned about

### Payroll tax

The Operations Plan lists each payroll tax in `plan_payroll_taxes`, charged the way it's collected.
Each is booked as its own line, named for it, wherever the wage is:

- A tax on wages is its `wage_share` × every wage: hourly coaches, labor lines, salaries and bonuses.
- A tax by the hour, such as Washington's L&I, is its `hourly_cents` × every paid hour: each hour
  of an hourly coach or a labor line paid more than $0, and a salaried position's
  `paid_hours_per_year`, split like its salary. A volunteer's hours and a bonus carry none. The
  engine warns about a salaried position with no paid hours, since none is charged on its salary.
- A tax that sets both, or neither, is left out, with a warning.
- No tax stops at a yearly cap on each person's wages, such as Social Security's. The engine charges
  one L&I rate for every hour, as for one risk class.

A draft gets Social Security (6.2%), Medicare (1.45%), WA unemployment (0.27%) and L&I ($0.45235 an
hour). A Financial Plan frozen before each tax had its own row has one "Payroll tax", its old rate
on wages.

### MTDC

MTDC follows the federal grant rule
[2 CFR 200.1](https://www.ecfr.gov/current/title-2/section-200.1), as revised in 2024. It counts
salaries and wages, fringe benefits, materials and supplies, services, travel, and the first $50,000
of each subaward. It leaves out equipment, capital spending, rent and rentals, participant support,
scholarships and fellowships, tuition remission, patient care, and each subaward over $50,000.

- A budget line with `in_mtdc` cleared is left out, and so is a boat charter. Clear it for any cost the rule
  leaves out. Equipment means an item that costs $10,000 or more and lasts more than a year; anything
  cheaper is a supply, and counts.
- Every other cost of the offering's own counts, including COGS and payroll tax.
- Indirect costs and bonuses never count.

### Indirect costs

Each program pays a fixed rate on its own fees toward the shared costs, so one program's year never
changes another's indirect costs, or its director's bonus
([cyc-seattle/platform#296](https://github.com/cyc-seattle/platform/issues/296)). The rate is on
revenue, not costs, because a director's bonus is a share of revenue too.

- The shared costs are everything in every pool.
- A program's offering's indirect costs are its program's `indirect_cost_rate`, in its
  `plan_programs` row, × the offering's fees: its price × its enrollment. The card fees families pay
  on top don't count. A program with no rate pays none, and the engine warns
  (`no_indirect_cost_rate`). Only a Plan Admin sets the rate.
- The indirect costs are split over the pools' lines by their size, keeping each line's account and
  function, keyed `pool:<pool key>:<the original line key>`. So a program's P&L shows its indirect
  costs by pool and account.
- What the rates leave unallocated of each pooled line stays on the organization's books, keyed
  `unrecovered:<pool key>:<the original line key>`. When the rates allocate more than the shared
  costs, it's a credit there. Either way the organization's net is the same whatever the rates.
- Non-program's offerings pay no indirect costs, so their P&L shows their own margin, and it stays
  with the organization.
- With no shared costs, no program pays its rate, and the engine warns (`no_shared_costs`).
- Results calculated before the rates spread the pools by MTDC, after non-program's net offset them;
  their `offset:` lines are the part non-program's net covered. Results calculated after the rates
  came in, but before they were on fees, charged each rate on the offering's MTDC.

### Terms

- An offering's term is the `plan_terms` row its `term_key` names. One the plan doesn't have counts
  as no term, with a warning.
- Each program area has a P&L, at level `program_area_term`, for each term it has an offering in,
  in the order the terms start, and one more, with `term_key` null, for its offerings in no term.
  Together they add up to the area's P&L.
- A term's P&L adds up its offerings'. Costs on a product or the area, and indirect costs, already reach
  the offerings, so a term has its share of them.
- A cost left on a product or the area, because it had no offerings that year, is in no term.

### Bonuses

- A bonus is paid per term. In each term its products have an offering in, a bonus owner earns
  `bonus_rate` × the net of those offerings, if it's above zero. A term's loss doesn't lower
  another term's bonus.
- Its products' offerings in no term make one more net, for the year, with anything booked on
  the products themselves.
- `basis` `after_shared_costs`, the default, counts each offering's indirect costs;
  `before_shared_costs` doesn't.
- No bonus counts in any bonus's base.
- Each term's bonus is divided among that term's offerings by revenue. If none has revenue,
  they share it evenly; if there are none, it's left out. Either way the engine warns.
- `bonuses` has a row for each owner and term: the net, which can be below zero, and the bonus.
  Its `program_area_id` is the area of all the owner's products, or null when they're in more than
  one.
- Each tax on wages × the bonus is booked on the same offerings. A bonus pays for no hours, so no tax
  by the hour is charged on it.
- Neither the bonus nor its tax counts in MTDC.
- A bonus owner in a program area's plan counts only that area's products. The engine warns about
  any other, and leaves it out.

### Function

Each line's `function` is `program`, `management` or `fundraising`:

- a line's own `function` wins
- a cost charged to an offering, a product or a program area is `program`, whatever its account's
  `default_function`, so coach wages and their payroll tax on an offering count in its program costs
- any other cost, on a pool or the organization, takes its account's `default_function`, or
  `management` without one
- revenue takes its account's `default_function`, or none
- indirect costs keep the function of the pooled line they're split over, so a G&A share stays
  `management`

A frozen Financial Plan keeps the functions it was calculated with.

### Line names

Each line's `line_name` says what it is:

- revenue is "Revenue", COGS "Cost of goods sold", and a revenue charge its own name
- coaches' wages are "Coach wages", the organization's boats "Boats: <boat class>", and charters
  "Boat charters: <boat class>"
- a trip, a budget line or a labor line has its own name
- a salaried position's hours are "<position>: coaching" or "<position>: management", and the rest
  of its salary "<position>: rest of salary"
- each payroll tax is its own name, such as "Social Security" or "L&I"
- a bonus is "Bonus: <role>", and each tax on it "<tax> on bonus: <role>"
- an offering's indirect costs are "<pool> share: <the pooled line>", such as "G&A share: Medicare"
- what the rates leave unallocated on the organization is "<pool> unallocated: <the pooled line>", or
  "<pool> over-allocated: <the pooled line>" when they allocate more

### The organization's totals

Operating revenue pays for operating costs, and fundraising pays for capital. `organization` adds up
every line:

- **Capital** is every line on an asset account, such as buying a coach boat.
- **Fundraising** is revenue and expense whose function is `fundraising` (see [Function](#function)).
  Give donation and grant accounts the `fundraising` default.
- **Operating** is every other revenue and expense.

It gives operating revenue, expenses and net, then fundraising's, then capital, then the total:
operating net plus fundraising net, less capital.

Its `indirect` gives the shared costs (`shared_cents`), what the indirect cost rates allocate of them
(`recovered_cents`), and what they leave unallocated (`unrecovered_cents`, below zero when
over-allocated). Its `full_recovery_rate` is the shared costs ÷ every program's offerings' fees: the
one rate that would allocate them all. A Plan Admin sets next year's rates from
it.
