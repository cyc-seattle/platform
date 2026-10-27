---
tags: [architecture, planning, directus]
---

## Planning: schema

Entity-relationship diagrams for the program planning and financial model app. `schemas/core.yaml` declares the `core` catalog, except `offering_external_refs` and `organization_cost_accounts`. The rest is proposed and not built yet.

The model holds a plan's facts and inputs only. Nothing worked out from them is stored: apps and agents call the [planning engine](planning-engine.md) for a P&L when they need one.

### Terms

- **Product:** a lasting thing CYC sells, such as J-Pod Race Team, boat charters or storage leasing. Products live in the new `core` domain.
- **Program:** a product of kind `program`, such as J-Pod Race Team. Each application groups programs its own way: the website by category, finance by revenue account, Google Workspace by Group. So no single program hierarchy exists.
- **Offering:** a product sold for a period, such as J-Pod Fall 2027 or Guppies summer week 3. A program offering is one Clubspot session × class, the unit Clubspot caps enrollment on.
- **Activity:** one dated, timed event that uses coaches, boats or other resources, such as a practice, a regatta day or a travel day. The planner, or a scheduling tool, enters each one.
- **Activity block:** offerings whose activities share coaches and boats on certain days, set up by the planner. For example, J-Pod and K-Pod on Wednesdays.
- **Cost center:** what a money line belongs to. That is an offering, a product (split over its offerings), a pool (G&A, program admin), or the org. Offerings that earn revenue are strictly profit centers, but one field covers every kind.
- **Bonus owner:** a role, such as Single-handed head coach. It owns a set of products and earns a bonus on their combined net.
- **Plan:** a separately versioned part of the plan. A **Program Plan** (or a Charter Plan, a Storage Plan and so on) holds one product's offerings. The **Operations Plan** holds what products share.
- **Version:** either a draft or an immutable saved snapshot of one plan.
- **Version set:** one version per plan.
  - The **active version set** is "the plan".
  - A **scenario** is a version set with some versions swapped, added or dropped.
  - A **baseline** is a frozen version set that variance is measured against.

### Diagram conventions

Every version-scoped entity also has an `id` (deterministic), a `version_id` and a `key`, and `(version_id, key)` is unique. The diagrams below leave these out except where they matter.

Arrays are shown as `json`.

Dashed lines are references by stable `key` across plans. The engine looks them up within a version set; they are not database foreign keys.

### `core` catalog

```mermaid
erDiagram
    products ||--o{ offering_external_refs : "via offering key"
    accounts |o--o{ products : "revenue account"
    qualifications ||--o{ qualification_covers : covers
    qualifications ||--o{ qualification_covers : "covered by"
    accounts |o--o{ accounts : "parent, contra"
    products ||--o| programs : "program subtype"
    organizations ||--o{ organization_cost_accounts : "posts computed costs"
    accounts ||--o{ organization_cost_accounts : "booked to"

    products {
        uuid id PK
        string name
        string kind "program|charter|storage_lease|merchandise|event_hosting|other"
        uuid revenue_account_id FK
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
        uuid product_id FK "unique, kind program"
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
        string cost_type "coach_wages|salaries|payroll_tax|ribs|boat_maintenance|resources|travel|cogs|card_fees"
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

`programs` is the subtype of a product of kind `program`, per `AGENTS.md`'s subtype pattern. A product with a program can't be deleted. `organizations` holds each organization's fiscal year. `organization_cost_accounts` names, for each cost the engine works out rather than reads from a line, the one account it books to; `(organization_id, cost_type)` is unique. Staff levels, resource kinds and boat rates name no account. QuickBooks Classes split those accounts by program, which the engine's per-product P&L shows.

### Versioning

```mermaid
erDiagram
    products ||--o| plans : "has plan"
    plans ||--o{ plan_versions : versions
    plan_versions |o--o{ plan_versions : parent
    version_sets |o--o{ version_sets : "base set"
    version_sets ||--o{ version_set_members : pins
    plans ||--o{ version_set_members : "pinned in"
    plan_versions |o--o{ version_set_members : "pinned version"
    plans ||--o{ plan_activations : "activation log"
    plan_versions ||--o{ plan_activations : activated

    plans {
        uuid id PK
        string kind "product|operations"
        uuid product_id FK "null for the operations plan"
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
        string platform_version "the @cyc-seattle/platform that worked it out"
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
    }
```

A saved version records the `@cyc-seattle/platform` version whose engine worked out its numbers, so they can be worked out again the same way.

### Product plan (one version)

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
        string kind "practice|regatta|clinic|camp_week|travel"
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
        string cost_center_type "offering|product|pool|org"
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
        string cost_center_type "offering|product|pool|org"
        uuid cost_center_key
        int amount_cents
        int fiscal_year
        boolean excluded_from_mtdc
        string note
    }
```

An offering counts, all of it, in the plan year it starts in. Its enrollment is a whole number of kids, and its revenue is `price_cents` × enrollment.

Each activity is a dated row. The planner enters them, or a tool such as a scheduler or an agent writes them; the model holds no rule that generates them. A travel day is an activity of kind `travel`, linked to its trip.

A budget line counts in its `fiscal_year`, and buying equipment is a cost in the year it's bought. A line on a product is split over the product's offerings by MTDC. `excluded_from_mtdc` leaves a cost out of MTDC, as [2 CFR 200.1](https://www.ecfr.gov/current/title-2/section-200.1) does for equipment, rent, participant support and the rest. `plan_labor_lines` hold labor not tied to an activity, such as head-instructor weeks, training and boat-maintenance labor, priced at a staff level.

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
    boat_classes ||--o{ plan_boat_rates : "rate for"
    plan_salaried_positions ||--o{ plan_salaried_bookings : "management hours"
    products ||--o{ plan_salaried_bookings : "booked to"
    plan_salaried_positions }o--o| plan_pools : "rest of salary to"
    plan_staff_levels |o--o{ plan_activity_block_rules : "hourly level"
    plan_bonus_owners ||--o{ plan_bonus_owner_products : owns
    products ||--o{ plan_bonus_owner_products : "owned by"
    plan_activity_block_rules }o..o{ plan_offerings : "offering keys"

    plan_rates {
        decimal payroll_tax_rate "share of wages"
        decimal card_fee_rate "share of revenue"
        int lodging_per_night_cents
        int mileage_rate_cents
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
        uuid product_id FK
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

`plan_rates` holds the year's rates; a version has at most one row. Each staff level, salaried position, resource and boat rate also has one rate for the year, so a key names one row.

A pool, such as G&A or program admin, collects shared costs: lines booked to it, and the salary its positions' hours don't charge to programs. All of it is split over every offering in the plan year by MTDC.

A bonus owner's bonus is `bonus_rate × the combined net of its products for the year`, after pools, when that's above zero.

The Operations Plan also holds `plan_budget_lines` and `plan_labor_lines` for pool and org lines (insurance, the clubhouse fee, fundraising, equipment). They have the same shape as the product plan's lines.

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

Actuals are what QuickBooks and Clubspot recorded. To compare them with a plan, add them up over the plan year and set them beside the engine's lines for the same cost centers and accounts.
