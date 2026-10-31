---
tags: [architecture, planning, directus]
---

## Planning: schema

Entity-relationship diagrams for the program planning and financial model app. `schemas/core.yaml` declares the `core` catalog, except `offering_external_refs`. `schemas/planning.yaml` declares plans, their versions, which version is active, and every row a version holds. Version sets, scenarios, baselines and actuals are designed here, but not built yet.

The database stores only what planners enter, not totals calculated from it. Apps and agents ask the [planning engine](planning-engine.md) to calculate a P&L when they need one.

### Terms

- **Product:** a lasting thing CYC sells, such as J-Pod Race Team, boat charters or storage leasing. Products live in the new `core` domain.
- **Program:** a product of kind `program`, such as J-Pod Race Team. Each application groups programs its own way: the website by category, Google Workspace by Group.
- **Program area:** one part of the club's programs, such as Summer or Singlehanded, with one revenue account and a director, who plans it. Every program belongs to one. Areas are the program services the club reports in Part III of Form 990. Merchandise, storage and charters belong to none.
- **Offering:** a product sold for a period, such as J-Pod Fall 2027 or Guppies summer week 3. A program offering is one Clubspot session × class, the unit Clubspot caps enrollment on.
- **Activity:** one dated, timed event that uses coaches, boats or other resources, such as a practice, a regatta day or a travel day. The planner, or a scheduling tool, enters each one.
- **Activity block:** offerings whose activities share coaches and boats on certain days, set up by the planner. For example, J-Pod and K-Pod on Wednesdays.
- **Cost center:** what a money line belongs to. That is an offering, a product or a program area (each divided among its offerings), a pool (G&A, program admin), or the org. Strictly speaking, an offering that earns revenue is a profit center, but we call all of these cost centers.
- **Bonus owner:** a role, such as Single-handed head coach. It owns a set of products and earns a bonus on their combined net.
- **Plan:** one part of the club's overall plan, saved and versioned on its own. A **program area's plan** holds one area's offerings for one year. The **Operations Plan** holds what the areas share, the charges set as a share of revenue, and the products in no area: merchandise, storage and charters.
- **Version:** either a draft or an immutable saved snapshot of one plan.
- **Version set:** one version per plan.
  - The **active version set** is "the plan".
  - A **scenario** is a version set with some versions swapped, added or dropped.
  - A **baseline** is a frozen version set that variance is measured against.

### Diagram conventions

Every version-scoped entity also has an `id`, a `version_id` and a `key`. A new row gets a random `key` unless it's given one, and a copy into a new draft keeps it. A `key` should be unique within its version, but Directus can't make a pair of columns unique, so nothing checks it. The diagrams below leave these out except where they matter.

Arrays are shown as `json`.

Dashed lines are references by stable `key` across plans. The engine looks them up within a version set; they are not database foreign keys.

### `core` catalog

```mermaid
erDiagram
    products ||--o{ offering_external_refs : "via offering key"
    accounts |o--o{ products : "revenue account, outside an area"
    program_areas |o--o{ products : "area of"
    accounts ||--o{ program_areas : "revenue account"
    directus_users |o--o{ program_areas : director
    qualifications ||--o{ qualification_covers : covers
    qualifications ||--o{ qualification_covers : "covered by"
    accounts |o--o{ accounts : "parent, contra"
    products ||--o| programs : "program subtype"
    organizations ||--o{ organization_cost_accounts : "calculated costs go to"
    accounts ||--o{ organization_cost_accounts : "booked to"

    products {
        uuid id PK
        string name
        string kind "program|charter|storage_lease|merchandise|event_hosting|other"
        uuid revenue_account_id FK "for a product in no area"
        uuid program_area_id FK "every program has one"
    }
    program_areas {
        uuid id PK
        string name
        uuid revenue_account_id FK "required"
        uuid director_id FK "a user; cleared if the user is deleted"
    }
    accounts {
        uuid id PK
        string number
        string name
        string type "revenue|expense|asset|liability|net_assets"
        string form_990_part
        string form_990_line
        string default_function "program|management|fundraising"
        uuid parent_id FK
        uuid contra_account_id FK
        boolean retired
    }
    qualifications {
        uuid id PK
        string name
    }
    programs {
        uuid id PK
        uuid product_id FK "unique, required, kind program"
    }
    organizations {
        uuid id PK
        string name
        int fiscal_year_start_month "1-12"
    }
    qualification_covers {
        uuid id PK
        uuid qualification_id FK
        uuid covers_id FK
    }
    boat_classes {
        uuid id PK
        string name
        int sailors_per_boat
        decimal footprint_sq_ft
    }
    resource_kinds {
        uuid id PK
        string name
    }
    organization_cost_accounts {
        uuid id PK
        uuid organization_id FK
        string cost_type "coach_wages|salaries|payroll_tax|ribs|boat_maintenance|resources|travel|cogs"
        uuid account_id FK
    }
    offering_external_refs {
        uuid offering_key
        string clubspot_camp_id
        string clubspot_session_id
        string clubspot_class_id
        string disposition "mapped|ignored"
    }
```

