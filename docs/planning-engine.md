---
tags: [architecture, planning]
---

## Planning: engine

The planning engine calculates a plan's P&L for one year from the plan's rows in
[the planning schema](planning-schema.md). It's part of `@cyc-seattle/platform`, imported as
`@cyc-seattle/platform/planning`. It doesn't read from or save to the database: an app or an agent
loads the rows, calls `computePlan`, and shows the answer. A saved plan version records which version
of the engine calculated its numbers, so we can recalculate them the same way later.

```ts
import { computePlan, perDay, perSailorDay } from "@cyc-seattle/platform/planning";

const { lines, pnl, activities, warnings } = computePlan(data);
```

`data` holds the catalog, the organization, and every row of the plan versions being calculated,
named as the schema names them, plus:

- `fiscal_year`, the plan year. Fiscal year 2027 ends in calendar year 2027 and starts in the
  organization's `fiscal_year_start_month`.
- `rib_resource_kind_id`: which resource kind is RIBs. The engine uses those resources' rates to cost
  each RIB hour.

It returns:

- `lines`: every cost and revenue line for the year, on its offering, product, pool or the
  organization, by account. Amounts are always positive cents; the account's type says whether it's
  revenue or expense.
- `pnl`: each offering's revenue, costs by account, and net, then each product's, which adds up its
  offerings. Each also has its MTDC, enrollment, days and sailor-days.
- `perDay(p)` and `perSailorDay(p)`: an offering's or product's P&L for one day it runs, and for one
  sailor on one day.
- `activities`: each activity with the coaches, RIBs and boats the engine gave it.
- `warnings`: anything in the plan the engine had to skip or couldn't price.

## Terms

- **Pool:** a group of shared costs, such as general and administrative (G&A) costs or program
  admin, that no single offering owns. The engine divides each pool among the offerings.
- **MTDC** (modified total direct costs): an offering's own costs, less a few kinds a federal grant
  rule leaves out. Shared costs are divided among offerings by MTDC: an offering with twice the MTDC
  takes twice the share.

## Order

1. **Activities.** The plan year's activities, with their paid time and time on the water.
2. **Staffing.** The engine calculates how many coaches, RIBs and boats each activity needs, and what
   they cost.
3. **Revenue**, with COGS and card fees.
4. **Lines.** Budget lines, labor lines and salaried positions. Costs on a product are divided among
   its offerings last, once every offering's own costs are in.
5. **Payroll tax** on every wage.
6. **Pools**, divided among the offerings.
7. **Bonuses.**

## Rules

### The plan year

- All of an offering's revenue and costs go in the plan year it starts in, even if it runs into the
  next year.
- Each staff level, salaried position, resource and boat rate has one rate for the year.
- Each cost the engine calculates (coach wages, salaries, payroll tax, RIBs, boat maintenance,
  resources, travel, COGS and card fees) is recorded in the account set for it in
  `organization_cost_accounts`. If no account is set, the engine leaves that cost out and shows a
  warning.

### Activities

- An activity is paid from `start_time` to `end_time`, plus setup and put-away.
- Time on the water is `on_water_minutes` if set, otherwise start to end. It's zero for travel days
  and for activities that don't use boats.
- An offering's days are the dates it has an activity other than travel. Its sailor-days are its
  enrollment × its days.

### Staffing

- Enrollment is a whole number of kids: `target_enrollment` if set, otherwise `capacity × fill_rate`
  rounded. Kids who join or leave partway through aren't counted.
- Coaches are the activity's `fixed_coaches` if set, otherwise the offering's, otherwise one per
  `sailors_per_coach` kids (rounded up), and at least `min_coaches`.
- RIBs are the activity's or offering's `fixed_ribs` if set, otherwise coaches × `ribs_per_coach`
  rounded up. Travel days use no RIBs.
- Boats: the kids not bringing their own boat (`1 − byob_share`) are split across the offering's boat
  classes by share, and each class gets enough boats for its sailors at `sailors_per_boat`, rounded
  up.
- **Shared coaching.** When an activity block applies (for example, two youth groups on Wednesdays),
  those offerings share coaches: enough for all their kids together, and at least the largest
  `min_coaches`. They share RIBs at the highest `ribs_per_coach` among them, and boats are counted
  for all their sailors together. Each offering pays its share by its number of kids, so it can pay
  for part of a coach. The block's `coach_level_id` sets the coaches' pay level. Salaried staff in
  the block coach first, and hourly coaches fill the rest.
- Hourly coaches cost their paid hours × their level's `hourly_rate_cents`. Volunteers cost nothing.
- If a coach level lacks the offering's `required_qualification`, directly or through
  `qualification_covers`, the engine shows a warning.
- A RIB costs `cost_per_hour + fuel_per_hour + maintenance_per_hour` for each hour on the water, plus
  `cost_per_day` for each activity. The engine averages these over the RIB resources, weighted by
  `quantity`.
- A boat costs its class's `maintenance_per_boat_hour_cents` for each hour on the water.
- An activity's `plan_activity_resources` cost `quantity × (hours × hourly cost + cost_per_day)`.
  If `hours` isn't set, it's the activity's paid hours.
- A trip costs each coach's airfare, plus `nights` × the year's lodging rate for each coach, plus
  `miles` × the year's mileage rate once. Its coaches are the ones on its travel days; with no travel
  days, the offering's coaching ratio sets them. Sailors' own travel isn't charged.

### Revenue

- An offering's revenue is its `price_cents` × its enrollment.
- COGS is `cogs_rate` × revenue.
- Card fees are the year's `card_fee_rate` × revenue.

### Budget and labor lines

- A budget line counts only in its `fiscal_year`. Equipment is a cost in the year it's bought.
- A labor line costs its hours × its staff level's rate, and is a wage.
- A cost on a product is divided among the product's offerings that year by MTDC. If the product has
  no offerings that year, the cost stays on the product and the engine shows a warning.

### Salaried positions

- A position costs its `annual_salary_cents`.
- Its hourly rate is `annual_salary_cents / paid_hours_per_year`. The hours it spends coaching in an
  activity block, and its `plan_salaried_bookings` hours, are charged at that rate to the offerings
  or products they were for.
- First, the `ga_share` part of the salary goes to G&A. If the hours charged to programs add up to
  more than what's left, the engine scales them down and shows a warning.
- The rest of the salary, including the `ga_share` part, goes to the position's `remainder_pool_id`
  pool, or to the organization if it has none.

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

- Everything in every pool is divided among all of the year's offerings by MTDC, keeping its
  account. Its line key is `pool:<pool key>:<the original line key>`.
- Because shared costs never count toward MTDC, the order the pools are divided in doesn't matter.
- If no offering has any MTDC, the shared costs stay on the organization's books and the engine
  shows a warning.

### Bonuses

A bonus owner earns `bonus_rate` × the combined net of its products for the year, after pools, if
that net is above zero. The bonus is divided among those products' offerings by revenue, and is never
counted in MTDC.
