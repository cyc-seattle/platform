# @cyc-seattle/planning-engine

The planning engine of [cyc-seattle/workplace#6](https://github.com/cyc-seattle/workplace/issues/6), as a
pure library. `computePlan(data)` takes one version set's rows and returns the `plan_results` and
`plan_metrics` rows the engine writes, plus the activities it staffed and any warnings. It does no I/O:
reading Directus, writing results, and permissions belong to its caller.

The input and output types in `src/types.ts` are named as
[docs/planning-schema.md](../../docs/planning-schema.md) names its collections and fields, so a caller
maps Directus rows onto them as they are. `PlanData` adds what the schema has no field for:

- `fiscal_year` and `fiscal_year_start_month`. Fiscal year N ends in calendar year N.
- `posting_accounts`: the accounts for activity labor, salaries, RIBs, boat maintenance, resources,
  travel and COGS, which have no account field of their own.
- `rib_resource_kind_id`: the resource kind whose `plan_resources` price RIB hours.

Amounts are magnitudes in cents; the account's type gives the sign. Results are summed by cost center,
account, function, basis, month and line, and rounded so each line's total stays exact to the cent.

## Order

Each step reads only what earlier steps booked.

1. **Schedule.** Rules and trips expand into activities, and stored activities apply over them.
2. **Staffing.** Each activity gets coaches, RIBs and boats, and books their cost. Activity blocks
   staff their offerings together.
3. **Revenue** and COGS, and the enrollment metric.
4. **Lines.** Budget lines, labor lines and salaried positions. A product's amounts go to its
   offerings last, so their weights see every offering's lines.
5. **Formulas**, then the MTDC metric.
6. **Pools**, in `step_order`.
7. **Bonus owners.**

## Rules

### Schedule

- A rule generates an activity on each of its `weekdays` (ISO, 1 = Monday) from its `starts_on` to
  its `ends_on`, defaulting to the offering's dates, less its `skip_dates`.
- Paid time is `start_time` to `end_time` plus setup and put-away. On-water time is the span times
  `on_water_fraction` (default 1), and zero when the rule doesn't use boats.
- A trip generates only its travel days: `pre_travel_days` before it and `post_travel_days` after,
  each `travel_hours_per_day` long. Its event days come from a regatta rule. Loading falls on the
  first day out and unloading on the last day back, or on the event's first or last day without one.
- A stored activity marked `overridden` replaces the generated one with the same rule or trip and
  date, and stands even if the rule no longer generates that date. A stored activity with no rule or
  trip is a one-off. A stored activity that isn't overridden is a stale copy and is ignored.

### Staffing

- Enrollment is `target_enrollment`, else `capacity × fill_rate`, unrounded.
- Coaches are the activity's `fixed_coaches`, else the rule's, else the offering's, else
  `max(min_coaches, ceil(enrollment / sailors_per_coach))`.
- RIBs are a fixed count by the same chain, else `ceil(coaches × ribs_per_coach)`. Travel days use no
  RIBs.
- Boats: `enrollment × (1 − byob_share)` sailors split across the offering's boat classes by share,
  then `ceil(sailors / sailors_per_boat)` per class. A class with no `sailors_per_boat` counts no
  boats, with a warning.
- **Activity blocks.** On a date the block rule covers, its offerings' activities are staffed as one
  group: coaches for the combined `enrollment / sailors_per_coach`, RIBs at the group's highest
  `ribs_per_coach`, and boats per class for the combined sailors. Each activity takes its share by
  enrollment, so counts can be fractional. A count an activity fixes keeps it out of that part of the
  group. The block's `coach_level_id` overrides the offerings' levels.
- The block's salaried positions fill its first coaching slots, so fewer hourly coaches are paid.
  Their hours go to the salaried rule.
- Hourly coaches cost paid hours × their level's `hourly_rate_cents`, in effect on the date.
  Volunteers count toward `coach_hours` but cost nothing and aren't `paid_hours`.
- A level missing the offering's `required_qualification`, directly or through
  `qualification_covers`, raises a warning.
- RIB hours cost `cost_per_hour + fuel_per_hour + maintenance_per_hour`, plus `cost_per_day` per RIB
  per activity, averaged over the RIB resources in effect, weighted by `quantity`.
- Boat hours cost the class's `plan_boat_rates` rate.
- `plan_activity_resources` cost `quantity × (hours × hourly cost + cost_per_day)`. `hours` defaults
  to the activity's paid hours.
- A trip costs each coach's `airfare_cents`, and `nights` × the `lodging_per_night_cents` assumption
  per coach, plus `miles` × the `mileage_rate_cents` assumption once. It books in the trip's first
  month.

Effective-dated rows each carry their own key. A reference by key (`coach_level_key`,
`staff_level_key`, `resource_key`) names a series by that row's `name`, and the engine picks the row
in effect on the date.

### Revenue

- The price is `price_cents`, blended with `plan_offering_prices` by share. Tier shares short of 1
  pay list price.
- `price_basis` is `per_enrollment` (the default), `per_session` (× sessions, not counting travel
  days), `per_month` (× the offering's months), or `per_unit` (`units`, ignoring enrollment).
- Accrual revenue follows the service: by sessions per month, or evenly over the offering's months
  when it has none, or always evenly for `per_month`.
- Cash revenue follows `registration_curve` (`{"YYYY-MM": share}`), else matches accrual.
- COGS is `cogs_rate` × revenue, on the same months.
- The enrollment metric falls in the registration months, else the offering's first month.

### Budget and labor lines

- Only budget lines whose `fiscal_year` is the one computed apply.
- `annual_split` (the default) splits the amount by `phasing` shares, or evenly over the year.
  `monthly_rate` books each `phasing` value as that month's cents, or `amount_cents` every month.
- `formula` stands in for `amount_cents`, and `hours_formula` for `hours`. Each reads assumptions in
  effect at the year's start, and `none` formulas that read no measure.
- `is_non_cash` books accrual only, and `is_capital` cash only.
- A product's line goes to its offerings in the year by `spread`: `by_mtdc` (the default),
  `by_revenue`, `even`, or `by_months` (months active in the year). The weights are annual, and
  each offering takes its share of every month. A product with no offering in the year keeps the
  line, with a warning.
- A labor line costs hours × its staff level's rate in each month, and counts as wages and paid
  hours. A product's labor line spreads `by_mtdc`.

### Salaried positions

- Each month the position is in effect books a twelfth of `annual_salary_cents`.
- Its hourly equivalent is `annual_salary_cents / paid_hours_per_year`. Block coaching and
  `plan_salaried_bookings` hours (spread evenly over the booking's months) are charged at it to the
  offerings or product they served, and count as wages and paid hours.
- `ga_share` of the salary is kept off the top. Charges that would exceed the rest are scaled down,
  with a warning.
- What isn't charged, `ga_share` included, goes to `remainder_pool_id`, else the org.

### Formulas

The formula language is arithmetic: numbers, names, `+ - * / ^`, parentheses, and `min`, `max`,
`round(x, digits)`, `ceil`, `floor` and `abs`. It is parsed, never `eval`ed. A name is an assumption,
a formula, or a measure: `coach_hours`, `paid_hours`, `rib_hours`, `boat_hours`, `enrollment`,
`wages`, `mtdc` or `revenue`.

- Formulas evaluate in dependency order, read from the expressions themselves. A cycle, an unknown
  name, or two formulas with one name is an error. A formula missing from `plan_formula_deps` raises a
  warning.
- A formula reads `none` formulas and formulas of its own dimension.
- `none` evaluates once over the year's totals; with an account, it books to the org evenly over the
  year. `month` evaluates per month over org totals, and books to the org. `offering` evaluates per
  offering per active month, and books to the offering. `product` evaluates per product per active
  month, and spreads to the product's offerings by that month's MTDC.
- `applies_to_filter` limits `offering` and `product` formulas, with the same shape as a pool's
  `targets_filter`.
- Every formula reads the measures as direct costs left them, so none sees another's bookings.
  Unless `excluded_from_base`, a booked formula joins MTDC and the pool bases.

### MTDC

An offering's MTDC is its accrual expenses from direct costs and formulas, less participant support,
capital, and lines `excluded_from_base`. Pool allocations and bonuses never count.

### Pools

Each pool, in `step_order`, takes every amount booked to it and allocates it on, keeping each amount's
account and function. A pool's line key is `pool:<pool key>:<the source's line key>`.

- **Targets** are the year's offerings matching `targets_filter`:
  `{offering_keys, product_ids, product_kinds, exclude_offering_keys, exclude_product_ids}`. Every
  field given must match.
- **Phasing** reshapes the pool's months before allocating: `even` over the year, `by_base` by each
  month's total base, `target_months` evenly over months a target is active, or null to keep the
  months as booked.
- `base_share` allocates each month by the targets' base that month: a measure named in `base`
  (default `mtdc`), or `accounts` to sum the accounts in `base_categories` and their children. A
  month with no base uses the year's.
- `fixed_shares` gives each share in effect that month its `share`.
- `area` gives each share `quantity / denominator_quantity`, or `/` the shares' total quantity.
- `formula` gives each share its `amount_cents` a year, evenly over its months in effect.
- A share aimed at a product spreads to the product's offerings active that month by MTDC.
- What the shares leave unclaimed goes to `remainder_pool_id`, which must come later in
  `step_order`, else to the org.
- Bases count direct costs and formulas only, never another pool's allocation.

### Bonus owners

`bonus_rate × max(0, combined net)`, where the net is accrual revenue less expenses of the owned
products and their offerings in the owner's window, after every pool. It books to those offerings by revenue,
evenly over the window's months, and counts in no base.

## Not yet

- Version sets: the caller flattens the pinned versions into one `PlanData`.
- Baselines, actuals and variance.
- `plan_salaried_positions.form_990_line` and the accounts' 990 fields, which belong to reporting.