`programs` is the subtype of a product of kind `program`, per `AGENTS.md`'s subtype pattern. A product with a program can't be deleted.

A program area has one revenue account, and a product in an area books its sales there. A product's own `revenue_account_id` is for products in no area, and the Data Studio hides it once an area is set. The Data Studio asks for an area on a program and hides it on other kinds, but the database doesn't require one, since prod's programs had none when areas arrived. The engine warns about a program with no area, and the Google sync's audit about a product whose own account differs from its area's. A program area with products can't be deleted. Deleting its director's user clears the director. `organizations` holds each organization's fiscal year. `organization_cost_accounts` lists which account each calculated cost (coach wages, payroll tax, and so on) is recorded in, one row per cost type. Directus can't make a pair of columns unique, so nothing stops a second row for a cost type, and the engine then uses whichever it reads last. Staff levels, resource kinds and boat rates name no account. QuickBooks Classes split those accounts by program, which the engine's per-product P&L shows.

### Versioning

```mermaid
erDiagram
    program_areas ||--o{ plans : "has plan"
    organizations ||--o{ plans : "plans for"
    plans ||--o{ plan_versions : versions
    plan_versions |o--o{ plan_versions : parent
    plan_versions |o--o{ plan_versions : "calculated with"
    version_sets |o--o{ version_sets : "base set"
    version_sets ||--o{ version_set_members : pins
    plans ||--o{ version_set_members : "pinned in"
    plan_versions |o--o{ version_set_members : "pinned version"
    plans ||--o{ plan_activations : "activation log"
    plan_versions ||--o{ plan_activations : activated

    plans {
        uuid id PK
        string kind "program_area|operations"
        uuid program_area_id FK "null for the operations plan"
        uuid organization_id FK
        int fiscal_year "the plan year"
        string name
        boolean archived
    }
    plan_versions {
        uuid id PK
        uuid plan_id FK
        uuid parent_version_id FK
        string status "draft|saved"
        string message
        uuid saved_by
        timestamp saved_at
        string platform_version "the @cyc-seattle/platform that calculated it"
        uuid operations_version_id FK "an area's plan: the saved Operations Plan version"
        text rules "the planner's own words, for their AI"
    }
    version_sets {
        uuid id PK
        string name
        string kind "active|scenario|baseline"
        string description
        uuid base_set_id FK
        date actuals_through
        timestamp frozen_at
        uuid frozen_by
    }
    version_set_members {
        uuid version_set_id FK
        uuid plan_id FK
        uuid version_id FK "null drops the plan"
    }
    plan_activations {
        uuid plan_id FK
        uuid version_id FK
        timestamp activated_at
        uuid activated_by
        int sequence "the highest is active"
    }
```

A plan is for one organization and one plan year (`fiscal_year`). A program area's plan names its area, and an Operations Plan names none. An area has one plan for each organization and year, and an organization one Operations Plan for each year. A plan's kind, program area, organization, and year can't change once it has a saved version.

