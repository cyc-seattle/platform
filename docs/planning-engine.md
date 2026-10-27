---
tags: [architecture, planning]
---

## Planning: engine

The planning engine works out a plan's P&L for one year from the plan's rows in
[the planning schema](planning-schema.md). It's part of `@cyc-seattle/platform`, imported as
`@cyc-seattle/platform/planning`. It reads nothing and stores nothing: an app or an agent loads the
rows, calls `computePlan`, and shows the answer. A saved plan version records the
`@cyc-seattle/platform` version it was worked out with, so its numbers can be worked out again.

```ts
import { computePlan, perDay, perSailorDay } from "@cyc-seattle/platform/planning";

const { lines, pnl, activities, warnings } = computePlan(data);
```

`data` holds the catalog, the organization, and every row of the plan versions being worked out,
named as the schema names them, plus:

- `fiscal_year`, the plan year. Fiscal year 2027 ends in calendar year 2027 and starts in the
  organization's `fiscal_year_start_month`.
- `rib_resource_kind_id`: the resource kind whose `plan_resources` price RIB hours.

It returns:

- `lines`: every cost and revenue line for the year, on its offering, product, pool or the
  organization, by account. Amounts are always positive cents; the account's type says whether it's
  revenue or expense.
- `pnl`: each offering's revenue, costs by account, and net, then each product's, which adds up its
  offerings. Each also has its MTDC, enrollment, days and sailor-days.
- `perDay(p)` and `perSailorDay(p)`: an offering's or product's P&L for one day it runs, and for one
  sailor on one day.
- `activities`: each activity with the coaches, RIBs and boats it was given.
- `warnings`: anything in the plan the engine had to skip or guess around.

## Order

1. **Activities.** The plan year's activities, with their paid and on-water time.
2. **Staffing.** Each activity gets coaches, RIBs and boats, and books what they cost.
3. **Revenue**, with COGS and card fees.
4. **Lines.** Budget lines, labor lines and salaried positions. A product's lines go to its
   offerings last, once every offering's own costs are in.
5. **Payroll tax** on every wage.
6. **Pools**, split over the offerings.
7. **Bonuses.**

## Rules

### The plan year

- An offering counts in the plan year it starts in, all of it.
- Each staff level, salaried position, resource and boat rate has one rate for the year.
- Each cost the engine works out (coach wages, salaries, payroll tax, RIBs, boat maintenance,
  resources, travel, COGS and card fees) books to the account the organization names for it in
  `organization_cost_accounts`. One with no account books nothing, with a warning.

### Activities

- An activity is paid from `start_time` to `end_time`, plus setup and put-away.
- Its time on the water is `on_water_minutes`, else start to end, and none when it doesn't use boats
  or is a travel day.
- An offering's days are the dates it has an activity other than travel. Its sailor-days are its
  enrollment × its days.

### Staffing

- Enrollment is a whole number of kids: `target_enrollment`, else `capacity × fill_rate` rounded.
  Kids joining or leaving partway through are left out.
- Coaches are the activity's `fixed_coaches`, else the offering's, else
  `max(min_coaches, ceil(enrollment / sailors_per_coach))`.
- RIBs are the activity's or offering's `fixed_ribs`, else `ceil(coaches × ribs_per_coach)`. Travel
  days use no RIBs.
- Boats: `enrollment × (1 − byob_share)` sailors on club boats, split across the offering's boat
  classes by share, then `ceil(sailors / sailors_per_boat)` in each class.
- **Shared coaching.** On a date a block rule covers, its offerings' activities share coaches:
  enough for all their kids together, at least the largest `min_coaches`. RIBs use the highest
  `ribs_per_coach` among them, and boats are counted for all their sailors together. Each offering
  pays its share by its kids, so it can pay for part of a coach. The block's `coach_level_id` sets
  the coaches' pay level. Its salaried positions fill its first coaching places, so fewer hourly
  coaches are paid.
- Hourly coaches cost paid hours × their level's `hourly_rate_cents`. Volunteers cost nothing.
- A coach level without the offering's `required_qualification`, directly or through
  `qualification_covers`, raises a warning.
- A RIB costs its `cost_per_hour + fuel_per_hour + maintenance_per_hour` for each hour on the water,
  plus `cost_per_day` for each activity, averaged over the RIB resources by `quantity`.
- A boat costs its class's `maintenance_per_boat_hour_cents` for each hour on the water.
- An activity's `plan_activity_resources` cost `quantity × (hours × hourly cost + cost_per_day)`.
  `hours` defaults to the activity's paid hours.
- A trip costs each coach's airfare, plus `nights` × the year's lodging rate for each coach, plus
  `miles` × the year's mileage rate once. Its coaches are those on its travel days, else what the
  offering's ratio gives. Sailors' own travel isn't charged.

### Revenue

- An offering's revenue is its `price_cents` × its enrollment.
- COGS is `cogs_rate` × revenue.
- Card fees are the year's `card_fee_rate` × revenue.

### Budget and labor lines

- A budget line counts only in its `fiscal_year`. Buying equipment is a cost in the year it's bought.
- A labor line costs hours × its staff level's rate, and is a wage.
- A line on a product goes to the product's offerings in the year by MTDC. A product with no
  offering in the year keeps it, with a warning.

### Salaried positions

- A position books its `annual_salary_cents`.
- Its hourly rate is `annual_salary_cents / paid_hours_per_year`. Its shared-coaching hours and its
  `plan_salaried_bookings` hours are charged at that rate to the offerings or products they served.
- `ga_share` of the salary is set aside first. If the charged hours would cost more than the rest,
  they're scaled down, with a warning.
- Whatever isn't charged, `ga_share` included, goes to `remainder_pool_id`, else the organization.

### Payroll tax

The year's `payroll_tax_rate` × every wage (hourly coaches, labor lines and salaries), booked where
the wage is.

### MTDC

An offering's MTDC (modified total direct costs) is the base the pools split by. It follows
[2 CFR 200.1](https://www.ecfr.gov/current/title-2/section-200.1) as revised in 2024: it counts
salaries and wages, fringe benefits, materials and supplies, services, travel, and the first $50,000
of each subaward, and leaves out equipment, capital spending, rent and rentals, participant support,
scholarships and fellowships, tuition remission, patient care, and each subaward over $50,000.

- A budget line or resource with `excluded_from_mtdc` set is left out. Set it for any cost the
  regulation leaves out. Equipment is an item that costs $10,000 or more and lasts more than a year;
  anything cheaper is a supply and counts.
- Every other direct cost counts, COGS and payroll tax among them.
- Pool shares and bonuses never count.

### Pools

- Everything booked to any pool is split over every offering in the plan year by MTDC, keeping its
  account. Its line key is `pool:<pool key>:<the original line key>`.
- MTDC counts direct costs only, so one pool's split never changes another's.
- When no offering has MTDC, pools stay with the organization, with a warning.

### Bonuses

A bonus owner earns `bonus_rate × the combined net` of its products for the year, after pools, when
that's above zero. It's booked to those products' offerings by revenue, and is never part of MTDC.
