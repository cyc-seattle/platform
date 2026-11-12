---
tags: [architecture, planning]
---

## Planning: engine

The planning engine calculates a plan's P&L for one year from the plan's rows in
[the planning schema](planning-schema.md). It's part of `@cyc-seattle/platform`, imported as
`@cyc-seattle/platform/planning`. It doesn't read from or save to the database: an app or an agent
loads the rows, calls `computePlan`, and shows the answer. The `saved-versions` hook runs the engine
deployed with `backend` and stores each Financial Plan's results
([docs/planning-schema.md](planning-schema.md#a-financial-plans-results)): a draft's again after
each change to it, and a saved one's when it's saved, with which version of the engine calculated
them. So an app reads a Financial Plan's P&L from its results, and needn't run the engine itself.

```ts
import { computePlan, perDay, perSailorDay } from "@cyc-seattle/platform/planning";

const { lines, pnl, organization, activities, positions, warnings } = computePlan(data);
```

`data` holds the catalog, the organization, and every row of the plan copies being calculated,
named as the schema names them, plus:

- `fiscal_year`, the plan year. Fiscal year 2027 ends in calendar year 2027 and starts in the
  organization's `fiscal_year_start_month`.
- `rib_resource_kind_id`: which resource kind is RIBs. The engine uses those resources' rates to cost
  each RIB hour.
- `plans` and `plan_versions`: the plans being calculated and their copies, so the engine can tell
  which plan each offering is in.

Planners enter each of these in the plans ([docs/planning-schema.md](planning-schema.md)):

- `fiscal_year` and the organization are the Financial Plan's own `fiscal_year` and
  `organization_id`.
- The plan copies are the ones a Financial Plan holds: its Operations Plan and each of its Program
  Plans. A Program Plan's row that names an Operations Plan row by key means the row with that key
  in that Operations Plan copy.
- Every pool is divided among all of the Financial Plan's programs' offerings, after non-program's
  net offsets it, so each Program Plan's share of the pools, and the organization's totals, count
  every plan in it.
- `rib_resource_kind_id` is in that Operations Plan copy's `plan_rates`.
- The catalog is read as it is now. A saved Financial Plan doesn't copy it, so recalculating an old
  one uses today's catalog.

It returns:

- `lines`: every cost and revenue line for the year, on its offering, product, program area, pool or
  the organization, by account. Amounts are positive cents, but for the credit when non-program
  loses money (see [Pools](#pools)); the account's type says whether it's revenue or expense. Each has a `line_key`, and a `line_name` that says in plain words what it is.
  See [Line names](#line-names).
- `pnl`: each offering's revenue, costs by account, and net, then each product's and each program
  area's, which add up their offerings. Each also has its MTDC, enrollment, days and sailor-days.
- `organization`: the organization's year. See [The organization's totals](#the-organizations-totals).
- `perDay(p)` and `perSailorDay(p)`: an offering's, product's or area's P&L for one day it runs, and
  for one sailor on one day.
- `activities`: each activity, with its block and its share of the block's staff, RIBs and boats.
- `positions`: each salaried position's year. See [Salaried positions](#salaried-positions).
- `capital`: the planned purchases in rank order. See [Capital](#capital).
- `warnings`: what breaks a limit, and anything the engine had to skip or couldn't price. See
  [Warnings](#warnings).

## Modelling over MCP

An AI working over Directus's MCP server can change a draft's rows but can't run the engine. It
doesn't need to. Change the draft's inputs, wait about a second, then read the draft's
`plan_results` and `plan_result_*` rows, filtered on its `version_set_id`. `plan_results.calculated_at`
says when they were worked out, so a time before the last change means they aren't in yet. A draft
with no `plan_results` row is still being worked out, or the engine failed on it. Plan Readers and
Plan Writers can read them.

## Terms

- **Pool:** a group of shared costs, such as general and administrative (G&A) costs or program
  admin, that no single offering owns. The engine divides each pool among the programs' offerings.
- **Non-program:** every offering whose product isn't a program, such as merchandise, storage and
  charters.
- **MTDC** (modified total direct costs): an offering's own costs, less a few kinds a federal grant
  rule leaves out. Shared costs are divided among offerings by MTDC: an offering with twice the MTDC
  takes twice the share.

## Order

1. **Activities.** The plan year's activities, with their paid time and time on the water.
2. **Blocks.** The engine costs each block's staff, RIBs, boats and resources, and checks them against
   the program settings and the fleet.
3. **Revenue**, with COGS and the charges set as a share of revenue.
4. **Lines.** Budget lines, capital items, labor lines and salaried positions. Costs on a product or area are divided among
   its offerings last, once every offering's own costs are in.
5. **Payroll tax** on every wage.
6. **Pools**, divided among the offerings.
7. **Bonuses**, with their payroll tax.

## Rules

### The plan year

- All of an offering's revenue and costs go in the plan year it starts in, even if it runs into the
  next year.
- Each staff level, salaried position, resource and boat rate has one rate for the year.
- Each cost the engine calculates (coach wages, salaries, payroll tax, RIBs, boat maintenance,
  resources, travel and COGS) is recorded in the account set for it in
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

The engine costs only what each block is given. It never works out how many coaches, RIBs or boats an
activity needs: the planner, or their AI, decides that from the program settings and the rules, and
writes it on the blocks ([cyc-seattle/platform#149](https://github.com/cyc-seattle/platform/issues/149)).

- Enrollment is a whole number of kids: `target_enrollment` if set, otherwise `capacity × fill_rate`
  rounded. Kids who join or leave partway through aren't counted.
- A block's paid time runs from its first activity's start to its last one's end, plus the longest
  setup and the longest put-away among them. A block with an activity that has no times has no paid
  time.
- Its time on the water is the longest `on_water_minutes` its activities set. If none sets one, it's
  the span of its activities that use boats.
- Each of its costs is split among its offerings by their enrollment, each offering counted once, or
  evenly if none has any. An offering with several activities in the block splits its share among
  them. `activities` gives each activity its share of the block's staff, RIBs and boats.
- Staff at a level cost `count` × paid hours × the level's `hourly_rate_cents`. Volunteers cost
  nothing.
- A salaried position on a block with `pay` `salary`, the default, is charged its paid hours at the
  salary's hourly equivalent (see [Salaried positions](#salaried-positions)). With `hourly`, it's paid
  by the hour, on top of the salary, at its own `hourly_coaching_rate_cents`. With no rate of its own,
  those hours cost nothing, and the engine warns.
- A resource costs `quantity × (hours × (cost_per_hour + fuel_per_hour + maintenance_per_hour) +
cost_per_day)`. Its hours are its row's `hours` if set; otherwise a RIB's are the block's time on the
  water, and any other resource's are its paid time. A RIB is a resource of the `rib_resource_kind_id`
  kind. One `excluded_from_mtdc`, such as a rental, stays out of MTDC.
- The organization's boats cost `count` × time on the water × their class's
  `maintenance_per_boat_hour_cents`. Boats sailors bring (`sailor_owned`) cost nothing.
- A trip costs each coach's airfare, plus `nights` × the year's lodging rate for each coach, plus
  `miles` × the year's mileage rate once. Its coaches are the staff on the block of its busiest
  travel day. With none, it charges only the miles, and the engine warns. Sailors' own travel isn't
  charged.

### Warnings

Each warning has a `code`, a `message`, and a `category`. When it's about one plan copy or one date,
it names them in `version_id` and `date`. A warning about a row that's given once for each plan
copy, such as a program with no settings, names the first date it's seen on. `allocation` warnings say the blocks break a limit or run on
a closed day; the rest are `data`, a row that's missing or wrong. The engine still costs what it's
given.

A message says only what's wrong, in plain words, since the warning already gives its plan and date:
"Guppies Week 2 and Opti Camp Week 2 have 23 sailors, but enough coaches for only 17", or
"9 Sailqubes out at once for Guppies Week 4, but CSC has only 8". One about a block names the block's
offerings. Messages follow the `ui-copy` skill from
[`cyc-seattle/agent-skills`](https://github.com/cyc-seattle/agent-skills).

Allocation warnings:

- `unallocated_activity`: an activity, other than a travel day, in no block, or in a block with no
  staff.
- `over_inventory_boats`: more of the organization's boats of one class out at once on a date than its
  `plan_boat_rates.quantity`. Boats sailors bring don't count. Blocks are out from their first
  activity's start to their last one's end; one with no times is out all day.
- `over_inventory_resource`: the same for a resource with a `quantity`, such as RIBs.
- `over_capacity`: more sailors in a block than its staff, or its boats, can safely take. Each
  program's sailors count against its own `sailors_per_coach`, in its `plan_programs` row, and need
  coaches at its own `staff_level_key`: each level needs Σ (its programs' sailors ÷ their sailors per
  coach). A staff-level row counts only toward its own level. A salaried position on the block counts
  as one coach toward any level's shortfall, since the plan trusts the planner's allocation. The
  block is over when the coaches it needs are more than the ones that count. Qualifications aren't
  checked (#208). Its boats take Σ (boats, the organization's and the sailors' own, × the
  class's `sailors_per_boat`). A block whose activities don't use boats has no boat limit.
- `position_double_booked`: a salaried position on two blocks whose times overlap.
- `closed_date`: an activity, other than a travel day, on a closed day.

Data warnings about blocks:

- `no_program_settings`: a program in a block with no staff level or sailors per coach. Its sailors
  aren't checked against the staff.
- `no_sailors_per_boat`: a block's boat class with no `sailors_per_boat`. Its boats take no sailors.
- `no_fleet_quantity`: a block's boat class with no `plan_boat_rates.quantity`. Its boats aren't
  checked against the fleet.
- `no_hourly_rate`, `trip_without_staff`, `unknown_block`, `unknown_staff_level`, `unknown_resource`,
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
- A charge counts toward MTDC unless it's `excluded_from_mtdc`.

### Budget and labor lines

- A budget line counts only in its `fiscal_year`. Equipment is a cost in the year it's bought.
- A labor line costs its hours × its staff level's rate, and is a wage.
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
- the year's payroll tax on that total
- its double-booked hours: the hours another coach would need while it's on two or more blocks at
  once. At each moment it's on n blocks, it counts n − 1, so three blocks at once for 3 hours count 6.
  It uses each block's start-to-end time, without setup or put-away. A block with no times adds no
  hours.
- its double-booked dates: the dates it's warned about

### Payroll tax

Payroll tax is the year's `payroll_tax_rate` × every wage (hourly coaches, labor lines and salaries),
charged wherever the wage is.

### MTDC

MTDC follows the federal grant rule
[2 CFR 200.1](https://www.ecfr.gov/current/title-2/section-200.1), as revised in 2024. It counts
salaries and wages, fringe benefits, materials and supplies, services, travel, and the first $50,000
of each subaward. It leaves out equipment, capital spending, rent and rentals, participant support,
scholarships and fellowships, tuition remission, patient care, and each subaward over $50,000.

- A budget line or resource with `excluded_from_mtdc` set is left out. Set it for any cost the rule
  leaves out. Equipment means an item that costs $10,000 or more and lasts more than a year; anything
  cheaper is a supply, and counts.
- Every other cost of the offering's own counts, including COGS and payroll tax.
- Shares of pools and bonuses never count.

### Pools

- Non-program's net offsets the pools first (cyc-seattle/platform#242). Its net is its offerings'
  revenue less their own costs, before any bonus. Every pooled amount gives up the same fraction,
  net ÷ everything in every pool, so each pool is offset in proportion to its size. That part stays
  on the organization's books, keeping its account and function, keyed
  `offset:<pool key>:<the original line key>`. A loss works the same way: the fraction is negative,
  the organization's line is a credit, and the programs share more than the pools hold.
- If non-program's net is more than everything in every pool, the organization keeps all of them,
  and the engine warns (`non_program_exceeds_pools`). Non-program keeps the rest as its margin.
- The rest of every pooled amount is divided among the year's programs' offerings by MTDC, keeping
  its account. Its line key is `pool:<pool key>:<the original line key>`. Non-program's offerings
  take no share, so their P&L shows their own margin.
- Because shared costs never count toward MTDC, the order the pools are divided in doesn't matter.
- If no program's offering has any MTDC, the shared costs stay on the organization's books and the
  engine shows a warning.

### Bonuses

- A bonus owner earns `bonus_rate` × the net of its products for the year, if it's above zero.
  `basis` `after_shared_costs`, the default, counts each offering's share of the pools;
  `before_shared_costs` doesn't.
- No bonus counts in any bonus's base.
- The bonus is divided among its products' offerings by revenue. If none has revenue, they share it
  evenly; if there are none this year, it's left out. Either way the engine warns.
- The year's `payroll_tax_rate` × the bonus is booked as payroll tax on the same offerings.
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
- a share of a pool keeps the function it had in the pool, so a G&A share stays `management`

A saved plan version keeps the functions it was calculated with.

### Line names

Each line's `line_name` says what it is:

- revenue is "Revenue", COGS "Cost of goods sold", and a revenue charge its own name
- coaches' wages are "Coach wages", RIBs "RIBs", and boats "Boat maintenance: <boat class>"
- a resource, a trip, a budget line or a labor line has its own name
- a salaried position's hours are "<position>: coaching" or "<position>: management", and the rest
  of its salary "<position>: rest of salary"
- payroll tax is "Payroll tax"
- a bonus is "Bonus: <role>", and its tax "Payroll tax on bonus: <role>"
- a share of a pool is "<pool> share: <the line it shares>", such as "G&A share: Payroll tax"
- the part of a pool non-program's net offsets is "<pool> covered by non-program: <the line it
  shares>"

### The organization's totals

Operating revenue pays for operating costs, and fundraising pays for capital. `organization` adds up
every line:

- **Capital** is every line on an asset account, such as buying a coach boat.
- **Fundraising** is revenue and expense whose function is `fundraising` (see [Function](#function)).
  Give donation and grant accounts the `fundraising` default.
- **Operating** is every other revenue and expense.

It gives operating revenue, expenses and net, then fundraising's, then capital, then the total:
operating net plus fundraising net, less capital.