A version's `rules` hold what the planner wants that the plan's numbers don't capture, in their own words, such as "every Monday, Wednesday and Friday, except on school holidays, from 4pm until dusk". Their AI reads them when it fills in the plan. The engine never does. Like every input, they're saved with the version and never change after.

A plan starts with a draft. A Plan Writer saves it by setting its `status` to `saved`, with the `platform_version` of the engine (`@cyc-seattle/platform`) that calculated its numbers, so we can recalculate them the same way later. A program area's plan is also saved with `operations_version_id`: the saved version of the same organization's Operations Plan, for the same year, that its numbers were calculated with. An area plan's row that names an Operations Plan row by key, such as `coach_level_key`, means the row with that key in that version. To change a saved plan, make a new draft whose `parent_version_id` is the saved version, and copy its rows, keys included.

A saved version doesn't copy the catalog. Recalculating an old saved version uses the catalog as it is today: today's products, accounts, boat classes, and the organization's fiscal year.

A plan's active version is the one in its `plan_activations` row with the highest `sequence`, so only one is active at a time. Making a version active adds a row, which must name a saved version of the plan. The database sets the row's `sequence` and `activated_at`. No one changes or deletes a row there. `version_sets` and `version_set_members` wait for scenarios and baselines.

#### A saved version never changes

A saved version, and every row in it, never changes, even for an admin. Directus skips permissions for an admin, so two things enforce it:

- The `saved-versions` hook (`stacks/backend/saved-versions.cjs`) refuses such a request with a 403 and a clear reason. Directus runs its filters for every user. The hook also stamps who saved a version and who made one active. A write that skips the hook, such as a flow's data step, leaves `saved_by` and `activated_by` empty.
- Database triggers refuse the same writes on every path, including the ones that skip Directus's filters, such as a flow's data steps. The hook installs them when Directus starts, and again after each schema change if they've changed or a table lost its trigger. An install gives up after 5 seconds waiting for a lock, and logs the failure. The hook makes the two unique indexes on `plans` after the triggers, each on its own, so plans that clash leave the triggers in place, and the log names the plans. The `saved-versions-check` step of the `backend` deploy, which runs whenever the schema or the triggers change, fails the deploy if a planning table lacks its trigger or an index is missing. Each one locks the version it checks until the write commits, so a version can't be saved while a write to one of its rows is still open. Directus shows a trigger's refusal with its reason when it creates or updates a row. When it deletes one, it answers with a 500, which shows the reason only to an admin.

Together they refuse:

- changing or deleting a saved version, or turning it back into a draft
- adding, changing, or deleting a row in a saved version
- moving a row to another version, or a version to another plan
- a row that links to a row in another version, such as an activity whose `offering_id` is another version's offering
- a new version that isn't a draft
- a program area's plan without its area, or an Operations Plan with one
- saving a version without a `platform_version`, or a program area's plan without its Operations Plan version
- changing or deleting a `plan_activations` row
- changing a plan's kind, program area, organization, or year once it has a saved version

Every foreign key from a plan row restricts delete, so deleting a catalog row a version uses, or a plan with versions, fails instead of cascading into a saved version. Archive a plan instead of deleting it.

An admin can still get past this in two ways, as a last resort: by changing a planning collection's fields or relations in the Data Studio, which changes the table itself, or by running SQL as the database's owner, which can turn the triggers off. In dev, `backend:savedVersionsDeletable` lets the integration tests delete a saved version and its rows and activations, so they can clean up. Through the API, only the first admin account can. The triggers can't tell which Directus user is writing, so in dev's database they allow those deletes on every path. The prod stack refuses that flag.

### Program area plan (one version)

```mermaid
erDiagram
    plan_versions ||--o{ plan_offerings : contains
    products ||--o{ plan_offerings : "offering of"
    qualifications |o--o{ plan_offerings : requires
    plan_offerings ||--o{ plan_offering_boat_classes : sails
    boat_classes ||--o{ plan_offering_boat_classes : "boat class"
    plan_offerings ||--o{ plan_activities : runs
    plan_offerings ||--o{ plan_trips : "travels for"
    plan_trips |o--o{ plan_activities : "travel days"
    plan_activities ||--o{ plan_activity_resources : uses
    plan_offerings ||--o{ plan_budget_lines : "direct lines"
    plan_offerings ||--o{ plan_labor_lines : "direct labor"
    accounts ||--o{ plan_budget_lines : "booked to"
    accounts ||--o{ plan_labor_lines : "booked to"

    plan_offerings {
        uuid key "stable"
        uuid product_id FK
        string name
        string season_term
        date starts_on
        date ends_on
        int capacity
        int target_enrollment "or fill_rate"
        decimal fill_rate
        int price_cents "per kid"
        decimal sailors_per_coach
        int min_coaches
        uuid coach_level_key "operations key"
        uuid required_qualification FK
        decimal ribs_per_coach
        decimal byob_share
        int fixed_coaches "override"
        int fixed_ribs "override"
        int fixed_boats "override"
        decimal cogs_rate
        string note
    }
    plan_offering_boat_classes {
        uuid offering_id FK
        uuid boat_class_id FK
        decimal share
    }
    plan_activities {
        uuid offering_id FK
        uuid trip_id FK "travel days"
        date date
        time start_time
        time end_time
        int on_water_minutes
        int setup_minutes
        int putaway_minutes
        string kind "practice|regatta|clinic|travel"
        boolean uses_boats
        int fixed_coaches "override"
        int fixed_ribs "override"
        int fixed_boats "override"
    }
    plan_trips {
        uuid offering_id FK
        string name
        int nights
        int airfare_cents "per coach"
        int miles
    }
    plan_activity_resources {
        uuid activity_id FK
        uuid resource_key "operations key"
        decimal quantity
        decimal hours
    }
    plan_labor_lines {
        string name
        string cost_center_type "offering|product|program_area|pool|org"
        uuid cost_center_key
        uuid staff_level_key "operations key"
        decimal hours
        uuid account_id FK
        string function
        string note
    }
    plan_budget_lines {
        string name
        uuid account_id FK
        string function
        string cost_center_type "offering|product|program_area|pool|org"
        uuid cost_center_key
        int amount_cents
        int fiscal_year
        boolean excluded_from_mtdc
        string note
    }
```

All of an offering's revenue and costs go in the plan year it starts in, even if it runs into the next year. Its enrollment is a whole number of kids, and its revenue is `price_cents` × enrollment.

Each activity is a dated row. The planner enters them, or a tool such as a scheduler or an agent writes them; nothing creates them automatically. A travel day is an activity of kind `travel`, linked to its trip.

A program area's plan holds only offerings of that area's programs, and the engine warns about any other.

A budget line counts in its `fiscal_year`. Capital, a line on an asset account such as buying a coach boat, is the organization's: fundraising pays for it, so it never reaches an area or an offering, and the engine moves it to the organization with a warning. A cost on a product or a program area is divided among its offerings by MTDC (modified total direct costs: an offering's own costs, less a few kinds a federal grant rule leaves out). `excluded_from_mtdc` leaves a cost out of MTDC, as [2 CFR 200.1](https://www.ecfr.gov/current/title-2/section-200.1) does for equipment, rent, participant support and the rest. `plan_labor_lines` hold labor not tied to an activity, such as head-instructor weeks, training and boat-maintenance labor, priced at a staff level.

### Operations plan (one version)

```mermaid
erDiagram
    plan_versions ||--o| plan_rates : contains
    plan_versions ||--o{ plan_staff_levels : contains
    plan_versions ||--o{ plan_salaried_positions : contains
    plan_versions ||--o{ plan_resources : contains
    plan_versions ||--o{ plan_activity_block_rules : contains
    plan_versions ||--o{ plan_pools : contains
    plan_versions ||--o{ plan_bonus_owners : contains
    resource_kinds ||--o{ plan_resources : "kind of"
    resource_kinds |o--o{ plan_rates : "RIB kind"
    boat_classes ||--o{ plan_boat_rates : "rate for"
    plan_salaried_positions ||--o{ plan_salaried_bookings : "management hours"
    products |o--o{ plan_salaried_bookings : "booked to"
    program_areas |o--o{ plan_salaried_bookings : "booked to"
    plan_versions ||--o{ plan_revenue_charges : contains
    accounts ||--o{ plan_revenue_charges : "booked to"
    plan_salaried_positions }o--o| plan_pools : "rest of salary to"
    plan_staff_levels |o--o{ plan_activity_block_rules : "hourly level"
    plan_bonus_owners ||--o{ plan_bonus_owner_products : owns
    products ||--o{ plan_bonus_owner_products : "owned by"
    plan_activity_block_rules }o..o{ plan_offerings : "offering keys"

    plan_rates {
        decimal payroll_tax_rate "share of wages"
        int lodging_per_night_cents
        int mileage_rate_cents
        uuid rib_resource_kind_id FK "which resource kind is safety boats (RIBs)"
    }
    plan_staff_levels {
        string name
        string pay_type "hourly|volunteer"
        int hourly_rate_cents
        json qualifications
    }
    plan_salaried_positions {
        string name
        int annual_salary_cents
        int paid_hours_per_year
        json qualifications
        decimal ga_share
        uuid remainder_pool_id FK
        string form_990_line "override"
    }
    plan_salaried_bookings {
        uuid position_id FK
        uuid product_id FK "or the area"
        uuid program_area_id FK "or the product"
        string kind "management"
        decimal hours
    }
    plan_resources {
        uuid resource_kind_id FK
        string name
        int quantity
        int cost_per_hour_cents
        int cost_per_day_cents
        int fuel_per_hour_cents
        int maintenance_per_hour_cents
        boolean excluded_from_mtdc "rentals"
    }
    plan_boat_rates {
        uuid boat_class_id FK
        int maintenance_per_boat_hour_cents
    }
    plan_activity_block_rules {
        string name
        json offering_keys
        json weekdays
        date starts_on
        date ends_on
        uuid coach_level_id FK
        json salaried_positions
    }
    plan_pools {
        string name
    }
    plan_revenue_charges {
        string name
        decimal rate "share of each offering's revenue"
        json product_kinds
        uuid account_id FK "revenue adds revenue, expense a cost"
        boolean excluded_from_mtdc
        string note
    }
    plan_bonus_owners {
        string role_name
        decimal bonus_rate
        uuid account_id FK
    }
    plan_bonus_owner_products {
        uuid bonus_owner_id FK
        uuid product_id FK
    }
```

`plan_rates` holds the year's rates, in at most one row per version. Each staff level, salaried position, resource and boat rate also has one rate for the year, so each has a single row.

`plan_revenue_charges` lists the charges set as a share of revenue, such as scholarships, the program buffer, B&O tax, and card fees. Each applies to every offering of the product kinds it names, at its rate × the offering's revenue. A charge on a revenue account adds revenue, such as the card fees families pay; on an expense account, it adds a cost. `excluded_from_mtdc` leaves it out of MTDC, as for scholarships, which are participant support.

The Operations Plan also holds the offerings of products in no area: merchandise, storage and charters.

A salaried booking names a product, or a program area whose offerings share it by MTDC.

A pool is a group of shared costs that no single offering owns, such as general and administrative (G&A) costs or program admin. It holds the lines put in it, and the part of a salaried person's pay that isn't charged to a program. Everything in a pool is divided among all of the year's offerings by MTDC.

A bonus owner's bonus is `bonus_rate` × the combined net of its products for the year, after pools, if that net is above zero.

The Operations Plan also holds `plan_budget_lines` and `plan_labor_lines` for pool and org lines (insurance, the clubhouse fee, fundraising, equipment). They have the same shape as an area plan's lines.

### Actuals

```mermaid
erDiagram
    accounts ||--o{ actuals : "booked to"

    actuals {
        string cost_center_type
        uuid cost_center_key
        uuid account_id FK
        string function
        date month
        int amount_cents
        string source "qbo|clubspot"
    }
```

Actuals are what QuickBooks and Clubspot recorded. To compare them with a plan, add up a plan year's actuals and compare them with the engine's lines for the same cost centers and accounts.
